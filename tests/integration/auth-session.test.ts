// tests/integration/auth-session.test.ts
// אימות מסלול הסשן האמיתי מול Supabase Auth, על הקוד האמיתי (createAuthClient + userFromClient)
// עם "ג'אר עוגיות" בזיכרון. ללא מודל.
//
// חשוב - מה מאומת ומה לא:
//  * מאומת: קוד חד-פעמי אמיתי -> verifyOtp -> סשן -> עוגיות -> אימות claims (חתימה) ->
//    זהות המשתמש, רענון, יציאה, קוד שגוי/ישן, ובידוד בין שני משתמשים.
//  * לא מאומת כאן: *שליחת המייל*. הקוד מופק דרך admin.generateLink (ללא משלוח).
//    שליחה אמיתית דורשת SMTP מוגדר ובדיקה ידנית - ראו docs/auth-setup.md.
// נוצרים משתמשי בדיקה זמניים ונמחקים בסיום. רץ רק עם SUPABASE_URL + SERVICE_ROLE_KEY.

import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createAuthClient, type CookieAdapter, type CookieToSet } from "../../src/server/auth/supabase.js";
import { userFromClient } from "../../src/server/auth/claims.js";
import { DEMO_LOGIN_EMAIL } from "../../src/domain/demo-login.js";

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const HAS = Boolean(URL_ && SERVICE);
const run = HAS ? describe : describe.skip;

/** ג'אר עוגיות בזיכרון, כמו הדפדפן: מוחק עוגיות שערכן ריק/פג. */
function jar(initial: Array<{ name: string; value: string }> = []) {
  const store = new Map(initial.map((c) => [c.name, c.value]));
  const adapter: CookieAdapter = {
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    setAll: (list: CookieToSet[]) => {
      for (const { name, value, options } of list) {
        const maxAge = (options as { maxAge?: number } | undefined)?.maxAge;
        if (value === "" || (typeof maxAge === "number" && maxAge <= 0)) store.delete(name);
        else store.set(name, value);
      }
    },
  };
  return { adapter, store };
}

