# Ideo CSV Editor

A static, browser-only CSV editor. Import a UTF-8 file, drop a file, paste CSV, or load the sample. The first record is the header. Data stays in the browser; editing and export do not upload it.

## Run independently

Serve this checkout with any static HTTP server. For example, from the repository root:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/`. No build, package installation, account, or parent website is needed. Use HTTP rather than opening `index.html` as a local file so the regex worker can load. The editor has local theme defaults in `styles.css`; a host can optionally supply its CSS custom properties. An iframe is recommended when embedding it.

Publish the root HTML, CSS and JavaScript files together. The parent website's existing `*.js` staging rule includes the helper scripts and worker; this work does not update that website's staged assets or submodule pin.

## Editing and views

- Separator detection supports comma, semicolon, tab and pipe, including quoted multiline fields. Select a separator manually when detection is ambiguous. Invalid quoting reports a character position without replacing the current document.
- Incomplete records stay separate and receive a length-mismatch warning. Moving columns fills missing positions with empty cells so existing values retain their column meaning. Inserting a column beyond a short row pads up to the insertion position. Transpose fills missing cells.
- Before editing, changing the separator reparses the import source. After editing, it changes CSV output formatting while keeping edited cells intact. Undo can restore either operation.
- Filters combine with AND; each can be disabled without being deleted. Numeric comparisons skip missing/nonnumeric cells and blank thresholds. Numeric sorting puts blanks last in both directions. An existing numeric comparison remains available if a column later contains mixed data.
- Regex matching runs in a worker with a one-second deadline. Invalid or timed-out filters show an error. Change or disable them to resume exporting; exports are unavailable while matching is pending or failed.
- Pages contain at most 100 data rows and approximately 2,000 data cells. Copy/download includes **all** matching rows in their sorted order, including the header, regardless of the current page.

Import limits are 5 MiB per file, 5,242,880 text code units, 50,000 records including the header, 500 columns, and 1,000,000 cells measured as records × maximum width. Editing enforces the same document dimensions and text budget. These bounds keep local processing and history manageable; this is not a streaming editor for arbitrarily large files.

## Keyboard and pointer controls

- Tab/Shift+Tab moves through native controls and editable cells. Cell labels include the source record number and column name.
- Focus a column header and press Alt+Left/Alt+Right to move it one position.
- Focus a data row's numbered header and press Alt+Up/Alt+Down to move it in source order. Moving a row clears sorting; active filters remain enabled.
- Focus a column's resize separator. Left/Right changes width by 10 pixels; Shift changes it by 50. Enter fits content. Width is bounded between 48 and 4,000 pixels.
- Columns can also be resized with mouse, pen or touch. Double-click fits content. Row/column drag-and-drop remains available with a mouse.
- Undo/Redo restore document edits, structural operations and replacement imports. Native text undo remains available while editing a cell.

History keeps up to 32 snapshots per direction with an approximate 32 MiB budget per stack, retaining at least the newest snapshot. Filter/sort settings are included when a document snapshot is captured; toggling a filter or sort is not itself a document-undo command.

## Recovery

The editor debounces a recovery draft into browser **tab session storage**. After reloading the same tab, use **Restore recovery draft** to recover it or **Discard recovery draft** to delete it. A draft never automatically replaces the document. Closing the tab normally removes its session storage. Storage restrictions or quota failures are shown beside the recovery controls; download your work when recovery is unavailable.

An unload prompt is requested while work has not been fully downloaded. Copying a view, exporting only some rows, or using transformed spreadsheet CSV does not clear that state. A browser download action does not prove a file was retained on disk; keep the file yourself.

## Export policies

**CSV:** normal copy/download preserves cell text and uses the selected delimiter. It does not remove spreadsheet formulas. The optional **Spreadsheet text CSV** setting prefixes formula-like values with a quoted tab in CSV copy/download. That changes exported values, including negative numbers; leave it off for programmatic round trips. Spreadsheet handling varies, especially after saving/reopening CSV. For explicit text cells, prefer XLSX.

**Markdown:** cell text is literal. HTML and Markdown punctuation are encoded as character entities, and cell line breaks become `<br>`. Renderers that do not support HTML line breaks may display those breaks differently.

**XLSX:** cells are strings, preserving leading zeros and formula-like text. Whitespace and carriage returns are retained. Unsupported XML characters, unpaired surrogates and cells exceeding 32,767 characters produce a cell-addressed export error; the document is not changed. Download CSV or correct the indicated cell. The writer supports one worksheet and ZIP32 archives.

Clipboard access requires browser permission and generally a secure origin such as HTTPS or localhost. A denied write or failed fallback is reported; CSV download is also available.

## Checks

Node regression checks need no npm packages:

```sh
node --test --test-isolation=none tests/*.test.cjs
```

The optional real-browser suite uses Puppeteer available in this checkout or a parent directory (or supplied through `PUPPETEER_MODULE`):

```sh
node tests/browser-smoke.cjs
```

It starts a temporary loopback server, launches headless Chromium and cleans up both. It checks native focus/click interactions and worker matching/cancellation. It needs an environment that permits Chromium and loopback sockets. See [FIX_PROGRESS.md](FIX_PROGRESS.md) for completed fixes and verification details. The review's original requirements discussion remains in [requirements.md](requirements.md).

## Code boundaries

- `csv.js`: CSV lexer, delimiter sampling and CSV output policies.
- `document.js`: DOM-free structural commands, column-reference remapping and bounded history.
- `view.js`: DOM-free validation, numeric inference and filtered/sorted projections. Regex match sets are explicit inputs.
- `export.js`: DOM-free Markdown and XLSX/ZIP serializers.
- `regex-worker.js`: disposable regex evaluation.
- `app.js`: browser event lifecycle, transactional edits/recovery, worker coordination, pagination and DOM layout. It validates document limits and records history around document commands.

These are ordinary dependency-ordered browser scripts with one namespace per service, so the app remains buildless. Pure services can run under Node without document/window/clipboard/filesystem shims. No generated bundle or external runtime package is shipped.
