# Tiptap 3.32.2 — D2 editor runtime

Pinned from the official npm registry on 2026-11-05. This is a generated browser IIFE (`HaedoTiptap`), not an upstream UMD distribution. The app loads the checked-in bundle without an installation/build step. The D2 phase 1 adapter is not yet connected to the production editor.

Rebuild in this directory with Node >=20:

```sh
npm ci --ignore-scripts
npm run build
```

`entry.mjs` selects the supported vanilla extensions, `package-lock.json` fixes all dependencies, and `build.mjs` generates the minified bundle, runtime licenses and size/SHA manifest. `LICENSES.txt` includes every dependency actually bundled. `tiptap.umd.min.js.LEGAL.txt` preserves esbuild's extracted notices. Do not ship `node_modules`.

Only document/paragraph/text, heading 1–2, bold/italic, flat lists, paragraph blockquotes, and undo/redo are used. The adapter adds local photo references, validated HTTP(S) links and AI spans. No React, CollaborationCaret, Markdown/marked, analytics or external runtime requests are included. Markdown parsing/serialization belongs to the existing restricted `PostMarkdown` codec, rather than a second Markdown grammar.

Source: https://github.com/ueberdosis/tiptap

Verification details: ../../docs/life-tools-design/open-source-review.md (D2 2026-11-05 section).
