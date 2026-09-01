# Cunstruct JSON Contracts

These are the stable boundary between the external drawing-analysis/audit layer
(today: ChatGPT, manually copy-pasted) and Cunstruct (the deterministic
consumer). They are **provider-agnostic** — Cunstruct never knows or cares
whether the JSON came from ChatGPT, a human, CAD/BIM, or a future integration.

There is **no AI, PDF parsing, OCR, or drawing interpretation inside
Cunstruct.** Cunstruct only parses, validates, normalises and displays.

---

## 1. Analysis Input JSON  → `parseAnalysisJson` (`src/lib/analysisJson.ts`)

Produced by analysing the drawings externally. Converts into BOQ lines. Aliases
are accepted (see below) so existing exports keep working.

```json
{
  "project": { "project_type": "Residential", "name": "Srikakulam Apartments" },
  "items": [
    {
      "scope": "Finishes",
      "category": "Flooring",
      "item": "Vitrified floor finish",
      "location": "First Floor",
      "quantity": 1200,
      "unit": "sqft",
      "measurement_method": "AREA",
      "status": "MEASURED",
      "source": "First Floor Plan",
      "basis": "Sum of room areas",
      "confidence": "HIGH",
      "specification": "600x600 vitrified, matte",
      "reason": null,
      "formula": "Σ(L×W per room)",
      "external_key": "FF-FLR-01"
    },
    {
      "item": "Kitchen counter",
      "category": "Kitchen",
      "location": "Kitchen",
      "quantity": null,
      "measurement_method": "LENGTH",
      "status": "PENDING",
      "reason": "Running length not dimensioned on the plan"
    }
  ]
}
```

- Array key: `items` (also accepts `requirements`, `analysis`, or a bare array).
- Item name: `item` (also `requirement`, `name`, `description`).
- Quantity: `quantity` (also `qty`). **A missing / null / non-numeric quantity is
  kept as PENDING — never coerced to 0 or 1.**
- Location: `location` (also `allocation`).
- `measurement_method` / `status` accept the canonical enums (below) and common
  aliases (`sqft`→AREA, `rft`→LENGTH, `cum`→VOLUME, `kg`→WEIGHT, …). Unknown
  values fall back to a deterministic classification by item name and raise a
  warning; they never hard-fail the import.

## 2. Audit JSON  → `parseAuditJson` (`src/lib/auditJson.ts`)

Produced by auditing a generated BOQ against the drawings. See
`chatgpt-boq-audit-prompt.md` for the copy-paste prompt that yields this.

```json
{
  "audit": {
    "status": "ISSUES_FOUND",
    "findings": [
      {
        "finding_type": "MISSING_ITEM",
        "action": "ADD",
        "scope": "Finishes", "category": "Flooring", "item": "Floor finish",
        "location": "First Floor",
        "reason": "Shown on the plan but absent from the BOQ",
        "evidence": "First Floor Plan"
      },
      {
        "finding_type": "METHODOLOGY_ERROR",
        "action": "CHANGE_METHOD",
        "scope": "Joinery", "category": "Kitchen", "item": "Kitchen Counter",
        "current_value": "1 nos",
        "recommended_method": "LENGTH", "recommended_unit": "rft"
      }
    ]
  }
}
```

- Wrapper: `{ "audit": { … } }` (also accepts a bare `{ status, findings }` or a
  bare findings array).
- `status`: `PASS` | `ISSUES_FOUND`. `PASS` with `findings: []` is valid.
- Unknown `finding_type` → recorded as `OTHER` with a warning (not rejected).

## 3. Canonical enums

**Quantity methodology** (`QuantityMethod`, `src/lib/quantityMethod.ts`):
`COUNT · AREA · LENGTH · VOLUME · WEIGHT · COVERAGE · DERIVED · SPECIFICATION · PENDING`

**Quantity status** (`QuantityStatus`):
`MEASURED · COUNTED · DERIVED · ESTIMATED · PENDING · NOT_APPLICABLE`

**Finding type** (`FindingType`, `src/lib/auditJson.ts`):
`MISSING_ITEM · MISSING_SCOPE · QUANTITY_PENDING · QUANTITY_ERROR ·
METHODOLOGY_ERROR · UNIT_ERROR · DUPLICATE_ITEM · MISSING_SPECIFICATION ·
INSUFFICIENT_EVIDENCE · OTHER`

**Finding action** (advisory only — never auto-applied):
`ADD · REMOVE · MARK_PENDING · CHANGE_METHOD · CHANGE_UNIT · CHANGE_QTY ·
ADD_SPECIFICATION · REVIEW · OTHER`

**Finding lifecycle** (`FindingState`, user-driven):
`OPEN · ACCEPTED · DISMISSED · RESOLVED · KEPT_PENDING`

## 4. Guarantees

- **Never fabricates.** A missing quantity stays PENDING; "1 nos" is never a
  fallback.
- **Deterministic.** Same input → same output; no network, no model calls.
- **Non-destructive.** Importing an audit never edits the BOQ. Findings are a
  review layer the user resolves.
