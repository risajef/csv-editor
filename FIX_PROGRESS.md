# CSV Editor fix progress

Started 6 November 2026 from `ca95db6`. Each numbered fix is a separate subrepo commit containing its regression checks and progress entry. No parent-repository commit, staging, publishing, or deployment is part of this work.

Run regression checks with `node --test --test-isolation=none tests/*.test.cjs`.

## Review checklist

- [x] 1. Preserve incomplete CSV records; remove implicit repair.
- [x] 2. Preserve filter/sort references on column insertion.
- [x] 3. Preserve positions in ragged rows during structural edits.
- [ ] 4. Remove input-sized argument spreads from export and maxima.
- [ ] 5. Bound rendering work and input size.
- [ ] 6. Diagnose CSV syntax and preserve empty records.
- [ ] 7. Isolate regex evaluation with cancellation and errors.
- [ ] 8. Produce valid worksheet XML or report unsupported content.
- [ ] Numeric missing-value and operator semantics.
- [ ] Undo, recovery, and explicit document state boundaries.
- [ ] Import sequencing and operation error reporting.
- [ ] Explicit spreadsheet-safe CSV export.
- [ ] Literal Markdown cell export.
- [ ] Accessible cells, filters, resizing, and movement.
- [ ] Standalone theme and usage documentation.
- [ ] Architecture separation and final quality gate.

## Completed fixes

### 1 — Preserve imported record boundaries

Removed automatic folding of short rows into a preceding cell. Length validation now sees the original records. Added a Node regression harness and checks for an incomplete data record and an incomplete first data record. Validation: `node --test --test-isolation=none tests/*.test.cjs` passed (1 test).

### 2 — Keep column references aligned

Centralized reference remapping for insertion, deletion, and movement. Existing filters and sorting now follow their original column when a preceding column is inserted. Regression covers insertion → deletion → movement and deletion of the referenced column. Validation: 2 tests passed.

### 3 — Preserve missing-cell positions

Column permutations now materialize absent cells as empty strings; insertion pads only up to its target position. Imported ragged rows remain intact until an explicit structural operation needs those positions. Deletion and transpose retain positional meaning. Regression exercises movement, insertion, deletion and transpose on incomplete rows. Validation: 3 tests passed.
