# Strauss Car Advisor (yoetz harechev)

Hebrew net-salary simulator. Deterministic calculation in code; the model (next phase) runs the conversation and picks tools.

## Local run (npm scripts)
- install  -> installs deps
- dev      -> employee screen at http://localhost:3000
- test     -> Vitest suite
- typecheck-> tsc --noEmit
- build    -> Next.js production build
- db:migrate -> apply SQL migrations (needs DATABASE_URL)

## Current status (verified / pending)
VERIFIED (51 tests pass): pure calc engine six-employee exact-shekel; electric gross-up +250 net (tolerance < 0.01 before display rounding); CSV import 77,988 rows windows-1255 + 20-vehicle catalog resolution; service slice create/alternative/compute/restore/isolation against FILE storage.
PENDING (6 tests skipped until DATABASE_URL set): RLS, cross-user isolation, single-baseline constraint, concurrency against POSTGRES. Conversation (agent+model) not wired yet; marked unverified.

## Supabase / Postgres connection
Set these in .env.local locally (never pasted in chat, never in git). Copy .env.example to .env.local and fill:
- DATABASE_URL : Supabase > Project Settings > Database > Connection string (URI), Session pooler or Direct, with DB password. REQUIRED now - enables Postgres + RLS.
- SUPABASE_URL : Project Settings > API > Project URL (Auth/Storage/Realtime phases).
- SUPABASE_ANON_KEY : Project Settings > API > anon public (Auth phase).
- SUPABASE_SERVICE_ROLE_KEY : Project Settings > API > service_role (secret). Worker/admin only.

Steps:
1. Create a project at https://supabase.com (or run Supabase locally via Docker).
2. Set DATABASE_URL in .env.local.
3. Apply migrations with the db:migrate script (applies supabase/migrations/0001_core_schema.sql: tables, constraints, RLS).
4. Run the test script - Postgres tests run only when DATABASE_URL is set; otherwise skipped (NOT counted as Postgres verification).

### How RLS is enforced
PgCaseRepository opens a transaction per operation and sets app.owner_id via set_config(..., true) (transaction-scoped). RLS policies filter every query by current_setting('app.owner_id'). owner_id is server-injected only (visit cookie in demo, or auth.uid() in real auth) - never from the client.

## Architecture
- src/domain/calculation : pure calc engine (decimal.js), no network/db/model.
- src/domain/eligibility : deterministic eligibility.
- src/server/repositories : CSV/catalog import; CaseRepository (File + Pg).
- src/server/services : shared app services (UI/agent/worker).
- src/app, src/features : Next.js App Router, Hebrew/RTL employee screen, design tokens.
- supabase/migrations : DB schema of record with RLS and constraints.

Limits and open-decision status: see docs/decision-log.md.
Hebrew spec docs: requirements/design/tasks under .kiro/specs/strauss-car-advisor/.