# Validation data: the next dataset, and how to run it

## Preferred characteristics
- **Native-vector, CAD-exported architectural PDFs.**
  - The text layer must be present.
  - The intake class must be `native-vector`, not raster scans.
  - A different exporter or CAD source from W976646 (AutoCAD 2017 via pdfplot13) is preferred, ideally Revit or ArchiCAD.
- **At least 50 clearly annotated linear dimensions** across several sheets.
- **Coverage of drawing types and conventions:**
  - Several scales, including at least one sheet carrying more than one viewport scale.
  - Horizontal and vertical dimensions, and preferably some oblique ones.
  - Grid-to-grid, grid-to-edge and edge-to-edge dimensions.
  - Wall faces and thicknesses, stairs and sections.
  - A mixture of terminators: ticks, arrowheads and dots.
  - Drawing conventions different from W976646's. W976646 uses filled-bar ticks, lines interrupted by their text, and geometry about 1.1% larger than printed.
- **References prepared by someone other than the engine developer.** Each reference dimension needs:
  - page, printed text and value, and unit or unit note;
  - text centre and both endpoints, in PDF points (top-left origin, y down);
  - the measured element at each end (`grid 7`, or a named face or edge);
  - a status: OK, CONFLICT, GEOMETRY-INCONSISTENT, NOT-DERIVABLE or ASSOCIATION-UNCERTAIN.

  The format is either the Gold Set JSON format (`items[]` with `kind: "linear_dimension"`) or the 1de95f6 R0 format. R0 has no element field, so association goes unscored.

## Runner: the only steps needed
1. Put the PDFs in a private directory, outside Git.
2. Write `<id>.manifest.json`. Required content:
   - full sha256 for every file;
   - role `validation`, with a `role_history` entry;
   - `pages_in_scope`;
   - the reference file's sha256;
   - `annotations.independent`.
3. Place the independently prepared reference file.
4. Run the frozen engine and the scorer:
   ```bash
   npx vite-node --root . scripts/accuracy/mq/validate.ts --manifest <id>.manifest.json --purpose validation \
     --root <pdf dir> --reference <reference.json> --freeze <ENGINE-FREEZE-MANIFEST.json> --out <private dir> --review-seed <int>
   ```
5. The runner then completes the run without further steps:
   - It records the engine fingerprint and dataset hashes in `run-record.json`.
   - It writes the per-stage report (`VALIDATION-REPORT.md`, with denominators), `ledger.json` and `metrics.json`.
   - With `--review-seed`, it builds blinded reviewer packages.
   - It verifies that neither the engine nor the reference changed during the run.

## Refusals (all tested on W976646, W975387 and C-01)
- The dataset's role forbids the purpose. For example: W976646 as validation, or any purpose on a holdout without a release authorization.
- The engine differs from the freeze manifest.
- A drawing or reference hash differs from the manifest.
- An in-scope file is missing.
- The output directory is inside the repository.

## After a validation run
- **The result is recorded before anyone looks for improvements.** The report and its hash go into the dataset's role history when, and only when, the owner decides to promote the dataset to development (see DATASETS.md).
- **No threshold is changed because of a validation result** without a new, separate validation set.
- **A single dataset never establishes generalization.**
