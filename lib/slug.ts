// URL slug from a display name. Latin → kebab-ascii; non-latin (Hebrew) with no
// ascii left → "item" fallback (caller appends a uniqueness suffix). Keep simple.
export function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || "item";
}
