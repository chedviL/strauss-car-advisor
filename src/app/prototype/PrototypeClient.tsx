"use client";

// src/app/prototype/PrototypeClient.tsx
// אב-טיפוס חזותי אינטראקטיבי *נפרד* - נתוני הדגמה בלבד, אין קריאות מודל,
// אין התחברות אמיתית ואין ספקי מודל. נועד לבדיקה חזותית לפני שילוב באתר.
//
// מכיל:
//  - בורר מצבים להדגמה (מנוחה / עיבוד / תוצאה / תקלה)
//  - מסך כניסה בקוד למייל (הרשת הגדולה והעדינה ברקע)
//  - מסך שיחה עם כרטיס השוואה (הרשת נסוגה לשוליים)
//  - תמיכה ב-prefers-reduced-motion
//
// אין לוגיקה עסקית - כל ה"שליחה"/"בדיקה" מקומית ומדומה.

import { useEffect, useMemo, useState } from "react";
import { CarConstellation, type CarMotionState } from "./CarConstellation.js";

type Screen = "entry" | "chat";

const STATES: { id: CarMotionState; label: string }[] = [
  { id: "rest", label: "מנוחה" },
  { id: "processing", label: "עיבוד" },
  { id: "result", label: "תוצאה" },
  { id: "error", label: "תקלה" },
];

