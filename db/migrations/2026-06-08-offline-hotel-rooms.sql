-- Offline Hotel Per-Room Inventory (2026-06-08)
-- Run manually in the Supabase SQL editor. offline_hotels lives only in Supabase.

-- 1. Child table: one row per physical room in an offline_hotels batch.
create table if not exists offline_hotel_rooms (
  id                     bigint generated always as identity primary key,
  hotel_id               bigint not null references offline_hotels(id) on delete cascade,
  room_type              text   not null,
  price                  numeric not null,            -- total per room for the stay (USD)
  meal_plan              text,
  last_cancellation_date date,
  supplier               text,
  is_booked              boolean not null default false,
  order_no               text,                        -- supplier order number (post-booking)
  acc_no                 text,                        -- accounting number / "doket" (post-booking)
  reservation_id         bigint,                      -- reservation that took this room (manual in phase 1)
  notes                  text,
  created_at             timestamptz not null default now()
);

create index if not exists idx_offline_hotel_rooms_hotel_id on offline_hotel_rooms(hotel_id);
create index if not exists idx_offline_hotel_rooms_is_booked on offline_hotel_rooms(is_booked);

-- 2. Backfill: clone each existing batch into num_rooms child rooms.
--    Skip hotels that already have rooms (idempotent).
do $$
declare
  h record;
  i int;
begin
  for h in
    select id, room_type, price, meal_plan, last_cancellation_date,
           coalesce(num_rooms, 0) as num_rooms, coalesce(consumed_rooms, 0) as consumed_rooms
    from offline_hotels
    where not exists (select 1 from offline_hotel_rooms r where r.hotel_id = offline_hotels.id)
  loop
    for i in 1..greatest(h.num_rooms, 0) loop
      insert into offline_hotel_rooms
        (hotel_id, room_type, price, meal_plan, last_cancellation_date, is_booked)
      values
        (h.id,
         coalesce(h.room_type, 'Double'),
         coalesce(h.price, 0),
         h.meal_plan,
         h.last_cancellation_date,
         i <= h.consumed_rooms);   -- first consumed_rooms rooms flagged booked for counter parity
    end loop;
  end loop;
end $$;
