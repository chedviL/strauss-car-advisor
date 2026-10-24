import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSessionUser, getCaseState } = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getCaseState: vi.fn(),
}));

vi.mock("../../src/server/auth/next-session.js", () => ({ getSessionUser }));
vi.mock("../../src/server/web/service.js", () => ({ caseService: () => ({ getCaseState }) }));

import { GET } from "../../src/app/go/case/[caseId]/route.js";

const caseId = "11111111-1111-1111-1111-111111111111";
const inquiryId = "22222222-2222-2222-2222-222222222222";

function request(answer?: string) {
  const url = new URL(`https://app.example.com/go/case/${caseId}`);
  if (answer) url.searchParams.set("answer", answer);
  return new NextRequest(url);
}

describe("שער קישור תשובת נציג", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUser.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
    getCaseState.mockResolvedValue({
      openInquiries: [
        { id: inquiryId, status: "answered" },
        { id: "33333333-3333-3333-3333-333333333333", status: "open" },
      ],
    });
  });

  it("מאמת בעלות ומשמר תשובת inquiry שנענתה ביעד עם cookie התיק", async () => {
    const response = await GET(request(inquiryId), { params: Promise.resolve({ caseId }) });
    const location = new URL(response.headers.get("location")!);
    expect(getCaseState).toHaveBeenCalledWith(caseId, "owner-1");
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("c")).toBe(caseId);
    expect(location.searchParams.get("answer")).toBe(inquiryId);
    expect(response.cookies.get("strauss_case")?.value).toBe(caseId);
  });

  it("אינו מעביר answer זר או inquiry שעדיין פתוח", async () => {
    const unknown = await GET(request("44444444-4444-4444-4444-444444444444"), { params: Promise.resolve({ caseId }) });
    const open = await GET(request("33333333-3333-3333-3333-333333333333"), { params: Promise.resolve({ caseId }) });
    expect(new URL(unknown.headers.get("location")!).searchParams.has("answer")).toBe(false);
    expect(new URL(open.headers.get("location")!).searchParams.has("answer")).toBe(false);
  });

  it("אינו חושף תיק שלא בבעלות המשתמש", async () => {
    getCaseState.mockResolvedValueOnce(null);
    const response = await GET(request(inquiryId), { params: Promise.resolve({ caseId }) });
    expect(response.headers.get("location")).toBe("https://app.example.com/inquiries");
  });
});