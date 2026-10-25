export const DEMO_LOGIN_EMAIL = "demo@strauss-advisor.invalid";

export function isSharedDemoAccount(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === DEMO_LOGIN_EMAIL;
}