run("סשן Supabase Auth אמיתי (קוד חד-פעמי, ללא משלוח מייל)", () => {
  const admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
  }, 30000);

  /** משתמש בדיקה + קוד חד-פעמי אמיתי (בלי לשלוח מייל). */
  async function userWithOtp() {
    const email = `strauss-test+${randomUUID().slice(0, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data?.properties?.email_otp) throw new Error("generateLink failed: " + (error?.message ?? "no otp"));
    created.push(data.user.id);
    return { email, otp: data.properties.email_otp, id: data.user.id };
  }

  // בדיקות הקוד משתמשות ב-anon אם קיים; אחרת ב-service רק לצורך הבדיקה (האפליקציה תמיד ב-anon).
  function withKey<T>(fn: () => Promise<T>): Promise<T> {
    const prev = process.env.SUPABASE_ANON_KEY;
    if (!ANON) process.env.SUPABASE_ANON_KEY = SERVICE!;
    return fn().finally(() => { if (prev === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prev; });
  }

  it("קוד נכון -> סשן; ה-claims מאומתים ומחזירים את זהות המשתמש", { timeout: 40000 }, async () => {
    const u = await userWithOtp();
    await withKey(async () => {
      const j = jar();
      const client = createAuthClient(j.adapter);
      const { data, error } = await client.auth.verifyOtp({ email: u.email, token: u.otp, type: "email" });
      expect(error).toBeNull();
      expect(data.session).toBeTruthy();
      // עוגיות הסשן נכתבו (כולל פיצול אם גדולות).
      expect([...j.store.keys()].some((k) => k.startsWith("sb-"))).toBe(true);
      // "בקשה חדשה": לקוח חדש שקורא רק את העוגיות -> אימות חתימה בלי קריאת רשת למשתמש.
      const next = createAuthClient(jar([...j.store.entries()].map(([name, value]) => ({ name, value }))).adapter);
      const user = await userFromClient(next);
      expect(user).not.toBeNull();
      expect(user!.id).toBe(u.id);
      expect(user!.email).toBe(u.email);
    });
  });

  it("קוד שגוי נדחה ואינו יוצר סשן", { timeout: 40000 }, async () => {
    const u = await userWithOtp();
    await withKey(async () => {
      const j = jar();
      const client = createAuthClient(j.adapter);
      const { data, error } = await client.auth.verifyOtp({ email: u.email, token: "000000", type: "email" });
      expect(data.session).toBeNull();
      expect(error).toBeTruthy();
      expect(await userFromClient(createAuthClient(j.adapter))).toBeNull();
    });
  });

  it("קוד חד-פעמי: שימוש שני באותו קוד נכשל", { timeout: 40000 }, async () => {
    const u = await userWithOtp();
    await withKey(async () => {
      const a = createAuthClient(jar().adapter);
      expect((await a.auth.verifyOtp({ email: u.email, token: u.otp, type: "email" })).error).toBeNull();
      const b = createAuthClient(jar().adapter);
      const second = await b.auth.verifyOtp({ email: u.email, token: u.otp, type: "email" });
      expect(second.error).toBeTruthy();
      expect(second.data.session).toBeNull();
    });
  });

  it("בלי עוגיות / עם עוגיה מזויפת: אין משתמש", { timeout: 20000 }, async () => {
    await withKey(async () => {
      expect(await userFromClient(createAuthClient(jar().adapter))).toBeNull();
      const forged = jar([{ name: "sb-forged-auth-token", value: "base64-" + Buffer.from(JSON.stringify({ access_token: "a.b.c", refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: 9999999999, user: { id: "x" } })).toString("base64") }]);
      expect(await userFromClient(createAuthClient(forged.adapter))).toBeNull();
    });
  });

  it("שני משתמשים: זהויות נפרדות (בסיס לבידוד התיקים), וכניסה מדפדפן אחר מחזירה אותו משתמש", { timeout: 60000 }, async () => {
    const a = await userWithOtp();
    const b = await userWithOtp();
    await withKey(async () => {
      const ja = jar(); const jb = jar();
      await createAuthClient(ja.adapter).auth.verifyOtp({ email: a.email, token: a.otp, type: "email" });
      await createAuthClient(jb.adapter).auth.verifyOtp({ email: b.email, token: b.otp, type: "email" });
      const ua = await userFromClient(createAuthClient(ja.adapter));
      const ub = await userFromClient(createAuthClient(jb.adapter));
      expect(ua!.id).toBe(a.id);
      expect(ub!.id).toBe(b.id);
      expect(ua!.id).not.toBe(ub!.id);
      // "דפדפן אחר": קוד חדש לאותו מייל, ג'אר חדש -> אותו משתמש (אותו owner_id), בלי תלות בעוגיה קודמת.
      const again = await admin.auth.admin.generateLink({ type: "magiclink", email: a.email });
      const otp2 = again.data!.properties!.email_otp;
      const jOther = jar();
      expect((await createAuthClient(jOther.adapter).auth.verifyOtp({ email: a.email, token: otp2, type: "email" })).error).toBeNull();
      expect((await userFromClient(createAuthClient(jOther.adapter)))!.id).toBe(a.id);
    });
  });

  it("יציאה מבטלת את הסשן בצד שרת וגם מנקה את העוגיות", { timeout: 40000 }, async () => {
    const u = await userWithOtp();
    await withKey(async () => {
      const j = jar();
      const c = createAuthClient(j.adapter);
      await c.auth.verifyOtp({ email: u.email, token: u.otp, type: "email" });
      const refresh = (await c.auth.getSession()).data.session!.refresh_token;
      expect(await userFromClient(createAuthClient(j.adapter))).not.toBeNull();
      await c.auth.signOut();
      expect([...j.store.keys()].filter((k) => k.startsWith("sb-"))).toHaveLength(0);
      expect(await userFromClient(createAuthClient(j.adapter))).toBeNull();
      // ה-refresh token שבוטל אינו מחדש סשן.
      const r = await createAuthClient(jar().adapter).auth.refreshSession({ refresh_token: refresh });
      expect(r.data.session).toBeNull();
    });
  });

  it("חשבון ההדגמה: קוד שגוי נדחה, קוד נכון יוצר סשן רגיל שנשמר ומסתיים ביציאה", { timeout: 60000 }, async () => {
    await withKey(async () => {
      const demoCode = process.env.DEMO_LOGIN_CODE;
      if (!demoCode) throw new Error("DEMO_LOGIN_CODE is required for the demo account auth test");
      const rejected = jar();
      const invalid = await createAuthClient(rejected.adapter).auth.signInWithPassword({
        email: DEMO_LOGIN_EMAIL, password: `${demoCode}-wrong`,
      });
      expect(invalid.error).toBeTruthy();
      expect(invalid.data.session).toBeNull();
      expect(await userFromClient(createAuthClient(rejected.adapter))).toBeNull();

      const j = jar();
      const client = createAuthClient(j.adapter);
      const { data, error } = await client.auth.signInWithPassword({
        email: DEMO_LOGIN_EMAIL, password: demoCode,
      });
      expect(error).toBeNull();
      expect(data.session).toBeTruthy();
      const user = await userFromClient(createAuthClient(j.adapter));
      expect(user?.email).toBe(DEMO_LOGIN_EMAIL);

      const refresh = data.session!.refresh_token;
      await client.auth.signOut();
      expect([...j.store.keys()].filter((k) => k.startsWith("sb-"))).toHaveLength(0);
      expect(await userFromClient(createAuthClient(j.adapter))).toBeNull();
      expect((await createAuthClient(jar().adapter).auth.refreshSession({ refresh_token: refresh })).data.session).toBeNull();
    });
  });
});

describe("סטטוס בדיקות Auth", () => {
  it(HAS ? "מפתחות Supabase מוגדרים - בדיקות הסשן רצות (שליחת מייל אינה נבדקת כאן)" : "חסרים מפתחות Supabase - skipped", () => {
    expect(true).toBe(true);
  });
});