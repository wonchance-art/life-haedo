# MODEL-01 adapter provenance

Source thread: `01a14a22-281e-729e-8696-445cb0fe3092` (host `durable`).

`interest-analysis.partial.cjs` contains exactly recovered original source lines 1–248 from two command outputs in `/workspace/model-01-validation/recovery-thread.json`:
- Lines 1–144: `exec-7f840e71-d146-4b0c-b84e-30e90cfec231`, command `sed -n 1,190p assets/life/interest-analysis.js` (read-thread output truncated at 12000 characters).
- Lines 145–248: `exec-24f1fe1c-e964-4ee1-8c92-888a5c5a6069`, command `sed -n 145,248p assets/life/interest-analysis.js`.

`interest-analysis.cjs` is a **new validation candidate**, not an exact restoration of the prior adapter. Its first 248 lines were recovered; all lines after 248 were newly implemented to close question clustering, produce a profile-compatible analysis envelope, expose lifecycle APIs and close the module. The original missing tail is unavailable. Output ordering, question identifiers, analysis fingerprint, adapter name and disposal/export behavior after line 248 cannot be claimed to match the original. Subsequent lifecycle repairs may also modify the recovered prefix; compare the immutable partial file for the recovered original.

No files in `/workspace/life-haedo` were modified by this recovery.
