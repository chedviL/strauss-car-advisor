// src/features/brand/ChatWave.tsx
"use client";
// רצועת הגלים הנוירונית ה"גולשת" מהקיר השמאלי-תחתון של מסך השיחה.
// שכבה דקורטיבית בלבד (aria-hidden, pointer-events:none, z-index מאחורי התוכן):
//   - תמונת הרצועה (PNG שקוף) עם כניסה רכה + "נשימה" איטית.
//   - פולסים קטנים בצבעי המותג הנעים לאורך מסלולי הגלים (offset-path),
//     באותה טכניקה של איור הכניסה (CarVisual) - תחושת "עיגולים נוסעים".
// כל האנימציות כבויות תחת prefers-reduced-motion (ראו globals.css).

const STRIP_SRC = "/brand/chat-neural-strip.png";

// פולסים הנעים לאורך קווי הגלים. כל מסלול מקורב לקו צבע ברצועה (viewBox
// מתואם ל-2048×768 של התמונה). ה-delay מפזר אותם כך שלא ינועו בלוק-סטפ.
const PULSES: Array<{ cls: string; delay: number }> = [
  { cls: "chat-wave-pulse-orange", delay: 0 },
  { cls: "chat-wave-pulse-green", delay: 3 },
  { cls: "chat-wave-pulse-blue", delay: 6 },
  { cls: "chat-wave-pulse-orange2", delay: 9 },
];

export function ChatWave() {
  return (
    <div className="chat-wave" aria-hidden="true">
      <img src={STRIP_SRC} alt="" className="chat-wave-img" />
      <div className="chat-wave-pulses">
        {PULSES.map((p) => (
          <span
            key={p.cls}
            className={`chat-wave-pulse ${p.cls}`}
            style={{ animationDelay: `${p.delay}s` }}
          />
        ))}
      </div>
    </div>
  );
}
