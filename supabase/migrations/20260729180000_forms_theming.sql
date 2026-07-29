-- Per-form branding for the public fill page.
--
-- Colours come from the MYT brand palette already used by the creative
-- generator and the site's OG images (see lib/forms/brand.ts). Logo and cover
-- are public Supabase Storage URLs picked with the existing image browser.

alter table forms
  add column if not exists theme           text not null default 'dark',
  add column if not exists accent_color    text not null default '#5BFF95',
  add column if not exists logo_url        text,
  add column if not exists cover_image_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'forms_theme_check') then
    alter table forms
      add constraint forms_theme_check check (theme in ('dark', 'light'));
  end if;

  -- Accent is rendered straight into inline styles, so only accept a hex colour.
  if not exists (select 1 from pg_constraint where conname = 'forms_accent_color_check') then
    alter table forms
      add constraint forms_accent_color_check check (accent_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;
