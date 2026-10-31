# Bundled fonts

Assistant, Rubik and Heebo, loaded with `next/font/local` from `app/layout.tsx` and `app/f/layout.tsx`.

They live in the repo because `next/font/google` fetches at build time, and Google sometimes answers the
CSS with a `fonts.gstatic.com/l/font?kit=...` URL instead of a `.woff2` one: next's extension regex then
returns null and the build dies with "Cannot read properties of null (reading '1')" (2 of 8 builds on
31.10.2026). **Do not go back to `next/font/google`.**

| File | Source in [google/fonts](https://github.com/google/fonts) | Commit | Version |
| --- | --- | --- | --- |
| `assistant.woff2` | `ofl/assistant/Assistant[wght].ttf` | `89c9db015089` | 3.000 |
| `rubik.woff2` | `ofl/rubik/Rubik[wght].ttf` | `765b99f8e53c` | 2.300 |
| `heebo.woff2` | `ofl/heebo/Heebo[wght].ttf` | `804ab16a8ff8` | 3.100 |

`scripts/build-bundled-fonts.py` rebuilds them. They are made to draw what Google served:

- **One file per family, where Google served one per alphabet.** `next/font/local` cannot set a `unicode-range`
  per file. Dropping an alphabet is not an option: its letters would turn into the fallback face mid-word.
- **Only the code points Google serves.** The upstream font has more, mostly combining marks; with them `ş`
  stops falling back to Arial and is built from `s` + cedilla instead.
- **No kerning between Hebrew and the space or a hyphen.** Google's split keeps them in separate files, so that
  kerning never applied. With it, 1,588 of 2,935 Hebrew strings of this app changed width in Rubik.
- **`src` names each weight on its own**, the faces Google declared. Heebo has no 600, so `font-semibold` on a
  public form draws at 700; a range such as `400 900` would change that.
- **`adjustFontFallback` is off and the fallback faces sit in `app/globals.css`**, with the values
  `next/font/google` generated. `next/font/local` would measure the file's default instance (Assistant's is
  ExtraLight 200, Rubik's Light 300), which shrinks the Arial that draws letters a face lacks: 89.41% instead of
  92.87% on Assistant.

Checked on 31.10.2026 against Google's files that day: every character at every weight we load has the same
outline and advance width, the dashboard and `/portal` are pixel-identical, and 6,451 strings of this app keep
their exact width in all three families.

Two differences remain, both in names with letters beyond Latin-1:

- A letter Assistant lacks but can build from its base and accent (`ź ń ć ż`) now draws in Assistant, at the
  right weight. Before, Google's split sent it to Arial mid-word. Removing the accents to undo this would break
  text stored in decomposed form.
- Kerning between Latin and extended-Latin letters now applies, as it would in any single font file.

## License

All three are under the SIL Open Font License 1.1: `OFL-Assistant.txt`, `OFL-Rubik.txt`, `OFL-Heebo.txt`, the
upstream files, unchanged. The OFL allows bundling them with software, modified or not, as long as the license
stays beside them. Assistant reserves the font name "Source" (from Source Sans Pro), which these files do not use.
