-- supabase/migrations/0005_rls_with_check.sql
-- הופך את ה-WITH CHECK למפורש בכל פוליסות הבעלות, כדי שגם INSERT/UPDATE
-- ייחסמו ברמת המסד (ולא יסתמכו על העתקה אימפליצטית מ-USING).
-- כל פוליסה: USING לקריאה/עדכון/מחיקה, WITH CHECK לכתיבה (post-image).

drop policy if exists cases_owner on cases;
create policy cases_owner on cases
  using (owner_id = current_setting('app.owner_id', true))
  with check (owner_id = current_setting('app.owner_id', true));

drop policy if exists case_facts_owner on case_facts;
create policy case_facts_owner on case_facts
  using (exists (select 1 from cases c where c.id = case_facts.case_id
    and c.owner_id = current_setting('app.owner_id', true)))
  with check (exists (select 1 from cases c where c.id = case_facts.case_id
    and c.owner_id = current_setting('app.owner_id', true)));

drop policy if exists scenarios_owner on scenarios;
create policy scenarios_owner on scenarios
  using (exists (select 1 from cases c where c.id = scenarios.case_id
    and c.owner_id = current_setting('app.owner_id', true)))
  with check (exists (select 1 from cases c where c.id = scenarios.case_id
    and c.owner_id = current_setting('app.owner_id', true)));

drop policy if exists messages_owner on messages;
create policy messages_owner on messages
  using (exists (select 1 from cases c where c.id = messages.case_id
    and c.owner_id = current_setting('app.owner_id', true)))
  with check (exists (select 1 from cases c where c.id = messages.case_id
    and c.owner_id = current_setting('app.owner_id', true)));

drop policy if exists turn_runs_owner on turn_runs;
create policy turn_runs_owner on turn_runs
  using (exists (select 1 from cases c where c.id = turn_runs.case_id
    and c.owner_id = current_setting('app.owner_id', true)))
  with check (exists (select 1 from cases c where c.id = turn_runs.case_id
    and c.owner_id = current_setting('app.owner_id', true)));

drop policy if exists comparisons_owner on comparisons;
create policy comparisons_owner on comparisons
  using (exists (select 1 from cases c where c.id = comparisons.case_id
    and c.owner_id = current_setting('app.owner_id', true)))
  with check (exists (select 1 from cases c where c.id = comparisons.case_id
    and c.owner_id = current_setting('app.owner_id', true)));

drop policy if exists inquiries_owner on inquiries;
create policy inquiries_owner on inquiries
  using (exists (select 1 from cases c where c.id = inquiries.case_id
    and c.owner_id = current_setting('app.owner_id', true)))
  with check (exists (select 1 from cases c where c.id = inquiries.case_id
    and c.owner_id = current_setting('app.owner_id', true)));