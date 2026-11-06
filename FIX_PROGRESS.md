# CSV Editor fix progress

Started 6 November 2026 from `ca95db6`. Each numbered fix is a separate subrepo commit containing its regression checks and progress entry. No parent-repository commit, staging, publishing, or deployment is part of this work.

Run regression checks with `node --test --test-isolation=none tests/*.test.cjs`.

## Review checklist

- [x] 1. Preserve incomplete CSV records; remove implicit repair.
- [x] 2. Preserve filter/sort references on column insertion.
- [x] 3. Preserve positions in ragged rows during structural edits.
- [x] 4. Remove input-sized argument spreads from export and maxima.
- [x] 5. Bound rendering work and input size.
- [x] 6. Diagnose CSV syntax and preserve empty records.
- [x] 7. Isolate regex evaluation with cancellation and errors.
- [x] 8. Produce valid worksheet XML or report unsupported content.
- [x] Numeric missing-value and operator semantics.
- [x] Undo, recovery, and explicit document state boundaries.
- [x] Import sequencing and operation error reporting.
- [x] Explicit spreadsheet-safe CSV export.
- [x] Literal Markdown cell export.
- [x] Accessible cells, filters, resizing, and movement.
- [x] Standalone theme and usage documentation.
- [ ] Architecture separation and final quality gate.

## Completed fixes

### 1 — Preserve imported record boundaries

Removed automatic folding of short rows into a preceding cell. Length validation now sees the original records. Added a Node regression harness and checks for an incomplete data record and an incomplete first data record. Validation: `node --test --test-isolation=none tests/*.test.cjs` passed (1 test).

### 2 — Keep column references aligned

Centralized reference remapping for insertion, deletion, and movement. Existing filters and sorting now follow their original column when a preceding column is inserted. Regression covers insertion → deletion → movement and deletion of the referenced column. Validation: 2 tests passed.

### 3 — Preserve missing-cell positions

Column permutations now materialize absent cells as empty strings; insertion pads only up to its target position. Imported ragged rows remain intact until an explicit structural operation needs those positions. Deletion and transpose retain positional meaning. Regression exercises movement, insertion, deletion and transpose on incomplete rows. Validation: 3 tests passed.

### 4 — Assemble ZIP output without argument spreads

Replaced per-byte number accumulation and unbounded `push(...data)` with typed-array chunks copied into one allocated output. Added ZIP32 boundary checks. Maxima use reductions, including column autofit and Markdown export. Regression generates a 3,000-row XLSX and independently checks CRCs, all XML parts, row count and final cell through Python; also exercises 150,000-row width and Markdown calculations. Validation: 4 tests passed.

### 5 — Bound rendering and import work

Hoisted dataset-width and layout calculations out of cell/row loops, reuse the rendered match count for statistics, and defer serialization while a cell is being typed. Pagination renders at most 100 data rows and approximately 2,000 data cells; exports retain the complete filtered/sorted view. Imports are checked before replacing state: 5 MiB text/files, 50,000 rows, 500 columns, and 1,000,000 rectangular cells. Regression verifies linear width scans, page boundaries, full-view exports and rejected imports retaining the old document. Validation: 6 tests passed. Parsing remains synchronous within the explicit text budget; regex isolation is the next dedicated fix.

### 6 — Parse CSV with explicit lexical states

Extracted a pure CSV module shared by detection, import and serialization. Quoting errors carry character offsets and reject import without changing the current document. Empty quoted records and actual blank records survive; serializers quote a one-cell empty record for round trips. Delimiter detection samples complete logical records, including multiline fields; UTF-8 BOM is handled. Regression covers all offered delimiters, CRLF, quoted newlines/quotes, malformed quotes and empty records. Validation: 7 tests passed.

### 7 — Cancel expensive regex matching

Moved matching into a disposable worker with a one-second termination deadline. Patterns compile once per request; errors are visible. New input cancels prior jobs, stale completions cannot replace the current matches, and export is blocked while matching is pending or failed. Browsers without workers show an explicit unavailable message. Regression covers worker results, invalid syntax, cancellation, stale messages and deadline termination. Validation: 9 tests passed. Deadline lifecycle is tested with a controllable timer; real-browser worker execution remains part of final QA.

### 8 — Validate worksheet text before export

XLSX export rejects XML-illegal characters, unpaired surrogates, overlong cells and excessive sheet dimensions with an actionable cell address where applicable. It retains Unicode, whitespace and carriage returns, and escapes literal OpenXML `_xNNNN_` sequences. Download failures are shown without altering data. Regression covers rejected controls/surrogates, cell-length bounds, literal escape sequences and visible errors. Validation: 10 tests passed. Ordinary strings remain explicit XLSX text cells.

### 9 — Distinguish missing numeric values from zero

Numeric comparisons now skip blank, whitespace-only and nonnumeric operands. Blank thresholds do not become zero. Numeric sorting puts missing values last in both directions. Validation: 11 tests passed, including zero-versus-missing comparisons and ascending/descending blank placement.

### 10 — Keep active operators visible after data-type changes

A numeric comparison remains the selected option when edits make its column mixed, with a “numeric values only” label explaining that blank/nonnumeric cells do not match. The dropdown no longer silently displays equality while running another comparison. Validation: 12 tests passed.

