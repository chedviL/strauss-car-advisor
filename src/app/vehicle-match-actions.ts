// src/app/vehicle-match-actions.ts
"use server";
// פעולת שרת ל"איזה רכב מתאים לי?". הזהות נקבעת בשרת מהסשן המאומת; מזהה תיק מהלקוח הוא
// בקשה בלבד (בעלות נבדקת). אין קריאת מודל. אין פתיחת בירור ואין שינוי רכב/חלופה.

import { requireOwner, AuthRequiredError } from "../server/auth/next-session.js";
import { caseService } from "../server/web/service.js";
import { executeVehicleMatch, type VehicleMatchResponse } from "../server/services/vehicle-match-service.js";

export type VehicleMatchActionResult = VehicleMatchResponse | { status: "auth" } | { status: "error" };

export async function runVehicleMatch(payload: unknown): Promise<VehicleMatchActionResult> {
  let owner: string;
  try {
    owner = await requireOwner();
  } catch (e) {
    if (e instanceof AuthRequiredError) return { status: "auth" };
    return { status: "error" };
  }
  try {
    return await executeVehicleMatch(caseService(), owner, payload);
  } catch (e) {
    console.warn(`[vehicle-match] failed: ${e instanceof Error ? e.name : "Error"}`);
    return { status: "error" };
  }
}
