// src/app/api/payslip/route.ts
// העלאת תלוש וחילוץ נתונים. זהות הבעלים מה-cookie בלבד.
// שני שלבים:
//   action=upload  (ברירת מחדל): ולידציה + אחסון פרטי. חינם, ללא מודל.
//   action=extract: חילוץ בעזרת המודל (בתשלום) - רק בבקשה מפורשת.
// החילוץ מוחזר לאישור; אינו מוחל על התיק (זה קורה דרך updateMyFacts אחרי אישור).

import { cookies } from "next/headers";
import { caseService } from "../../../server/web/service.js";
import { getOrCreateVisitOwner } from "../../../server/web/visit.js";
import {
  validatePayslip, storePayslip, readPayslipBytes, setPayslipStatus, MAX_SIZE_BYTES,
} from "../../../server/web/payslip-storage.js";
import { extractPayslip } from "../../../server/agent/payslip-extract.js";

export const runtime = "nodejs";
export const maxDuration = 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function activeCaseId(owner: string): Promise<string | null> {
  const store = await cookies();
  let caseId = store.get("strauss_case")?.value ?? null;
  const service = caseService();
  const state = caseId ? await service.getCaseState(caseId, owner) : null;
  if (!state) {
    const created = await service.startBlankCase(owner);
    caseId = created.case.id;
    store.set("strauss_case", caseId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  }
  return caseId;
}

export async function POST(req: Request): Promise<Response> {
  const owner = await getOrCreateVisitOwner();
  const conn = process.env.DATABASE_URL;
  if (!conn) return json({ error: "אחסון לא זמין בסביבה זו." }, 503);

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "upload";

  try {
    if (action === "upload") {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "לא צורף קובץ." }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const v = validatePayslip(bytes);
      if (!v.ok) return json({ error: v.error.message, kind: v.error.kind }, 400);

      const caseId = await activeCaseId(owner);
      const stored = await storePayslip({
        connectionString: conn, ownerId: owner, caseId: caseId!,
        bytes, mime: v.mime, originalName: typeof file.name === "string" ? file.name.slice(0, 120) : null,
      });
      // אומדן עלות חילוץ (לא מריצים כאן): קובץ בודד, קריאת מודל אחת.
      return json({
        status: "uploaded",
        uploadId: stored.id,
        mime: stored.mime,
        sizeBytes: stored.sizeBytes,
        originalName: stored.originalName,
        extractEstimate: "חילוץ הנתונים משתמש במודל (קריאה אחת). לאישורך לפני ההרצה.",
      });
    }

    if (action === "extract") {
      const body = (await req.json().catch(() => ({}))) as { uploadId?: string };
      const uploadId = body.uploadId;
      if (!uploadId) return json({ error: "חסר מזהה העלאה." }, 400);
      const file = await readPayslipBytes({ connectionString: conn, ownerId: owner, uploadId });
      if (!file) return json({ error: "הקובץ לא נמצא או אינו שייך לך." }, 404);

      const extraction = await extractPayslip(file.bytes, file.mime);
      await setPayslipStatus({ connectionString: conn, ownerId: owner, uploadId, status: "extracted" }).catch(() => {});
      // מוחזר לאישור בלבד. ההחלה על התיק מתבצעת אחרי שהעובד/ת מאשר/ת (updateMyFacts).
      return json({ status: "extracted", uploadId, extraction });
    }

    return json({ error: "פעולה לא מוכרת." }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const safe = msg.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
    return json({ error: safe }, 500);
  }
}

export const config = { api: { bodyParser: false } };
void MAX_SIZE_BYTES;