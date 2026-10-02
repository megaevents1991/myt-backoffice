-- Site media of the Mega Family company: the pictures staff upload from the
-- tours content editors (trip pages, itinerary days, hotels, categories,
-- instructors). ADDITIVE ONLY.
--
-- One bucket per company, named media-<company slug> (integration plan).
-- Public bucket: the uploaded picture's URL is saved verbatim in the content
-- rows and the customer site loads it from
-- <project>.supabase.co/storage/v1/object/public/** (the only Storage path its
-- next.config allows), so it must be a permanent public URL - never signed.
--
-- No storage policies on purpose: every upload goes through a one-time signed
-- upload URL minted by the backoffice service role
-- (lib/actions/tours-media-actions.ts), like lib/upload-helper.ts. The anon
-- key can read a picture by its URL but cannot write or list.
--
-- The bucket itself refuses what the editors do not need: 10 MB per file,
-- raster images only (no SVG - an SVG can carry script).
--
-- Mega Events is untouched: no existing bucket is read or changed.
-- Rollback: section 9 of supabase/rollback/20261001_multi_company.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-mega-family',
  'media-mega-family',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;
