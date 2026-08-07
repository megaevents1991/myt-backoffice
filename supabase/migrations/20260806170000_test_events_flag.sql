-- Test events for payment/flow QA: the main app keeps them orderable by a
-- direct /order/{id} link but filters them out of every customer-facing
-- surface (catalog, search, categories, tags, Meta feed). Set via SQL for now:
--   update events set is_test = true where id = <test event id>;
alter table events add column if not exists is_test boolean not null default false;
