# Lucide SVG subset

- Source: [Lucide 1.51.0](https://github.com/lucide-icons/lucide/releases/tag/1.51.0), commit `45b0e148db4ee4d748340d0f99982aa1c2159d52`.
- Checked: 2026-10-04 Asia/Seoul. GitHub latest release still resolved to this tag/commit.
- License: [ISC and the included Feather MIT notices](LICENSE). Both are retained in full.
- No icon runtime, icon font or package dependency is installed, and pages never request Lucide or a CDN.

## Files

- The first 13 SVGs in `icons/` are GitHub originals with SHA-256 values in `files` of [UPSTREAM.json](UPSTREAM.json).
- 2026-11-02 (soft redesign A): 25 more SVGs were copied unchanged from `package/icons/` of the official npm tarball `lucide-static@1.51.0` (integrity and SHA-256 values in `npm_subset` of UPSTREAM.json). Each keeps the package's `@license lucide-static v1.51.0 - ISC` comment. The geometry of the 11 files present in both sources is identical.
- `assets/life/icons.js` embeds the geometry of 36 of these files and names the file for each glyph. `tests/icons.test.cjs` fails when an embedded geometry differs from its file here or a file is missing from UPSTREAM.json.
- The app draws them with one stroke width, 1.8, at 20px for controls and 16px inside text (decision 15 in [the redesign record](../../docs/design-review/write-read-redesign.md)). Geometry is neither stretched nor replaced with font glyphs. Changing the stroke width is a rendering choice, not a change to the original SVG.
- `sparkle.svg` is the AI 글 표시 glyph (PR #169). `quote.svg` and `arrow-left.svg` stay as provenance for the earlier standalone prototype `assets/design-social/ui.js`. Haedo's earlier quote A ([decision](../../docs/design-review/quote-options.md)) is no longer the shared quote glyph: decision 15 uses `text-quote` (lines and a vertical bar) for every quotation.

Updating any embedded geometry requires updating the file here, its hash in UPSTREAM.json and the license notices together.
