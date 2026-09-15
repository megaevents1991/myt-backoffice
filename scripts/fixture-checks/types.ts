export interface FixtureFile {
  url: string;
  /** browser = needs a hydrated DOM (withBrowser); fetch = server-rendered, plain fetch + stealthHeaders. */
  via: "fetch" | "browser";
  /** browser only: selector to wait for before reading page.content(). */
  waitFor?: string;
}
export interface FixtureSpec {
  files: Record<string, FixtureFile>;
  /** Throws (node:assert) on regression. `read(file)` returns the saved HTML. */
  check(read: (file: string) => string): void;
}
