// scripts/sim/check-transcribe.ts
// בדיקת שפיות לחיבור התמלול: מאמת שהמפתח תקף, שמזהה המודל קיים, ושצורת
// הבקשה נכונה. שולח WAV סינתטי קצר (טון) - לא מצפים לטקסט אמיתי, רק לכך
// שהספק מקבל את הבקשה (לא 401/404). אינו מדפיס סודות.
// הרצה: npx tsx scripts/sim/check-transcribe.ts
import { loadEnv, envPresence } from "../../src/server/web/load-env.js";
import { getTranscribeModelId, transcribeAudio } from "../../src/server/agent/transcribe.js";

loadEnv();

/** בונה WAV מונו 16-bit PCM עם טון סינוס פשוט. */
function makeWav(seconds: number, sampleRate = 16000, freq = 440): Uint8Array {
  const n = Math.floor(seconds * sampleRate);
  const dataBytes = n * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);        // גודל בלוק fmt
  buf.writeUInt16LE(1, 20);         // PCM
  buf.writeUInt16LE(1, 22);         // מונו
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);         // block align
  buf.writeUInt16LE(16, 34);        // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.25 * 32767;
    buf.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return new Uint8Array(buf);
}

async function main() {
  const presence = envPresence(["TRANSCRIBE_API_KEY"]);
  console.log("env presence:", presence);
  if (!presence.TRANSCRIBE_API_KEY) {
    console.error("TRANSCRIBE_API_KEY אינו מוגדר ב-.env.local");
    process.exit(1);
  }
  console.log("model id:", getTranscribeModelId());

  const wav = makeWav(1.5);
  console.log(`sending synthetic wav: ${wav.byteLength} bytes`);
  const t0 = Date.now();
  try {
    const text = await transcribeAudio(wav, "audio/wav");
    console.log(`OK in ${Date.now() - t0}ms — provider accepted the request.`);
    console.log(`transcript (expected empty/meaningless for a tone): ${JSON.stringify(text)}`);
  } catch (e) {
    console.error(`FAILED in ${Date.now() - t0}ms:`, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    process.exit(1);
  }
}
void main();