// ----- נתוני הדגמה לכרטיס ההשוואה (סטטיים, ללא מנוע) -----
const DEMO_COMPARE = {
  title: "השוואת נטו חודשי",
  subtitle: "הדגמה · הנתונים להמחשה בלבד",
  rows: [
    { label: "שכר ברוטו", a: "₪24,000", b: "₪24,000" },
    { label: "שווי שימוש", a: "₪3,960", b: "₪5,310" },
    { label: "זקיפת מס", a: "−₪1,584", b: "−₪2,124" },
    { label: "השתתפות עובד", a: "−₪900", b: "−₪1,450" },
  ],
  nets: { a: "₪15,820", b: "₪15,130" },
  cars: { a: "מאזדה 3", b: "טויוטה קורולה היברידי" },
  delta: "+₪690 לטובת מאזדה 3",
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export function PrototypeClient() {
  const [screen, setScreen] = useState<Screen>("entry");
  const [motion, setMotion] = useState<CarMotionState>("rest");
  const reduced = useReducedMotion();

  return (
    <div className="pt-root" data-screen={screen}>
      {/* בורר מצבים - להדגמה בלבד */}
      <DemoBar
        screen={screen}
        setScreen={setScreen}
        motion={motion}
        setMotion={setMotion}
        reduced={reduced}
      />

      {screen === "entry" ? (
        <EntryScreen motion={motion} reduced={reduced} onEnter={() => setScreen("chat")} />
      ) : (
        <ChatScreen motion={motion} reduced={reduced} onBack={() => setScreen("entry")} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// בורר ההדגמה
// ---------------------------------------------------------------------------
function DemoBar({
  screen,
  setScreen,
  motion,
  setMotion,
  reduced,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
  motion: CarMotionState;
  setMotion: (m: CarMotionState) => void;
  reduced: boolean;
}) {
  return (
    <div className="pt-demobar" role="region" aria-label="בורר מצבים להדגמה">
      <span className="pt-demobar__tag">הדגמה</span>

      <div className="pt-seg" role="group" aria-label="מסך">
        <button
          className={`pt-seg__btn${screen === "entry" ? " is-active" : ""}`}
          onClick={() => setScreen("entry")}
          aria-pressed={screen === "entry"}
        >
          כניסה
        </button>
        <button
          className={`pt-seg__btn${screen === "chat" ? " is-active" : ""}`}
          onClick={() => setScreen("chat")}
          aria-pressed={screen === "chat"}
        >
          שיחה
        </button>
      </div>

      <div className="pt-seg" role="group" aria-label="מצב תנועה">
        {STATES.map((s) => (
          <button
            key={s.id}
            className={`pt-seg__btn${motion === s.id ? " is-active" : ""}`}
            onClick={() => setMotion(s.id)}
            aria-pressed={motion === s.id}
          >
            {s.label}
          </button>
        ))}
      </div>

      {reduced && <span className="pt-demobar__hint">תנועה מופחתת פעילה</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// מסך כניסה - הרשת גדולה ועדינה ברקע
// ---------------------------------------------------------------------------
function EntryScreen({
  motion,
  reduced,
  onEnter,
}: {
  motion: CarMotionState;
  reduced: boolean;
  onEnter: () => void;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  return (
    <main className="pt-screen pt-entry">
      {/* רקע: רשת גדולה ועדינה, מאחורי הטקסט (ללא תנועה מאחורי טקסט קריא) */}
      <div className="pt-entry__bg" aria-hidden="true">
        <CarConstellation state={motion} variant="hero" reducedMotion={reduced} />
      </div>

      <div className="pt-entry__content">
        <Wordmark />
        <div className="card pt-authcard">
          <header className="pt-authcard__head">
            <h1>כניסה</h1>
            <p>הכניסה בקוד חד-פעמי שנשלח למייל.</p>
          </header>

          {step === "email" ? (
            <form
              className="pt-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) setStep("code"); // מדומה: אין שליחה אמיתית
              }}
            >
              <label className="pt-field">
                <span>כתובת מייל</span>
                <input
                  type="email"
                  inputMode="email"
                  dir="ltr"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              <button className="btn btn-primary" type="submit" disabled={!email.trim()}>
                שליחת קוד
              </button>
              <p className="pt-note">הדגמה: לא נשלח מייל אמיתי.</p>
            </form>
          ) : (
            <form
              className="pt-form"
              onSubmit={(e) => {
                e.preventDefault();
                onEnter(); // מדומה: מעבר לשיחה
              }}
            >
              <p className="pt-sent">
                שלחנו קוד אל <b dir="ltr">{email || "name@company.com"}</b>
              </p>
              <label className="pt-field">
                <span>קוד אימות</span>
                <input
                  className="pt-code"
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={6}
                  placeholder="______"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <button className="btn btn-primary" type="submit" disabled={code.length < 4}>
                כניסה
              </button>
              <button type="button" className="btn-ghost" onClick={() => setStep("email")}>
                חזרה לשינוי המייל
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// מסך שיחה - הרשת נסוגה לשוליים, כרטיס השוואה
// ---------------------------------------------------------------------------
function ChatScreen({
  motion,
  reduced,
  onBack,
}: {
  motion: CarMotionState;
  reduced: boolean;
  onBack: () => void;
}) {
  const messages = useMemo(
    () => [
      { who: "bot" as const, text: "שלום! אני יועץ הרכב. על איזה רכב נדבר?" },
      { who: "me" as const, text: "אני מתלבט בין מאזדה 3 לטויוטה קורולה היברידי." },
      { who: "bot" as const, text: "מצוין. בוא נשווה את ההשפעה על הנטו החודשי שלך." },
    ],
    [],
  );

  const showResult = motion === "result";
  const isError = motion === "error";

  return (
    <main className="pt-screen pt-chat">
      {/* הרשת בשוליים (margin) */}
      <aside className="pt-chat__aside" aria-hidden="true">
        <CarConstellation state={motion} variant="margin" reducedMotion={reduced} />
      </aside>

      <section className="pt-chat__main">
        <div className="pt-chat__topbar">
          <Wordmark compact />
          <button className="btn-ghost" onClick={onBack}>
            ← למסך הכניסה
          </button>
        </div>

        <div className="pt-thread scroll-y">
          {messages.map((m, i) => (
            <div key={i} className={`pt-msg pt-msg--${m.who}`}>
              <div className="pt-bubble">{m.text}</div>
            </div>
          ))}

          {motion === "processing" && (
            <div className="pt-msg pt-msg--bot">
              <div className="pt-bubble pt-bubble--typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          {isError && (
            <div className="pt-msg pt-msg--bot">
              <div className="pt-bubble pt-bubble--error">
                משהו השתבש בעיבוד. נסו שוב בעוד רגע.
              </div>
            </div>
          )}

          {showResult && <CompareCard />}
        </div>

        <div className="pt-composer">
          <input placeholder="כתבו הודעה…" aria-label="הודעה" />
          <button className="btn btn-primary">שליחה</button>
        </div>
      </section>
    </main>
  );
}

function CompareCard() {
  const d = DEMO_COMPARE;
  return (
    <div className="pt-msg pt-msg--bot">
      <div className="card pt-compare anim-card">
        <header className="pt-compare__head">
          <h2>{d.title}</h2>
          <span className="pt-compare__sub">{d.subtitle}</span>
        </header>

        <div className="pt-compare__cols">
          <div className="pt-compare__colhead">
            <span className="pt-chip pt-chip--a">{d.cars.a}</span>
          </div>
          <div className="pt-compare__colhead">
            <span className="pt-chip pt-chip--b">{d.cars.b}</span>
          </div>
        </div>

        <table className="pt-compare__table">
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.a}</td>
                <td>{r.b}</td>
              </tr>
            ))}
            <tr className="pt-compare__net">
              <th scope="row">נטו צפוי</th>
              <td>{d.nets.a}</td>
              <td>{d.nets.b}</td>
            </tr>
          </tbody>
        </table>

        <footer className="pt-compare__delta">{d.delta}</footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// סמל/ווֹרדמַרק שטראוס (טקסטואלי - אין קובץ לוגו בפרויקט)
// ---------------------------------------------------------------------------
function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`pt-wordmark${compact ? " pt-wordmark--compact" : ""}`}>
      <span className="pt-wordmark__name">שטראוס</span>
      <span className="pt-wordmark__sep"> · </span>
      <span className="pt-wordmark__sub">יועץ הרכב</span>
    </div>
  );
}
