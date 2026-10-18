// src/features/advisor/RepresentativePanel.tsx
"use client";
// פאנל נציג: רשימת פניות מורשות עם ההקשר המינימלי הנחוץ בלבד, ומענה מובנה.
// מענה הנציג מוחל ומחושב בצד השרת — עובד גם כשהעובדת מנותקת; בחזרתה היא תראה
// את התשובה ואת התוצאה המעודכנת. אין כאן שכר/נטו/פרטים אישיים.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerRepInquiry } from "../../app/actions.js";

type RepInquiry = {
  inquiry: {
    id: string;
    type: "employee_participation" | "occupation_eligibility_clarification";
    status: "open" | "answered" | "cancelled";
    contextFingerprint: string;
    createdAt: string;
    answerValue: number | null;
    answerNote: string | null;
    effectiveFrom: string | null;
    answeredAt: string | null;
  };
  scenarioRole: "baseline" | "alternative" | null;
  route: "company_car" | "family" | "waiver" | null;
  vehicleCode: string | null;
  reportedGroup: string | null;
  currentParticipation: number | null;
};

const TYPE_LABEL: Record<RepInquiry["inquiry"]["type"], string> = {
  employee_participation: "בירור השתתפות העובד/ת ברכב",
  occupation_eligibility_clarification: "הבהרת זכאות לפי עיסוק",
};
const ROUTE_LABEL: Record<string, string> = {
  company_car: "רכב חברה", family: "מסלול משפחתי", waiver: "ויתור על רכב",
};

