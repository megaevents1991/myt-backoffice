-- AI Uploader: a row of the run-level panel ("לטיפול ברמת הריצה") a person marked handled (08.11.2026, Dor: "צ'ק בוקס
-- שמנקה אותה משם אחרי שטיפלתי"). The panel's rows come from the items' warnings, which stay as they were built - a hall
-- with one category still "לבדיקה", a page fixed by hand - so a row could stay there for good. `panel_done` = the keys of
-- the rows a person checked (`PanelRow.key`: "venue:<drawing url>", "names", "subject", "fix:<code>", "info:<code>");
-- the board hides them and lists them under "N טופלו", where unchecking brings a row back. Backoffice only (main never
-- reads uploader_runs).

alter table public.uploader_runs add column if not exists panel_done text[];
update public.uploader_runs set panel_done = '{}' where panel_done is null;
alter table public.uploader_runs alter column panel_done set default '{}';
alter table public.uploader_runs alter column panel_done set not null;