### 11 — Make document edits reversible and recoverable

Added a shared document-edit boundary with size validation, rollback, bounded undo/redo snapshots (up to 32 entries / approximately 32 MiB per stack, retaining at least the newest entry), and grouped cell edits. Imports, structural edits and delimiter changes are reversible. Import source remains separate from edited rows; changing the output delimiter after editing no longer reparses edited values. Debounced recovery snapshots use browser tab session storage, with explicit restore/discard controls and an unsaved-work unload guard. Quota/storage failures leave editing available and display recovery status. Regression covers delete/undo/redo, replacement imports, cell history, delimiter changes, oversized-command rollback and explicit draft recovery. Validation: 14 tests passed.

### 12 — Sequence imports and surface operation failures

A new import, paste, undo or document edit cancels pending file reads; obsolete callbacks cannot overwrite newer work. File read/abort failures preserve the document and report an actionable message. Clipboard rejection and fallback failure are caught, temporary controls are cleaned up, and late operation completions cannot hide newer status messages. Downloads share cleanup and delayed URL revocation, show failures, and clear the unload guard only when the complete document is included. Validation: 16 tests passed, including reversed read completion, paste superseding a file, read errors, clipboard denial, fallback failure and stale completion status.

### 13 — Make spreadsheet-oriented CSV export explicit

Added an opt-in “Spreadsheet text CSV” policy for CSV copy/download. Formula-like cells receive a quoted tab prefix, including whitespace-prefixed and full-width formula starters. Ordinary CSV remains lossless, editor data is untouched, and transformed downloads do not clear the unsaved-document guard. XLSX remains explicit string-cell export. This policy changes exported values and is not a universal guarantee across spreadsheet applications or save/reopen cycles; documentation will state that boundary. Validation: 17 tests passed.

### 14 — Export Markdown cells as literal text

Encode user HTML and Markdown punctuation as character entities; only generated line breaks become `<br>`. Pipes cannot create columns, links/images cannot become active syntax, and existing entities remain literal source text. CRLF, CR and LF are handled consistently. Validation: 18 tests passed, including HTML, links, emphasis, code, pipes and entities.

### 15 — Name generated controls and support keyboard/touch operations

Cells, filter toggles, deletion actions and table controls have explicit accessible names. Column headers expose sort state and row/column headers support Alt+arrow movement with focus restored to the moved handle. Focusable column separators expose current/minimum/maximum widths, Arrow keys resize, Enter fits content, and pointer capture supports touch/pen/mouse dragging and cancellation. Added visible focus styling. Validation: 19 Node regressions passed, including keyboard movement, selected filter names and width updates. Headless Chromium now launches with the required sandbox exception; browser interaction QA follows before final sign-off.

### 16 — Preserve actions and focus when leaving edited cells

Real Chromium testing exposed table reconstruction between pointerdown and click: edit-then-delete lost the delete action, while Tab navigation dropped focus onto the body. Edit refresh now waits until native focus navigation or the complete pointer click, then restores matching cell/filter focus and text selection. Added a reusable local browser smoke suite covering the exact failures, keyboard movement/resizing, undo and real regex-worker results, invalid patterns and one-second termination. Validation: 19 Node tests and the Chromium smoke suite passed (Chrome 131.0.6778.204). This is an additional defect confirmed during browser QA, committed independently of the accessibility changes.

### 17 — Make the checkout independently runnable

Removed the stylesheet request outside the subrepo. Existing local CSS defaults now supply the theme without a parent checkout. Added standalone serving instructions, data/shape policies, limits, recovery behavior, keyboard/pointer operations, export tradeoffs and test commands. Asset regression checks ensure referenced files ship locally and load before the controller. Validation: 20 Node tests and the Chromium smoke suite passed with no document/script/stylesheet HTTP failures. No parent staging, build or site files were changed.

### 18 — Separate document behavior from browser adapters

Extracted structural commands/reference remapping into `document.js`, projections/type inference/validation into `view.js`, and Markdown/XLSX serializers into `export.js`. `app.js` owns transaction validation/history and browser APIs; pure services receive their data explicitly and do not read controller state or DOM globals. Removed the redundant serialized-text mirror; original import text and current rows have distinct roles. Added DOM-free end-to-end service tests and history-budget checks. Validation: 22 Node tests and the Chromium smoke suite passed after extraction. Final independent workbook and broader interaction checks remain below.

### 19 — Keep recovery failures outside document transactions

Final edge-case checks found that a restricted browser origin can throw when the `sessionStorage` property is accessed, before a save attempt. Draft scheduling now defers that access to the guarded saver, so imports, edits and undo remain usable. Recovery snapshots are fully validated before assigning any document fields, rejecting incompatible/corrupt data without partially replacing current work. Validation: 24 Node tests passed, including a throwing storage getter and malformed recovery snapshots.

### 20 — Preserve focus while changing filter controls

Filter selection/toggle changes now use the same focus-preserving render boundary as document refreshes. Deleting a focused filter returns keyboard focus to Add filter; view changes also schedule recovery saves. The browser regression now exercises choosing a column, typing equality text, disabling the filter and deleting it, checking both exported matches and focused controls. Validation: 24 Node tests and the expanded Chromium smoke suite passed.
