// src/features/advisor/vehicle-match/ChoiceGroup.tsx
"use client";
// קבוצת בחירה נגישה: radio מקומי (ניווט חצים/Tab מובנה) בעיצוב כרטיס לחיץ במלואו.
// בחירה מסומנת בקו/רקע + אייקון וי + טקסט נגיש (לא בצבע בלבד). לכל כרטיס אייקון עקבי,
// ולאייקון הנבחר אנימציה קטנה חד־פעמית (data-anim) שנעלמת בתנועה מופחתת.

import type { Choice } from "./copy.js";
import { ChoiceIcon } from "./icons.js";

export function ChoiceGroup<T extends string | number>({
  name, labelledBy, describedBy, choices, value, onChange, compact = false,
}: {
  name: string;
  labelledBy: string;
  describedBy?: string;
  choices: Array<Choice<T>>;
  value: T | null;
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      className={`vm-choices ${compact ? "vm-choices-compact" : ""}`.trim()}
    >
      {choices.map((c, i) => {
        const selected = value === c.value;
        return (
          <label
            key={String(c.value)}
            className={`vm-choice ${selected ? "is-selected" : ""} ${c.icon ? "has-icon" : ""}`.trim()}
            style={{ ["--i" as string]: String(i) }}
          >
            <input
              type="radio"
              className="vm-radio"
              name={name}
              value={String(c.value)}
              checked={selected}
              onChange={() => onChange(c.value)}
            />
            {c.icon && (
              <span className="vm-choice-icon" data-anim={c.anim ?? "pop"} aria-hidden="true">
                <ChoiceIcon name={c.icon} />
              </span>
            )}
            <span className="vm-choice-text">
              <span className="vm-choice-label">{c.label}</span>
              {c.sub && <span className="vm-choice-sub">{c.sub}</span>}
            </span>
            <span className="vm-choice-mark" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path className="vm-check-path" d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </label>
        );
      })}
    </div>
  );
}
