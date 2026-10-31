#!/usr/bin/env python3
"""Rebuilds the fonts in app/fonts (why they are built this way: app/fonts/README.md).

  pip install fonttools brotli
  python3 scripts/build-bundled-fonts.py

Each file = the upstream variable font, cut to the code points Google serves for that family,
with hinting dropped and the kerning across Hebrew and other alphabets removed, as in Google's files.
"""
import re
import tempfile
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent.parent / "app" / "fonts"
UPSTREAM = "https://raw.githubusercontent.com/google/fonts/{commit}/ofl/{dir}/{file}%5Bwght%5D.ttf"
# The user agent next/font/google sent: it decides the files Google answers with.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36"
FAMILIES = {
    "assistant": ("Assistant", "89c9db015089", "400;500;600;700"),
    "rubik": ("Rubik", "765b99f8e53c", "500;600;700"),
    "heebo": ("Heebo", "804ab16a8ff8", "400;500;700;800;900"),
}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request) as response:
        return response.read()


def google_files(family: str, weights: str, into: Path) -> dict[str, TTFont]:
    """Google's own file per alphabet, by subset name."""
    css = fetch(f"https://fonts.googleapis.com/css2?family={family}:wght@{weights}&display=swap").decode()
    files = {}
    for name, url in re.findall(r"/\* (.+?) \*/\s*@font-face \{.*?url\((.+?)\)", css, re.S):
        if name not in files:
            path = into / f"{family}-{name}.woff2"
            path.write_bytes(fetch(url))
            files[name] = TTFont(path)
    return files


def drop_cross_alphabet_kerning(font: TTFont, hebrew_file: TTFont, latin_file: TTFont) -> int:
    """Google's split keeps a Hebrew letter and a space or hyphen in separate files, so their kerning never applies."""
    hebrew = set(hebrew_file.getGlyphOrder()) - set(latin_file.getGlyphOrder())
    gpos = font["GPOS"].table
    features = gpos.FeatureList.FeatureRecord

    def kern_lookups(*scripts: str) -> set[int]:
        found = set()
        for record in gpos.ScriptList.ScriptRecord:
            if record.ScriptTag in scripts and record.Script.DefaultLangSys:
                for index in record.Script.DefaultLangSys.FeatureIndex:
                    if features[index].FeatureTag == "kern":
                        found |= set(features[index].Feature.LookupListIndex)
        return found

    removed = 0
    for index in kern_lookups("hebr") - kern_lookups("DFLT", "latn", "cyrl", "arab"):
        for table in gpos.LookupList.Lookup[index].SubTable:
            table = getattr(table, "ExtSubTable", table)
            if table.LookupType != 2:
                continue
            if table.Format == 1:
                kept = []
                for first, pairs in zip(table.Coverage.glyphs, table.PairSet):
                    before = len(pairs.PairValueRecord)
                    pairs.PairValueRecord = [p for p in pairs.PairValueRecord if first in hebrew and p.SecondGlyph in hebrew]
                    pairs.PairValueCount = len(pairs.PairValueRecord)
                    removed += before - pairs.PairValueCount
                    if pairs.PairValueRecord:
                        kept.append((first, pairs))
                table.Coverage.glyphs = [first for first, _ in kept]
                table.PairSet = [pairs for _, pairs in kept]
                table.PairSetCount = len(kept)
            else:
                cut = [g for g in table.Coverage.glyphs if g not in hebrew] + [g for g in table.ClassDef2.classDefs if g not in hebrew]
                removed += len(cut)
                table.Coverage.glyphs = [g for g in table.Coverage.glyphs if g in hebrew]
                table.ClassDef2.classDefs = {g: c for g, c in table.ClassDef2.classDefs.items() if g in hebrew}
    return removed


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        for out, (family, commit, weights) in FAMILIES.items():
            files = google_files(family, weights, Path(tmp))
            source = Path(tmp) / f"{family}.ttf"
            source.write_bytes(fetch(UPSTREAM.format(commit=commit, dir=out, file=family)))

            options = subset.Options()
            options.layout_features = ["*"]
            options.hinting = False
            options.name_IDs = ["*"]
            options.name_languages = ["*"]
            options.notdef_outline = True
            options.flavor = "woff2"
            font = subset.load_font(str(source), options)
            removed = drop_cross_alphabet_kerning(font, files["hebrew"], files["latin"])
            subsetter = subset.Subsetter(options)
            subsetter.populate(unicodes=sorted({c for f in files.values() for c in f.getBestCmap()}))
            subsetter.subset(font)
            subset.save_font(font, str(OUT / f"{out}.woff2"), options)
            print(f"{out}.woff2: {(OUT / f'{out}.woff2').stat().st_size} bytes, {len(font.getBestCmap())} code points, {removed} kerning entries removed")


if __name__ == "__main__":
    main()
