# Cunstruct design system (plan item D1)

Status: tokens, components, the reference page and the automated contrast checks are in `src/design/`. **Existing screens have not been migrated.** Everything here is additive and opt-in (`--ds-*` custom properties, `.ds-*` classes), so no current page looks or behaves differently. Adopting it screen by screen is follow-up work, starting with D2 (the prototype).

| Piece | File |
|---|---|
| Tokens (source of truth) | `src/design/tokens.ts` |
| CSS variables and classes | `src/design/tokens.css` (values mirror `tokens.ts`; a test fails if they drift) |
| Money and quantity formatting | `src/design/money.ts` |
| Status badge | `src/design/StatusBadge.tsx` (icons: `src/design/stateIcons.ts`) |
| Numeric cells | `src/design/MoneyCell.tsx`, `src/design/QuantityCell.tsx` |
| Non-drag alternatives | `src/design/DragAlternative.tsx` (`NumericNudge`, `ReorderButtons`) |
| Contrast maths | `src/design/contrast.ts` |
| Automated contrast gate | `src/design/contrast.test.ts` |
| Reference page | `src/pages/DesignSystem.tsx` at `/design-system` |

## Reference page: `/design-system`

The page shows every token, every state, the money and number formats, target sizes, the drag alternatives, a sample BOQ grid, and a drawing. The light and dark themes sit side by side. It also has a live table of every contrast pair.

- It is not linked from any navigation (storefront, `/app` or `/ops`).
- Who can see it: anyone in local development (`import.meta.env.DEV`). In a production build, only signed-in staff can see it (`useAuth().isStaff`, which means the `ops` or `admin` role). Everyone else gets the ordinary 404, so the route is not advertised. The page carries `noindex, nofollow`.
- It is registered on both the storefront and app route trees. `src/pages/DesignSystem.test.tsx` covers the gate.

## Principles and the WCAG 2.2 criteria behind them

### 1. Colour carries meaning, never alone (SC 1.4.1 Use of Color, A)

The UI chrome stays neutral. Colour is reserved for the semantic states below, and every state is shown with **colour, an icon and a text label** together. A user who cannot tell the colours apart still gets the icon and the word, and a screen reader reads the word. In `StatusBadge` the icon is `aria-hidden` and the visible label is the accessible text.

Two signals that are not colour still need words for assistive technology:

- **Strike-through:** an `EXCLUDED` cell also has screen-reader-only text, "(excluded)".
- **Em dash:** "—" for a missing value is announced as "No value", or as "Quantity pending" for `PENDING_QTY`.

### 2. Contrast (SC 1.4.3 Contrast (Minimum), AA, and SC 1.4.11 Non-text Contrast, AA)

- Text needs at least **4.5:1**. This covers body text, muted text, badge labels and state-tinted cell text.
- Icons, control boundaries, badge outlines, the focus ring and button fills need at least **3:1** against what is next to them.
- `contrast.test.ts` computes the WCAG relative-luminance ratio for every pair listed in `contrastPairs()`, in both themes. That is 106 pairs. **The test fails if any pair is below its threshold.**
  - It also checks the maths against reference values: black on white is 21:1, and `#767676` on white is 4.54:1.
  - It also checks that `tokens.css` declares exactly the values in `tokens.ts`.
- If you add a token that is drawn on a surface, add its pair to `contrastPairs()`.
- Decorative dividers (`--ds-divider`) carry no information, so they have no contrast requirement.

### 3. Targets of at least 24 × 24 CSS px (SC 2.5.8 Target Size (Minimum), AA)

- `MIN_TARGET_PX = 24` and `--ds-target-min: 24px`.
- The `.ds-target` class enforces `min-width` and `min-height` at that size.
- Design-system buttons default to 32 px.
- Status badges also have a minimum height of 24 px.

### 4. A non-drag alternative for every drag (SC 2.5.7 Dragging Movements, AA)

Every drag must also work with single clicks or taps and with the keyboard:

- **`NumericNudge`** is for drag-to-adjust values, such as scrubbing a number, dragging a measurement handle or resizing.
  - You can type a value. Indian grouping such as `12,34,567.5` is accepted, and junk is rejected with a message. Commas are accepted only as well-formed grouping, so `4,5` is rejected rather than read as 45.
  - You can also press −/+, or ArrowUp/ArrowDown (Shift multiplies the step by 10). Values are clamped to the min/max.
  - When the value is unresolved (`null`), −/+ are **disabled** until a value is typed, so the control never invents a quantity.
- **`ReorderButtons`** is for drag-to-reorder lists. It provides "Move *item* up" and "Move *item* down".

### 5. Light and dark themes; drawings always light

- Light is the default.
- `data-ds-theme="dark"` on a container switches its descendants to the dark palette.
- Wrap a drawing in `.ds-drawing` and it always resolves to the light palette (`color-scheme: light`), even inside a dark container. Construction drawings are authored black-on-white, and inverting them changes what line weights and hatches mean.
- Primary navy `--primary` `hsl(220 25% 14%)` and accent amber `--accent` `hsl(36 95% 54%)` are unchanged.
- The dark theme uses a light primary fill, because a navy fill on a near-black page would fail 3:1.

