# Datasets: manifests, roles, intake and promotion rules

## Manifest (`cunstruct.dataset-manifest.v1`)
The schema is `DatasetManifest` in `src/lib/measurement-quality/datasetManifest.ts`. A manifest records the following.

**Dataset**
- `dataset_id` and `description`.
- `archive`: name and sha256.

**`files[]`, per source file**
- Name, **full** sha256, `status` (present or pending), and page count.
- `producer`: the CAD or export application, if known.
- `text_layer`: yes, no, partial or unknown.
- `content`: native-vector, mixed, raster-only or unknown.
- `scales`, `viewports` and `multiple_scales_on_one_sheet`.
- `pages_in_scope`.

**Annotations**
- Provenance, and an `independent` flag. The flag is true only when the annotations were prepared by someone other than the engine developer.
- Reviewer, verification date, reference file and its sha256.

**Role**
- `role`: one of development, validation, holdout, out-of-domain, exploratory.
- `modality`: native-vector or raster. A raster dataset is refused for the vector engine's `validation` purpose and accepted only for `raster-validation`, so raster results never mix with vector validation.
- `role_history[]`: a recorded decision for every role change.
- `release_authorization`: holdout only.

## Roles and what they permit (`assertUsable`)
| role | permitted purposes |
|---|---|
| development | development-benchmark, tuning, intake-diagnostic, review-packages, exploratory |
| validation | `validation` (native-vector datasets only), `raster-validation` (raster datasets only), intake-diagnostic, review-packages; **never tuning** |
| holdout | release-holdout only, and only with a recorded `release_authorization` naming the exact engine fingerprint; not even intake |
| out-of-domain | negative-test, intake-diagnostic, exploratory; never a measurement benchmark |
| exploratory | exploratory, intake-diagnostic |

Every CLI calls `assertUsable` before reading a file. `validate.ts` additionally refuses an engine whose fingerprint differs from the freeze manifest, and a reference whose hash differs from the manifest.

## Promotion rules (`changeRole` / `promotionError`)
1. **Validation → development** requires the recorded validation run that completed the validation role: its report and that report's sha256. A validation result cannot quietly become development data. The run is recorded first, and the change of role is a separate, dated decision with a named decider.
2. **Nothing can become a holdout once it has been looked at.**
3. **A holdout leaves its role only after its release evaluation.** It moves to validation or development.
4. **Out-of-domain → exploratory only.**
5. **Every change is appended to `role_history`, and the history must chain.** Each entry's `from` must equal the previous entry's `to`.

## Current datasets (private manifests: `sprint/datasets/*.manifest.json`)
| dataset | role | notes |
|---|---|---|
| W976646 | development | One native-vector AutoCAD PDF (5 pages). The other five "drawings" are raster scans, per the intake diagnostic. The Gold Set is developer-verified. |
| W975549 | validation, modality **raster** | Raster validation, kept separate from vector validation. Intake: all 7 drawing PDFs are raster-only. The guard refuses it as native-vector validation. |
| W342699 | out-of-domain | Negative test only. |
| W975387 | holdout | Only the archive hash is recorded. Not opened. |
| C-01, C-02 | validation | Files pending. R0 references are present (1de95f6 developer). |
| C-03 | holdout (frozen) | 1de95f6's designated holdout, kept frozen by owner instruction. Excluded from development and validation even if the file is present. |

## Intake diagnostic
Command:
```bash
npx vite-node --root . scripts/accuracy/mq/intake.ts --manifest <m.json> --root <dir> --out <private dir>
```
It is read-only, and it refuses a file whose sha256 differs from the manifest. It reports:
- per page: text runs and numeric runs; vector paths and segments; images with dpi and page coverage;
- transforms, including rotated or skewed ones; form XObjects; optional-content marks; scale notes;
- per document: producer and creator, and OCG count.

**Classification.**
- Page classes: native-vector, mixed, raster-only or insufficient-evidence.
- Document classes: the page classes, plus out-of-domain. Out-of-domain is taken from the manifest, never inferred.

Detecting OCGs, transforms or CAD metadata does **not** show that the engine handles them correctly.
