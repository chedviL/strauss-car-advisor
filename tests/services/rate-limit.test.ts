// tests/services/rate-limit.test.ts
// מגביל-הקצב (ללא רשת/מודל): מתיר עד N בחלון, חוסם מעבר, ומשחרר כשהחלון עובר.
import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, __resetRateLimits } from "../../src/server/web/rate-limit.js";

beforeEach(() => __resetRateLimits());

describe("מגביל קצב בזיכרון", () => {
  it("מתיר עד הגבול, חוסם את הפעולה שמעבר", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      const r = checkRateLimit("k", 3, 60_000, t0 + i);
      expect(r.allowed).toBe(true);
    }
    const blocked = checkRateLimit("k", 3, 60_000, t0 + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("משחרר כשהחלון עובר", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("w", 3, 60_000, t0 + i);
    // אחרי החלון (60s) - מותר שוב.
    const after = checkRateLimit("w", 3, 60_000, t0 + 60_001);
    expect(after.allowed).toBe(true);
  });

  it("מפתחות שונים אינם משפיעים זה על זה", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("a", 3, 60_000, t0 + i);
    const other = checkRateLimit("b", 3, 60_000, t0 + 3);
    expect(other.allowed).toBe(true);
  });

  it("retryAfterSeconds הוא לפחות שנייה אחת כשחסום", () => {
    const t0 = 4_000_000;
    checkRateLimit("r", 1, 60_000, t0);
    const blocked = checkRateLimit("r", 1, 60_000, t0 + 100);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});