## Semantic states (shared contract with the prototype team)

| State | Colour | Icon (lucide) | Label |
|---|---|---|---|
| `VERIFIED_HUMAN` | green | check (`Check`) | Verified |
| `MACHINE_UNVERIFIED` | neutral grey, dotted outline | dotted circle (`CircleDashed`) | Not yet checked |
| `NEEDS_REVIEW` | amber: the existing `--accent` `hsl(36 95% 54%)` fill with navy text | triangle (`TriangleAlert`) | Needs review |
| `BLOCKING` | red | octagon (`OctagonAlert`) | Blocking |
| `PENDING_QTY` | amber outline | hourglass (`Hourglass`) | Quantity pending |
| `UNAVAILABLE` | grey | slash circle (`Ban`) | No evidence |
| `EXCLUDED` | muted, dashed outline, struck values | minus circle (`CircleMinus`) | Excluded |

Each state has four colour tokens per theme, each named `--ds-<state>-<part>`:

| Part | Used for | Contrast requirement |
|---|---|---|
| `fg` | Badge label and icon | 4.5:1 on `bg` |
| `bg` | Badge fill | — |
| `border` | Badge outline | 3:1 on the page and on the surface |
| `text` | State-tinted text directly on the surface (grid cells) | 4.5:1 |

`text` is separate from `fg` because `NEEDS_REVIEW` uses navy text on an amber fill. Navy on the dark surface would be about 1:1. The first run of the contrast test caught exactly this, and the separate `text` token fixed it.

Values are in `tokens.ts` (`THEMES`). The reference page shows each swatch with its measured ratio.

## Money and numbers

- **Grids:** `formatINR(n)` uses `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0})`.
  - Examples: `₹12,34,567`, `-₹1,500`.
  - A real zero is `₹0`. There is never a `-₹0`.
- **Summaries only:** `formatINRCompact(n)` gives lakh/crore with three significant figures, for example `₹4.82 Cr` and `₹38.6 L`.
  - From ₹100 Cr up it shows whole crores, for example `₹12,346 Cr`.
  - Below ₹1 L it falls back to the full format.
  - It rounds before choosing the unit, so ₹99,96,000 is `₹1.00 Cr`, not `₹100.0 L`.
- **Quantities:** `formatQuantity(n, decimals = 2)` uses en-IN grouping with a **fixed** number of decimals so columns line up, for example `12,34,567.50`.
- **Missing values:** `null`, `undefined`, `NaN` and ±∞ all render as **"—", never 0.** An unknown amount must never read as a real zero.
- **Layout:** numbers use `.ds-num`, which sets a monospace font stack plus `font-variant-numeric: tabular-nums`, right alignment and no wrapping. The monospace stack is required: DM Sans, the UI face, has no tabular figures, so `tabular-nums` alone does not line digits up (checked in Chromium by `e2e/designSystem.spec.ts`). `MoneyCell` and `QuantityCell` apply it.

## Other tokens

- **Spacing:** a 4 px grid (`SPACING`, `--ds-space-*`) with steps 0, 4, 8, 12, 16, 20, 24, 32, 40 and 48.
- **Radii:** `sm` 4, `md` 6, `lg` 12 and `pill`.
- **Type scale (size/line-height, px):**

  | Step | Size/line-height |
  |---|---|
  | xs | 12/16 |
  | sm | 14/20 |
  | base | 16/24 |
  | lg | 18/28 |
  | xl | 20/28 |
  | 2xl | 24/32 |

## Using it

```tsx
import { StatusBadge } from "@/design/StatusBadge";
import { MoneyCell } from "@/design/MoneyCell";
import { QuantityCell } from "@/design/QuantityCell";

<td className="text-right"><QuantityCell value={line.qty} unit="m³" state={line.qty == null ? "PENDING_QTY" : undefined} /></td>
<td className="text-right"><MoneyCell value={line.amount} /></td>
<td><StatusBadge state="NEEDS_REVIEW" /></td>
```

The components import `tokens.css` themselves. Its variables are defined on `:root`, so they work anywhere without a wrapper. Add `data-ds-theme="dark"` to a container to switch that area to dark.

## Known limitations

- The 24 px target rule is enforced by a class and checked in the component tests by class name. jsdom does not compute layout, so a real rendered-size check needs a browser test (Playwright). That test has not been added.
- Existing screens are not migrated. One drag is already in the product: BOQ reordering in `src/pages/ops/ProjectBoqs.tsx`. It has up/down buttons as its alternative, but they are `h-5` (20 px tall), below the 24 px minimum. This is recorded, not changed here.
- The dark theme is only used inside the design system (`data-ds-theme`). The app has no global theme switch.
