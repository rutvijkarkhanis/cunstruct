# Inputs for this benchmark — not stored in the repository

The drawings scored in this external test are third-party documents and are **not committed**:

| File (place here) | SHA-256 | Why it is not in the repository |
|---|---|---|
| `drawing-1.pdf` | `6ef6c85bf0cf43ea260e5a7e78bbbfaf08ef26586801a626a605ad3b0b1e7e72` | Third-party (Uttarakhand PWD standard drawings); redistribution permission not verified |
| `drawing-2.pdf` | `05d0a2c400fc3c029c366814d793af71dd70a0749dbfd58b60d7a3b1a1810abb` | ENARCH drawing with an explicit "must not be copied or reproduced" notice |

Nothing derived from either drawing is committed: the engine outputs
(`engine-output/drawing-*`) and the results write-up stay local. Only
`engine-version.sha256` (hashes of the frozen engine) is kept.

To re-run: obtain an authorized copy from the owner, place it here under the name above,
check `sha256sum <file>` against the table (stop if it differs), then run the extractor
unchanged (`scripts/drawing-ocr/drawing_ocr.py`).
Never commit the file or outputs that reproduce its content.