export function RepresentativePanel({ inquiries }: { inquiries: RepInquiry[] }) {
  const open = inquiries.filter((q) => q.inquiry.status === "open");
  const answered = inquiries.filter((q) => q.inquiry.status === "answered");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <section>
        <h2 style={{ fontSize: "var(--font-lg)", marginBottom: "var(--space-2)" }}>
          פניות פתוחות {open.length > 0 ? `(${open.length})` : ""}
        </h2>
        {open.length === 0 ? (
          <p style={{ color: "var(--color-muted)" }}>אין פניות פתוחות כרגע.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {open.map((q) => <InquiryCard key={q.inquiry.id} q={q} />)}
          </div>
        )}
      </section>

      {answered.length > 0 && (
        <section>
          <h2 style={{ fontSize: "var(--font-lg)", marginBottom: "var(--space-2)", color: "var(--color-muted)" }}>
            נענו ({answered.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {answered.map((q) => <InquiryCard key={q.inquiry.id} q={q} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function InquiryCard({ q }: { q: RepInquiry }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isParticipation = q.inquiry.type === "employee_participation";
  const [value, setValue] = useState<string>(
    q.inquiry.answerValue !== null ? String(q.inquiry.answerValue) : "",
  );
  const [note, setNote] = useState<string>(q.inquiry.answerNote ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState<string>(q.inquiry.effectiveFrom ?? "");
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  const answered = q.inquiry.status === "answered";

  function submit() {
    setMsg(null);
    const parsedValue = isParticipation
      ? (value.trim() === "" ? null : Number(value))
      : null;
    if (isParticipation && parsedValue !== null && !Number.isFinite(parsedValue)) {
      setMsg({ tone: "err", text: "ערך ההשתתפות אינו מספר תקין." });
      return;
    }
    startTransition(async () => {
      const res = await answerRepInquiry(q.inquiry.id, {
        value: parsedValue,
        note: note.trim() === "" ? null : note.trim(),
        effectiveFrom: effectiveFrom.trim() === "" ? null : effectiveFrom,
      });
      if (res.status === "applied") {
        setMsg({
          tone: "ok",
          text: res.recomputed
            ? "התשובה נרשמה והוחלה; ההשוואה חושבה מחדש. בחזרת העובד/ת תוצג התוצאה המעודכנת."
            : res.missingFields && res.missingFields.length > 0
              ? "התשובה נרשמה והוחלה, אך עדיין חסרים נתונים להשלמת החישוב: " + res.missingFields.join(", ")
              : "התשובה נרשמה והוחלה.",
        });
      } else if (res.status === "stale_context") {
        setMsg({ tone: "warn", text: "התשובה נרשמה, אך פרטי התיק השתנו מאז הפנייה ולכן לא הוחלה אוטומטית. כדי להמשיך: בקשו מהעובד/ת לפתוח בירור מחדש בהקשר העדכני, או עדכנו ידנית את הפרטים ואז שלחו שוב." });
      } else if (res.status === "future_effective") {
        setMsg({ tone: "warn", text: `התשובה נשמרה עם תחולה עתידית (${res.effectiveFrom}) ולכן טרם הוחלה. היא תיכנס לתוקף במועד התחולה. כדי להחיל כעת, הזינו תאריך תחולה של היום או השאירו ריק.` });
      } else if (res.status === "recorded_not_applied") {
        const why = res.reason === "no_value"
          ? "לא הוזן ערך השתתפות מספרי, ולכן נרשמה הערה בלבד."
          : res.reason === "not_participation"
            ? "פנייה זו אינה ערך-החלה (הבהרה בלבד); התשובה נרשמה."
            : "התשובה נרשמה אך לא הוחלה (אין תרחיש מקושר).";
        setMsg({ tone: "warn", text: why });
      } else if (res.status === "forbidden") {
        setMsg({ tone: "err", text: "אין לך הרשאה לענות על פנייה זו." });
      } else if (res.status === "error") {
        setMsg({ tone: "err", text: res.message });
      } else {
        setMsg({ tone: "err", text: "הפנייה לא נמצאה." });
      }
      router.refresh();
    });
  }

  return (
    <div style={{
      border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
      padding: "var(--space-3)", background: "var(--color-surface)",
      display: "flex", flexDirection: "column", gap: "var(--space-2)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-2)" }}>
        <strong style={{ fontSize: "var(--font-md)" }}>{TYPE_LABEL[q.inquiry.type]}</strong>
        {answered && <span style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>נענתה</span>}
      </div>

      {/* הקשר מינימלי בלבד */}
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px var(--space-3)", margin: 0, fontSize: "var(--font-sm)", color: "var(--color-muted)" }}>
        {q.route && (<><dt>מסלול</dt><dd style={{ margin: 0 }}>{ROUTE_LABEL[q.route] ?? q.route}</dd></>)}
        {q.vehicleCode && (<><dt>רכב</dt><dd style={{ margin: 0 }}>{q.vehicleCode}</dd></>)}
        {q.reportedGroup && (<><dt>קבוצת זכאות</dt><dd style={{ margin: 0 }}>{q.reportedGroup}</dd></>)}
        {isParticipation && (
          <><dt>השתתפות נוכחית</dt><dd style={{ margin: 0 }}>{q.currentParticipation !== null ? `${q.currentParticipation} ₪` : "לא נקבעה"}</dd></>
        )}
      </dl>

      {/* טופס מענה */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-1)" }}>
        {isParticipation && (
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>השתתפות חודשית (₪)</span>
            <input
              type="number" inputMode="decimal" min="0" step="1"
              value={value} onChange={(e) => setValue(e.target.value)}
              placeholder="לדוגמה 300" style={inputStyle} aria-label="השתתפות חודשית"
            />
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>הערת נציג (לא חובה)</span>
          <input
            type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={isParticipation ? "הקשר קצר לתשובה" : "תשובת הבהרת הזכאות"} style={inputStyle} aria-label="הערת נציג"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 220 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>בתוקף מתאריך (לא חובה)</span>
          <input
            type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
            style={inputStyle} aria-label="בתוקף מתאריך"
          />
        </label>

        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={pending} style={{ fontSize: "var(--font-sm)" }}>
            {pending ? "שומר…" : answered ? "עדכון תשובה" : "שליחת תשובה"}
          </button>
          {msg && (
            <span role="status" style={{
              fontSize: "var(--font-sm)",
              color: msg.tone === "ok" ? "var(--color-primary)" : msg.tone === "warn" ? "var(--color-muted)" : "var(--color-danger)",
            }}>{msg.text}</span>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)",
  font: "inherit", background: "var(--color-surface)", border: "1px solid var(--color-border)",
};