# Supabase setup - step by step

Goal: a SEPARATE Supabase project, two DB roles (owner for migrations, strauss_app
for the app under RLS), migrations applied, and the integration tests passing.
Secrets are set locally in .env.local only - never pasted in chat, never in git.

## Step 1 - create a separate Supabase project
1. Go to https://supabase.com and sign in.
2. New project. Give it a dedicated name (e.g. strauss-car-advisor-dev).
3. Choose a region close to you. Set a strong database password - save it in your
   password manager (this is the postgres/owner password).
4. Wait for the project to finish provisioning.

## Step 2 - get the two connection strings
Project Settings > Database > Connection string > URI.
- OWNER connection (runs migrations): the default 'postgres' user URI with your DB
  password. Use the Session pooler URI (port 5432) or Direct connection.
- APP connection (runs the app under RLS): same host/db but user strauss_app.
  You will set its password in Step 4.

## Step 3 - set env vars locally (.env.local, not committed)
Copy .env.example to .env.local and fill:
  MIGRATION_DATABASE_URL = postgresql://postgres:[OWNER_PASSWORD]@[HOST]:5432/postgres
  DATABASE_URL           = postgresql://strauss_app:[APP_PASSWORD]@[HOST]:5432/postgres
Leave STRAUSS_ALLOW_FILE_STORE empty (file store is local-demo only).
Do NOT send these to chat. .env.local is git-ignored.

## Step 4 - run migrations (as owner) then set the app-role password
1. Apply all migrations with the owner connection:
     the db:migrate npm script  (reads MIGRATION_DATABASE_URL)
   This creates tables, constraints, RLS policies (incl. explicit WITH CHECK),
   the strauss_app LOGIN role, grants, and the scenario-override / inquiries tables.
2. Set the strauss_app password once (owner only). In Supabase SQL editor or psql,
   connected as postgres, run:
     alter role strauss_app with password '[APP_PASSWORD]';
   Use the same [APP_PASSWORD] you put in DATABASE_URL.

## Step 5 - run the integration tests (as the app role)
Run the test npm script. With DATABASE_URL set, tests/integration/pg-rls.test.ts
runs for real (otherwise it is skipped and NOT counted as Postgres verification).
It checks, under the limited strauss_app role:
  - save + restore of a case/baseline;
  - RLS read isolation (another owner sees null);
  - RLS at the DB level: a raw 'select * from cases' with NO ownership filter
    returns 0 rows for another owner (the DB blocks it, not the WHERE clause);
  - strauss_app is not BYPASSRLS and not SUPERUSER;
  - RLS write isolation; single-baseline constraint; full compute (E-001 11032->11693);
  - scenario overrides persist (migration 0003);
  - updateFacts optimistic revision check -> conflict;
  - openInquiry dedup + unique open-inquiry index (migration 0004);
  - inquiries isolation across owners;
  - concurrency: two parallel alternative upserts do not create a duplicate.

## Step 6 - run the app against Postgres
With DATABASE_URL set, start the app (the dev npm script). The service uses the
Postgres repository automatically. If DATABASE_URL is missing in a deployed env,
the app fails fast with a clear config error (no silent fallback to file storage).

## Notes
- Migrations run as owner (MIGRATION_DATABASE_URL). The app runs as strauss_app
  (DATABASE_URL), which is RLS-subject. Never point DATABASE_URL at postgres.
- To reset locally: drop and recreate the public schema as owner, then re-run
  migrations. Do this only on a dev project.