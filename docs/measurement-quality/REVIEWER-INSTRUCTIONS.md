# Independent dimension review: instructions (reviewer {{REVIEWER}})

You have {{N}} items from the drawing `{{DRAWING}}`. The full PDF is included. Each item has a random code (`RV-XXXXXX`); the codes and their order mean nothing.

We are asking for **your own reading of the drawing**, as a professional would read it on site. There are no "expected" answers in this package, and nothing in it tells you what anyone else, or any software, decided.

## Before you start
- Work alone. Do not discuss items with anyone, including the other reviewer, until both of you have submitted.
- If you have seen any measurement software output for this drawing, tell the coordinator before you start.
- Do not open any other tool or file about this drawing.

## What you have
**`review-app.html` (recommended).** Open it in a web browser. It works offline.
- It shows each item, lets you zoom and pan, and records the points you click in PDF coordinates.
- It saves your answers in that browser as you go.
- Use **Export JSON** to back up your work or to submit it.
- If you work on another computer, use **Import JSON** to resume.

**For each item:**
- **`crops/RV-XXXXXX.png`**: a 600 × 600 pt window at 200 dpi.
- **`crops/RV-XXXXXX-context.png`**: a 1600 × 1600 pt window at 100 dpi, for the wider area: grids, walls, neighbouring dimensions. Long dimensions can run beyond the small crop, so use the context view or the PDF.
- **A magenta ring marks the printed text you are asked about.** The ring only identifies the text. It does not say whether the text is a dimension.
- **A ruler on every image** shows PDF points: labels every 50 pt and ticks every 10 pt on crops; every 100 pt on context and page images. The origin is the top-left of the page, and y increases downward.

**Also included:**
- `pages/page-N.png`: whole pages with the same ruler.
- `{{DRAWING}}`: the original PDF, for zooming as far as you need.
- `review-form.csv`: the same questions as a spreadsheet, if you prefer not to use the app. Page and ring position are filled in for you.

## Terms used
- **Dimension**: a printed value that states a length between two points on the drawing, shown with a dimension line.
- **Dimension line**: the line the value labels, usually parallel to the text, with an end mark at each end.
- **End mark**: the tick, slash, arrowhead or dot that ends the dimension. **Endpoint**: where the end mark meets the dimension line.
- **What an end measures to**: the element the endpoint is aligned with, usually by an extension line. For example: a grid line, a wall face, a column face, the edge of an opening, a slab or floor edge, a stair nosing.

## Questions for each item
1. **Is the ringed text the value of a linear dimension?** Answer yes, no or unsure.
   - These are not dimensions: grid labels, room or door tags, levels (LVL), scale notes, area figures, schedule entries, note numbers.
2. **Printed value and unit.**
   - Write the value exactly as printed, digits only.
   - For the unit: if the sheet has a note such as "All dimensions are in mm", use that unit. If no unit is stated anywhere, choose "none stated".
3. **Dimension line.** Click two points on it (Line pt A, Line pt B).
4. **Endpoints.** Click the two endpoints (End 1, End 2). About 1–2 pt accuracy is enough. Zoom in.
5. **What each end measures to.** For each end:
   - Choose a type: grid, wall-face, column-face, opening-edge, slab-or-floor-edge, stair, other-drawn-edge, other, cannot-tell.
   - Name it. For a grid, give its label (for example `7`). Otherwise use plain words (for example "outer face of south wall").
6. **Could a careful reader reasonably decide differently?**
   - If yes, say why. Examples: two equally close lines; a tick that may sit on the grid or on the face beside it; extension lines running both ways.
   - **Record ambiguity instead of guessing.**
7. **Does the drawing show enough to decide questions 1–5?** If not, answer "no".
   - Insufficient evidence is different from ambiguity, and different from a dimension that is simply wrong on the drawing. Note a wrong or conflicting dimension in the explanation.
8. **Confidence:**
   - **high**: you would set out on site from this reading;
   - **medium**: probably right, but one point needed judgement;
   - **low**: your best reading, but you could well be wrong.
9. **Explanation**: anything that helped you decide or troubled you. This includes a disagreement with another view of the same thing.

## Please do not
- Compute a value from the drawn geometry and enter it as the printed value.
- Correct the drawing.
- Leave questions 1, 6, 7 or confidence empty.
- Guess. Use "unsure", "cannot-tell", "ambiguous" or "evidence insufficient" instead.

## Submitting
- **Submit one of:** the exported JSON from the app, or the completed `review-form.csv`.
- **Your reviewer ID is already set:** `{{REVIEWER}}`. Do not change it.
- **After you submit, your file is locked** (its hash is recorded). Corrections after that go to the coordinator as a new, separately dated file. Your original is never overwritten.
