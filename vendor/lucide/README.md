# Lucide SVG subset

- Source: [Lucide 1.51.0](https://github.com/lucide-icons/lucide/releases/tag/1.51.0), commit `45b0e148db4ee4d748340d0f99982aa1c2159d52`.
- Checked: 2026-10-04 Asia/Seoul. GitHub latest release still resolved to this tag/commit.
- License: [ISC and the included Feather MIT notices](LICENSE). Both are retained in full.
- Only the 13 original SVGs in `icons/` are retained, with SHA-256 values in [UPSTREAM.json](UPSTREAM.json). No icon runtime or package dependency is installed.
- `assets/design-social/ui.js` embeds their inner SVG geometry. The shared renderer retains the 24×24 viewBox, 2-unit rounded stroke and uses a 20×20 CSS pixel menu icon centered in a 44×44 target. Text-adjacent icons may use 16/18px. Geometry is neither stretched nor replaced with font glyphs.
- All copies here are upstream originals. Updating embedded geometry requires updating this source record and license notices together. The existing bookmark fill and brief save animation are app states, not changes to the original SVG.

This subset replaces the preview's hand-drawn paths because its quote is recognizable and its shared proportions, rounded corners and baseline are more consistent. The standalone prototype continues to load icons locally; there are no browser requests to Lucide or a CDN.
