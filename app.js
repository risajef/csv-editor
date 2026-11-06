const LIMITS = Object.freeze({ text: 5 * 1024 * 1024, rows: 50000, columns: 500, cells: 1000000 });
const state = {
  sourceText: "",
  edited: false,
  dirty: false,
  textLength: 0,
  separatorChoice: "auto",
  separator: ",",
  rows: [],
  filters: [],
  sort: null,
  colWidths: [],
  rowHeights: [],
  heightUpdateQueued: false,
  drag: null,
  regexRevision: 0,
  page: 0,
  visibleCount: 0,
};

const history = new DocumentHistory();
let draftTimer;
let importRevision = 0;
let pendingReader = null;
let operationRevision = 0;
let pointerActive = false;
let editRefreshPending = false;
const DRAFT_KEY = "ideo-csv-draft-v1";
const DOCUMENT_FIELDS = ["rows", "filters", "sort", "colWidths", "separator", "separatorChoice", "sourceText", "edited", "dirty", "page", "textLength"];
const els = {
  spreadsheetText: document.querySelector("#spreadsheet-text"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  restoreDraft: document.querySelector("#restore-draft"),
  discardDraft: document.querySelector("#discard-draft"),
  draftStatus: document.querySelector("#draft-status"),
  previousPage: document.querySelector("#previous-page"),
  nextPage: document.querySelector("#next-page"),
  pageInfo: document.querySelector("#page-info"),
  operation: document.querySelector("#operation-status"),
  fileInput: document.querySelector("#file-input"),
  chooseFile: document.querySelector("#choose-file"),
  dropZone: document.querySelector("#drop-zone"),
  importPanel: document.querySelector("#import-panel"),
  importMeta: document.querySelector("#import-meta"),
  csvInput: document.querySelector("#csv-input"),
  loadPaste: document.querySelector("#load-paste"),
  sampleData: document.querySelector("#sample-data"),
  separator: document.querySelector("#separator"),
  validation: document.querySelector("#validation"),
  stats: document.querySelector("#table-stats"),
  tableWrap: document.querySelector("#table-wrap"),
  addFilter: document.querySelector("#add-filter"),
  filtersList: document.querySelector("#filters-list"),
  copyView: document.querySelector("#copy-view"),
  copyMarkdown: document.querySelector("#copy-markdown"),
  downloadView: document.querySelector("#download-view"),
  downloadXlsx: document.querySelector("#download-xlsx"),
};

const sample = `name,status,count,error
Ada,ok,12,
Grace,error,4,timeout
Linus,ok,18,
Katherine,ok,33,
Dennis,error,7,invalid input`;

const icons = {
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  close: "M18.3 5.71L12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.7 4.29 4.29l6.3 6.3 6.29-6.3 1.42 1.42z",
  sort: "M7 10l5-5 5 5H7zm0 4h10l-5 5-5-5z",
  sortAsc: "M7 14l5-5 5 5H7z",
  sortDesc: "M7 10h10l-5 5-5-5z",
  swap: "M7 7h11l-4-4 1.4-1.4L21.8 8l-6.4 6.4L14 13l4-4H7V7zm10 10H6l4 4-1.4 1.4L2.2 16l6.4-6.4L10 11l-4 4h11v2z",
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", icons[name]);
  svg.append(path);
  return svg;
}

const { parseCsv, detectSeparator, csvEscape, toCsv } = Csv;

function showStatus(message, error = false) {
  operationRevision += 1;
  els.operation.textContent = message;
  els.operation.className = `status-card ${error ? "warn" : ""}`;
}

async function runOperation(success, action) {
  const revision = ++operationRevision;
  try {
    await action();
    if (revision === operationRevision) showStatus(success);
    return true;
  } catch (error) {
    if (revision === operationRevision) showStatus(error.message || String(error), true);
    return false;
  }
}

function cancelImport() {
  importRevision += 1;
  if (pendingReader?.readyState === 1) pendingReader.abort();
  pendingReader = null;
}

function downloadBlob(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Keep the URL alive until the browser has consumed the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function assertDocumentSize(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (rows.length > LIMITS.rows || width > LIMITS.columns || rows.length * width > LIMITS.cells) {
    throw new Error("Document limit: 50,000 rows, 500 columns, and 1,000,000 cells.");
  }
}

function captureDocument() {
  return JSON.stringify(Object.fromEntries(DOCUMENT_FIELDS.map(key => [key, state[key]])));
}

function refreshHistory() {
  els.undo.disabled = !history.past.length;
  els.redo.disabled = !history.future.length;
}

function saveDraft() {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(DRAFT_KEY, captureDocument());
    els.draftStatus.textContent = "Recovery draft saved for this browser tab.";
  } catch { els.draftStatus.textContent = "Recovery draft unavailable; download your work before closing."; }
}

function scheduleDraft() {
  // Accessing the storage getter itself can throw in restricted origins.
  // Only the guarded save operation should read it.
  if (!("sessionStorage" in globalThis)) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 300);
}

function validateSnapshot(data) {
  const invalid = () => { throw new Error("Invalid recovery draft; the current document has been kept."); };
  if (!data || !Array.isArray(data.rows) || data.rows.some(row => !Array.isArray(row) || row.some(cell => typeof cell !== "string"))) invalid();
  assertDocumentSize(data.rows);
  const width = DocumentModel.maxColumns(data.rows);
  const validColumn = column => Number.isInteger(column) && column >= 0 && column < width;
  const operators = new Set(["equals", "not-equals", "empty", "not-empty", "regex", "gt", "gte", "lt", "lte"]);
  if (!Array.isArray(data.filters) || data.filters.some(filter => !filter || typeof filter.id !== "string" || !validColumn(filter.column) ||
    typeof filter.enabled !== "boolean" || typeof filter.value !== "string" || !operators.has(filter.operator))) invalid();
  if (data.sort !== null && (!data.sort || !validColumn(data.sort.column) || !["asc", "desc"].includes(data.sort.direction))) invalid();
  if (!Array.isArray(data.colWidths) || data.colWidths.some(width => !Number.isFinite(width) || width < 48 || width > 4000)) invalid();
  if (typeof data.sourceText !== "string" || data.sourceText.length > LIMITS.text || ![",", ";", "\t", "|"].includes(data.separator) ||
    !["auto", "tab", ",", ";", "|"].includes(data.separatorChoice) || typeof data.dirty !== "boolean" || typeof data.edited !== "boolean" ||
    !Number.isInteger(data.page) || data.page < 0) invalid();
  const length = data.rows.reduce((sum, row) => sum + row.reduce((n, cell) => n + cell.length, 0), 0);
  if (length > LIMITS.text) invalid();
}

function restoreSnapshot(snapshot) {
  cancelImport();
  const data = JSON.parse(snapshot);
  validateSnapshot(data);
  for (const key of DOCUMENT_FIELDS) if (Object.hasOwn(data, key)) state[key] = data[key];
  state.textLength = state.rows.reduce((sum, row) => sum + row.reduce((n, cell) => n + cell.length, 0), 0);
  invalidateRegex();
  recalculateAllRowHeights();
  els.csvInput.value = state.sourceText;
  els.separator.value = state.separatorChoice;
  refreshHistory();
  render();
}

function undo() {
  const snapshot = history.undo(captureDocument());
  if (snapshot !== null) { restoreSnapshot(snapshot); state.dirty = true; scheduleDraft(); }
}

function redo() {
  const snapshot = history.redo(captureDocument());
  if (snapshot !== null) { restoreSnapshot(snapshot); state.dirty = true; scheduleDraft(); }
}

function editDocument(mutate) {
  cancelImport();
  const before = captureDocument();
  try {
    mutate();
    assertDocumentSize(state.rows);
    state.textLength = state.rows.reduce((sum, row) => sum + row.reduce((n, cell) => n + cell.length, 0), 0);
    if (state.textLength > LIMITS.text) throw new Error("Document text limit: 5 MiB.");
    history.remember(before);
    state.edited = true;
    state.dirty = true;
    invalidateRegex();
    recalculateAllRowHeights();
    refreshHistory();
    scheduleDraft();
    render();
    return true;
  } catch (error) {
    restoreSnapshot(before);
    showStatus(error.message, true);
    return false;
  }
}

function loadText(text, choice = state.separatorChoice) {
  cancelImport();
  try {
    if (text.length > LIMITS.text) throw new Error("Import limit: 5 MiB of text.");
    const separator = choice === "auto" ? detectSeparator(text)
      : choice === "tab" ? "\t" : choice;
    const rows = parseCsv(text, separator);
    assertDocumentSize(rows);
    history.remember(captureDocument());
    invalidateRegex();
    state.sourceText = text;
    state.edited = false;
    state.dirty = true;
    state.textLength = rows.reduce((sum, row) => sum + row.reduce((n, cell) => n + cell.length, 0), 0);
    state.separatorChoice = choice;
    state.separator = separator;
    state.rows = rows;
    state.filters = [];
    state.sort = null;
    state.page = 0;
    resetTableSizes();
    els.csvInput.value = text;
    if (state.rows.length) els.importPanel.open = false;
    showStatus("");
    refreshHistory();
    scheduleDraft();
    render();
    return true;
  } catch (error) {
    showStatus(error.message, true);
    return false;
  }
}

function resetTableSizes() {
  state.colWidths = Array.from({ length: maxColumns() }, () => 160);
  recalculateAllRowHeights();
}

function maxColumns() {
  return DocumentModel.maxColumns(state.rows);
}

function colWidth(index) {
  return state.colWidths[index] || 160;
}

function rowHeight(index) {
  return state.rowHeights[index] || (index === 0 ? 28 : 26);
}

function estimateTextLines(value, width) {
  const text = String(value ?? "");
  if (!text) return 1;

  const usableWidth = Math.max(32, width - 18);
  const charsPerLine = Math.max(4, Math.floor(usableWidth / 7.2));

  return text.split(/\r?\n/).reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / charsPerLine));
  }, 0);
}

function longestLineLength(value) {
  return String(value ?? "").split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0);
}

function autoSizeColumn(index) {
  const maxLength = state.rows.reduce((longest, row) => Math.max(longest, longestLineLength(row[index])), headerName(index).length);
  setColumnWidth(index, Math.ceil(maxLength * 7.2) + 24);
  const col = els.tableWrap.querySelector(`[data-col-width="${index}"]`);
  if (col) col.style.width = `${state.colWidths[index]}px`;
  const table = els.tableWrap.querySelector("table");
  if (table) table.style.width = `${tableWidth()}px`;
  recalculateRenderedRowHeights();
  applyRowHeights();
  renderStats();
}

function layoutMetrics() {
  const columns = maxColumns();
  const base = baseTableWidth(columns);
  return { columns, extraWidth: Math.max(0, (els.tableWrap.clientWidth || 0) - base) / Math.max(1, columns) };
}

function estimateRowHeight(row, rowIndex, layout = layoutMetrics()) {
  if (rowIndex === 0) return 28;

  let lines = 1;
  const { columns, extraWidth } = layout;

  for (let col = 0; col < columns; col += 1) {
    lines = Math.max(lines, estimateTextLines(row[col], colWidth(col) + extraWidth));
  }

  return Math.max(26, lines * 18 + 8);
}

function recalculateAllRowHeights() {
  const layout = layoutMetrics();
  state.rowHeights = state.rows.map((row, index) => estimateRowHeight(row, index, layout));
}

function recalculateRowHeight(index, layout = layoutMetrics()) {
  if (!state.rows[index]) return;
  state.rowHeights[index] = estimateRowHeight(state.rows[index], index, layout);
}

function headerName(index) {
  const value = state.rows[0]?.[index]?.trim();
  return value || `Column ${index + 1}`;
}

function isNumericColumn(index) { return TableView.isNumericColumn(state.rows, index); }
function columnTypes(columns = maxColumns()) { return TableView.columnTypes(state.rows, columns); }
function validationMessage() { return TableView.validationMessage(state.rows); }

let regexJob = null;
let regexKey = null;
let regexMatches = new Map();
let regexPending = false;
let regexError = "";

function invalidateRegex() {
  state.regexRevision += 1;
  cancelRegex();
  regexKey = null;
}

function cancelRegex() {
  if (regexJob) { clearTimeout(regexJob.timer); regexJob.worker.terminate(); regexJob = null; }
  regexPending = false;
}

function prepareRegex() {
  const filters = state.filters.filter(filter => filter.enabled && filter.operator === "regex");
  const key = JSON.stringify([state.regexRevision, filters.map(({ id, column, value }) => [id, column, value])]);
  if (key === regexKey) return;
  cancelRegex();
  regexKey = key;
  regexMatches = new Map();
  regexError = "";
  if (!filters.length) return;
  if (typeof Worker === "undefined") { regexError = "Regex filtering needs browser worker support."; showStatus(regexError, true); return; }
  regexPending = true;
  showStatus("Matching regex… exports will be available when matching completes.");
  const finish = (message) => {
    if (regexJob !== job) return;
    cancelRegex();
    regexError = message.error || "";
    regexMatches = new Map((message.matches || []).map(result => [result.id, new Set(result.indices)]));
    showStatus(regexError || "Regex matching complete.", !!regexError);
    renderTable();
    renderStats();
  };
  let job;
  try {
    const worker = new Worker(new URL("regex-worker.js", document.baseURI));
    job = { worker, timer: null };
    regexJob = job;
    worker.onmessage = event => finish(event.data);
    worker.onerror = () => finish({ error: "Regex worker failed. Change or disable the regex filter." });
    job.timer = setTimeout(() => finish({ error: "Regex exceeded the 1 second limit. Change or disable the filter." }), 1000);
    worker.postMessage({ filters: filters.map(filter => ({ id: filter.id, pattern: filter.value,
      values: state.rows.slice(1).map(row => String(row[filter.column] ?? "")) })) });
  } catch (error) {
    if (job) cancelRegex();
    regexPending = false;
    regexError = `Regex worker unavailable: ${error.message}`;
    showStatus(regexError, true);
  }
}

function rowPassesFilters(row, rowIndex) {
  return TableView.rowPassesFilters(row, state.filters, rowIndex, regexMatches, !regexPending && !regexError);
}

function viewRows() {
  prepareRegex();
  return TableView.viewRows(state.rows, state.filters, state.sort, regexMatches, !regexPending && !regexError);
}

function viewDataRowsOnly() {
  const rows = viewRows();
  if (regexPending || regexError) throw new Error(regexError || "Wait for regex matching to complete.");
  return rows.map((item) => item.row);
}

function isInteractiveDragTarget(target) {
  return target instanceof Element && target.closest("button, textarea, input, select, .col-resizer");
}

function clearDragState() {
  state.drag = null;
  els.tableWrap.querySelectorAll(".dragging, .drag-over").forEach((element) => {
    element.classList.remove("dragging", "drag-over");
  });
}

function startDrag(event, type, index) {
  if (isInteractiveDragTarget(event.target)) {
    event.preventDefault();
    return;
  }

  state.drag = { type, index };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${type}:${index}`);
  }
  event.currentTarget.classList.add("dragging");
}

function allowDrop(event, type, index) {
  if (!state.drag || state.drag.type !== type || state.drag.index === index) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("drag-over");
}

function dropItem(event, type, index) {
  event.preventDefault();
  if (!state.drag || state.drag.type !== type || state.drag.index === index) {
    clearDragState();
    return;
  }

  const source = state.drag.index;
  clearDragState();
  if (type === "row") reorderRow(source, index);
  if (type === "column") reorderColumn(source, index);
}

function reorderRow(fromIndex, targetIndex) {
  if (fromIndex === 0 || targetIndex === 0 || fromIndex === targetIndex) return;
  return editDocument(() => DocumentModel.reorderRow(state, fromIndex, targetIndex));
}

function reorderColumn(fromIndex, targetIndex) {
  if (fromIndex === targetIndex) return;
  return editDocument(() => DocumentModel.reorderColumn(state, fromIndex, targetIndex));
}

function addFilter() {
  if (!state.rows.length) {
    editDocument(() => { state.rows = [["Column 1"], [""]]; state.colWidths = [160]; });
  }

  state.filters.push({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now() + Math.random()),
    enabled: true,
    column: 0,
    operator: "equals",
    value: "",
  });
  renderFilters();
  renderTable();
  renderStats();
}

function setFilter(id, patch) {
  state.filters = state.filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter));
  renderFilters();
  renderTable();
  renderStats();
}

function deleteFilter(id) {
  state.filters = state.filters.filter((filter) => filter.id !== id);
  renderFilters();
  renderTable();
  renderStats();
}

function operatorOptions(numeric, activeOperator) {
  const base = [
    ["equals", "equals"],
    ["not-equals", "not equals"],
    ["empty", "is empty"],
    ["not-empty", "is not empty"],
    ["regex", "matches regex"],
  ];
  const numberOps = [
    ["gt", ">"],
    ["gte", ">="],
    ["lt", "<"],
    ["lte", "<="],
  ];
  // Retain an existing comparison after edits change the inferred column type.
  // Its per-cell semantics remain explicit instead of showing an unrelated option.
  const retained = numberOps.filter(([value]) => value === activeOperator)
    .map(([value, label]) => [value, `${label} (numeric values only)`]);
  return numeric ? base.concat(numberOps) : base.concat(retained);
}

function renderFilters() {
  els.filtersList.innerHTML = "";
  const columns = maxColumns();
  if (!state.filters.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "No filters enabled.";
    els.filtersList.append(note);
    return;
  }

  for (const filter of state.filters) {
    const row = document.createElement("div");
    row.className = "filter-row";

    const toggle = document.createElement("label");
    toggle.className = "filter-toggle";
    toggle.title = filter.enabled ? "Filter enabled" : "Filter disabled";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.filterId = filter.id;
    checkbox.dataset.filterField = "enabled";
    checkbox.checked = filter.enabled;
    checkbox.setAttribute("aria-label", `Enable filter on ${headerName(filter.column)}`);
    checkbox.addEventListener("change", () => setFilter(filter.id, { enabled: checkbox.checked }));
    toggle.append(checkbox);

    const columnLabel = document.createElement("label");
    columnLabel.title = "Column";
    columnLabel.textContent = "Column";
    const column = document.createElement("select");
    column.dataset.filterId = filter.id;
    column.dataset.filterField = "column";
    for (let i = 0; i < columns; i += 1) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = headerName(i);
      option.selected = i === filter.column;
      column.append(option);
    }
    column.addEventListener("change", () => setFilter(filter.id, { column: Number(column.value), operator: "equals" }));
    columnLabel.append(column);

    const operatorLabel = document.createElement("label");
    operatorLabel.title = "Match";
    operatorLabel.textContent = "Match";
    const operator = document.createElement("select");
    operator.dataset.filterId = filter.id;
    operator.dataset.filterField = "operator";
    for (const [value, label] of operatorOptions(isNumericColumn(filter.column), filter.operator)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === filter.operator;
      operator.append(option);
    }
    operator.addEventListener("change", () => setFilter(filter.id, { operator: operator.value }));
    operatorLabel.append(operator);

    const valueLabel = document.createElement("label");
    valueLabel.title = "Value";
    valueLabel.textContent = "Value";
    const value = document.createElement("input");
    value.dataset.filterId = filter.id;
    value.dataset.filterField = "value";
    value.value = filter.value;
    value.disabled = filter.operator === "empty" || filter.operator === "not-empty";
    value.addEventListener("input", () => {
      filter.value = value.value;
      renderTable();
      renderStats();
    });
    valueLabel.append(value);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small-button icon-button danger";
    remove.append(icon("close"));
    remove.title = "Delete filter";
    remove.setAttribute("aria-label", `Delete filter on ${headerName(filter.column)}`);
    remove.addEventListener("click", () => deleteFilter(filter.id));

    row.append(toggle, columnLabel, operatorLabel, valueLabel, remove);
    els.filtersList.append(row);
  }
}

function renderValidation() {
  const message = validationMessage();
  els.validation.className = `status-card ${message.cls}`;
  els.validation.textContent = message.text;
}

function renderStats() {
  const visible = state.visibleCount;
  const total = Math.max(0, state.rows.length - (state.rows.length ? 1 : 0));
  const columns = maxColumns();
  const sepLabel = state.separator === "\t" ? "tab" : state.separator;
  els.stats.textContent = `${visible}/${total} data rows, ${columns} columns, separator "${sepLabel}"`;
  els.importMeta.textContent = state.rows.length
    ? `${state.rows.length} rows, ${columns} columns, separator "${sepLabel}"`
    : "Drop, choose, or paste data";
}

function setColumnWidth(index, width) {
  state.colWidths[index] = Math.max(48, Math.min(4000, width));
  const col = els.tableWrap.querySelector(`[data-col-width="${index}"]`);
  if (col) col.style.width = `${state.colWidths[index]}px`;
  const resizer = els.tableWrap.querySelector(`[data-resize-column="${index}"]`);
  if (resizer) resizer.setAttribute("aria-valuenow", String(state.colWidths[index]));
  const table = els.tableWrap.querySelector("table");
  if (table) table.style.width = `${tableWidth()}px`;
  queueRenderedRowHeightUpdate();
  scheduleDraft();
}

function resizeColumn(index, event) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = colWidth(index);
  const handle = event.currentTarget;
  handle.setPointerCapture(event.pointerId);
  const move = moveEvent => {
    if (moveEvent.pointerId === event.pointerId) setColumnWidth(index, startWidth + moveEvent.clientX - startX);
  };
  const stop = stopEvent => {
    if (stopEvent.pointerId !== event.pointerId) return;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}

function moveWithKeyboard(event, type, index) {
  if (event.target !== event.currentTarget || !event.altKey) return;
  const backward = type === "column" ? "ArrowLeft" : "ArrowUp";
  const forward = type === "column" ? "ArrowRight" : "ArrowDown";
  if (![backward, forward].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === backward ? -1 : 1;
  const destination = index + direction;
  const minimum = type === "row" ? 1 : 0;
  const count = type === "row" ? state.rows.length : maxColumns();
  if (destination < minimum || destination >= count) return;
  const target = direction < 0 ? destination : index + 2;
  const changed = type === "row" ? reorderRow(index, target) : reorderColumn(index, target);
  if (changed) {
    els.tableWrap.querySelector(`[data-${type}-handle="${destination}"]`)?.focus();
    showStatus(`${type === "row" ? "Row" : "Column"} moved to position ${destination + 1}.`);
  }
}

function tableWidth(columns = maxColumns()) {
  return Math.max(baseTableWidth(columns), els.tableWrap.clientWidth || 0);
}

function baseTableWidth(columns = maxColumns()) {
  return 44 + Array.from({ length: columns }, (_, index) => colWidth(index)).reduce((sum, width) => sum + width, 0);
}

function applyRowHeights() {
  els.tableWrap.querySelectorAll("tr[data-row-height]").forEach((tr) => {
    tr.style.height = `${rowHeight(Number(tr.dataset.rowHeight))}px`;
  });
}

function queueRenderedRowHeightUpdate() {
  if (state.heightUpdateQueued) return;
  state.heightUpdateQueued = true;
  requestAnimationFrame(() => {
    state.heightUpdateQueued = false;
    recalculateRenderedRowHeights();
    applyRowHeights();
  });
}

function recalculateRenderedRowHeights() {
  const layout = layoutMetrics();
  els.tableWrap.querySelectorAll("tr[data-row-height]").forEach((tr) => {
    const index = Number(tr.dataset.rowHeight);
    recalculateRowHeight(index, layout);
  });
}

function renderTable() {
  els.tableWrap.innerHTML = "";
  state.visibleCount = 0;
  prepareRegex();
  if (!state.rows.length) {
    els.pageInfo.textContent = "No data rows";
    els.previousPage.disabled = els.nextPage.disabled = true;
    const note = document.createElement("div");
    note.className = "empty-note";
    note.style.padding = "18px";
    note.textContent = "Load CSV data to start editing.";
    els.tableWrap.append(note);
    return;
  }

  const columns = maxColumns();
  const types = columnTypes(columns);
  const allRows = viewRows();
  state.visibleCount = Math.max(0, allRows.length - 1);
  for (const control of [els.copyView, els.copyMarkdown, els.downloadView, els.downloadXlsx]) control.disabled = regexPending || !!regexError;
  const pageSize = Math.max(1, Math.min(100, Math.floor(2000 / Math.max(1, columns))));
  const pages = Math.max(1, Math.ceil(state.visibleCount / pageSize));
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  const rows = allRows.slice(0, 1).concat(allRows.slice(1 + state.page * pageSize, 1 + (state.page + 1) * pageSize));
  els.pageInfo.textContent = `Page ${state.page + 1} of ${pages}. Exports include all matching rows.`;
  els.previousPage.disabled = state.page === 0;
  els.nextPage.disabled = state.page >= pages - 1;
  const table = document.createElement("table");
  table.setAttribute("aria-label", "CSV document");
  table.style.width = `${tableWidth(columns)}px`;
  const colgroup = document.createElement("colgroup");
  const rowCol = document.createElement("col");
  rowCol.style.width = "44px";
  colgroup.append(rowCol);
  for (let col = 0; col < columns; col += 1) {
    const colEl = document.createElement("col");
    colEl.dataset.colWidth = String(col);
    colEl.style.width = `${colWidth(col)}px`;
    colgroup.append(colEl);
  }
  table.append(colgroup);

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.dataset.rowHeight = "0";
  headRow.style.height = `${rowHeight(0)}px`;
  const corner = document.createElement("th");
  corner.className = "row-number";
  const cornerTools = document.createElement("div");
  cornerTools.className = "corner-tools";
  const transposeButton = document.createElement("button");
  transposeButton.type = "button";
  transposeButton.className = "small-button icon-button";
  transposeButton.append(icon("swap"));
  transposeButton.title = "Transpose table";
  transposeButton.setAttribute("aria-label", "Transpose table");
  transposeButton.addEventListener("click", transpose);
  const addRowButton = document.createElement("button");
  addRowButton.type = "button";
  addRowButton.className = "small-button icon-button";
  addRowButton.append(icon("add"));
  addRowButton.title = "Insert row";
  addRowButton.setAttribute("aria-label", "Append row");
  addRowButton.addEventListener("click", () => insertRow());
  cornerTools.append(transposeButton, addRowButton);
  corner.append(cornerTools);
  headRow.append(corner);

  for (let col = 0; col < columns; col += 1) {
    const th = document.createElement("th");
    th.draggable = true;
    th.className = "draggable-column";
    th.title = "Drag to move column. Focus and press Alt+Left or Alt+Right to move with the keyboard.";
    th.scope = "col";
    th.tabIndex = 0;
    th.dataset.columnHandle = String(col);
    th.setAttribute("aria-label", `Column ${col + 1}: ${headerName(col)}. Alt+Left or Alt+Right to move.`);
    th.setAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight");
    th.setAttribute("aria-sort", state.sort?.column === col ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none");
    th.addEventListener("keydown", event => moveWithKeyboard(event, "column", col));
    th.addEventListener("dragstart", (event) => startDrag(event, "column", col));
    th.addEventListener("dragover", (event) => allowDrop(event, "column", col));
    th.addEventListener("dragleave", (event) => event.currentTarget.classList.remove("drag-over"));
    th.addEventListener("drop", (event) => dropItem(event, "column", col));
    th.addEventListener("dragend", clearDragState);
    if (types[col]) th.classList.add("numeric");
    const content = document.createElement("div");
    content.className = "th-content";
    const title = document.createElement("div");
    title.className = "col-title";
    title.title = headerName(col);
    title.textContent = headerName(col);
    if (types[col]) {
      const pill = document.createElement("span");
      pill.className = "numeric-pill";
      pill.textContent = "N";
      pill.title = "Numeric column";
      content.append(pill);
    }
    const actions = document.createElement("div");
    actions.className = "cell-actions";

    const sort = document.createElement("button");
    sort.type = "button";
    sort.className = `small-button icon-button sort-button ${state.sort?.column === col ? "active" : ""}`;
    sort.append(icon(state.sort?.column === col ? (state.sort.direction === "asc" ? "sortAsc" : "sortDesc") : "sort"));
    sort.title = "Sort by this column";
    sort.setAttribute("aria-label", `Sort by ${headerName(col)}`);
    sort.addEventListener("click", () => {
      if (state.sort?.column !== col) {
        state.sort = { column: col, direction: "asc" };
      } else if (state.sort.direction === "asc") {
        state.sort = { column: col, direction: "desc" };
      } else {
        state.sort = null;
      }
      renderTable();
      renderStats();
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "small-button icon-button";
    add.append(icon("add"));
    add.title = "Insert column after";
    add.setAttribute("aria-label", `Insert column after ${headerName(col)}`);
    add.addEventListener("click", () => insertColumn(col + 1));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "small-button icon-button danger";
    del.append(icon("close"));
    del.title = "Delete column";
    del.setAttribute("aria-label", `Delete column ${headerName(col)}`);
    del.addEventListener("click", () => deleteColumn(col));

    const resizer = document.createElement("span");
    resizer.className = "col-resizer";
    resizer.title = "Drag to resize. Arrow keys resize; Enter or double-click fits content.";
    resizer.tabIndex = 0;
    resizer.dataset.resizeColumn = String(col);
    resizer.setAttribute("role", "separator");
    resizer.setAttribute("aria-orientation", "vertical");
    resizer.setAttribute("aria-label", `Resize column ${headerName(col)}`);
    resizer.setAttribute("aria-valuemin", "48");
    resizer.setAttribute("aria-valuemax", "4000");
    resizer.setAttribute("aria-valuenow", String(colWidth(col)));
    resizer.addEventListener("pointerdown", event => resizeColumn(col, event));
    resizer.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") autoSizeColumn(col);
      else setColumnWidth(col, colWidth(col) + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 50 : 10));
    });
    resizer.addEventListener("dblclick", (event) => {
      event.preventDefault();
      autoSizeColumn(col);
    });

    actions.append(sort, add, del);
    content.append(title, actions);
    th.append(content);
    th.append(resizer);
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const item of rows) {
    const tr = document.createElement("tr");
    tr.dataset.rowHeight = String(item.index);
    tr.style.height = `${rowHeight(item.index)}px`;
    const rowHead = document.createElement("th");
    rowHead.className = "row-number";
    rowHead.scope = "row";
    rowHead.draggable = item.index > 0;
    if (item.index > 0) {
      rowHead.classList.add("draggable-row");
      rowHead.title = "Drag to move row. Focus and press Alt+Up or Alt+Down to move with the keyboard.";
      rowHead.tabIndex = 0;
      rowHead.dataset.rowHandle = String(item.index);
      rowHead.setAttribute("aria-label", `Row ${item.index + 1}. Alt+Up or Alt+Down to move.`);
      rowHead.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
      rowHead.addEventListener("keydown", event => moveWithKeyboard(event, "row", item.index));
      rowHead.addEventListener("dragstart", (event) => startDrag(event, "row", item.index));
      rowHead.addEventListener("dragover", (event) => allowDrop(event, "row", item.index));
      rowHead.addEventListener("dragleave", (event) => event.currentTarget.classList.remove("drag-over"));
      rowHead.addEventListener("drop", (event) => dropItem(event, "row", item.index));
      rowHead.addEventListener("dragend", clearDragState);
    }
    const rowActions = document.createElement("div");
    rowActions.className = "row-actions";
    const rowLabel = document.createElement("span");
    rowLabel.textContent = String(item.index + 1);
    rowLabel.className = "row-label";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "small-button icon-button";
    add.append(icon("add"));
    add.title = "Insert row after";
    add.setAttribute("aria-label", `Insert row after row ${item.index + 1}`);
    add.addEventListener("click", () => insertRow(item.index + 1));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "small-button icon-button danger";
    del.append(icon("close"));
    del.title = "Delete row";
    del.setAttribute("aria-label", `Delete row ${item.index + 1}`);
    del.addEventListener("click", () => deleteRow(item.index));
    const rowTools = document.createElement("div");
    rowTools.className = "cell-actions row-cell-actions";
    rowTools.append(add, del);
    rowActions.append(rowLabel, rowTools);
    rowHead.append(rowActions);
    tr.append(rowHead);

    for (let col = 0; col < columns; col += 1) {
      const td = document.createElement("td");
      if (item.row.length !== columns) td.className = "cell-error";
      const input = document.createElement("textarea");
      input.value = item.row[col] ?? "";
      input.dataset.cell = `${item.index}:${col}`;
      input.setAttribute("aria-label", `Row ${item.index + 1}, ${headerName(col)}${item.index === 0 ? " (header)" : ""}`);
      let editing = false;
      input.addEventListener("input", () => {
        cancelImport();
        const oldValue = state.rows[item.index][col] ?? "";
        if (state.textLength - oldValue.length + input.value.length > LIMITS.text) {
          input.value = oldValue; showStatus("Document text limit: 5 MiB.", true); return;
        }
        if (!editing) { history.remember(captureDocument()); editing = true; refreshHistory(); }
        state.textLength += input.value.length - oldValue.length;
        state.edited = state.dirty = true;
        scheduleDraft();
        while (state.rows[item.index].length <= col) state.rows[item.index].push("");
        state.rows[item.index][col] = input.value;
        invalidateRegex();
        recalculateRowHeight(item.index);
        tr.style.height = `${rowHeight(item.index)}px`;
      });
      input.addEventListener("change", () => {
        editRefreshPending = true;
        // Let native focus navigation finish. Pointer actions flush after click,
        // so rendering cannot remove their target between pointerdown and click.
        setTimeout(flushEditRefresh, 0);
      });
      td.append(input);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  els.tableWrap.append(table);
  recalculateRenderedRowHeights();
  applyRowHeights();
}

function flushEditRefresh() {
  if (!editRefreshPending || pointerActive) return;
  render();
}

function render() {
  editRefreshPending = false;
  const active = document.activeElement;
  const selection = typeof active?.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
  const identity = active?.dataset ? { ...active.dataset, id: active.id } : {};
  renderValidation();
  renderFilters();
  renderTable();
  renderStats();
  let target;
  if (identity.cell) target = els.tableWrap.querySelector(`[data-cell="${identity.cell}"]`);
  else if (identity.filterId) target = Array.from(els.filtersList.querySelectorAll("[data-filter-id]"))
    .find(element => element.dataset.filterId === identity.filterId && element.dataset.filterField === identity.filterField);
  else if (identity.id) target = document.getElementById(identity.id);
  if (target && !target.disabled) {
    target.focus({ preventScroll: true });
    if (selection && typeof target.setSelectionRange === "function") target.setSelectionRange(...selection);
  }
}

function insertRow(index = state.rows.length) {
  return editDocument(() => DocumentModel.insertRow(state, index));
}

function deleteRow(index) {
  return editDocument(() => DocumentModel.deleteRow(state, index));
}


function insertColumn(index = maxColumns()) {
  return editDocument(() => DocumentModel.insertColumn(state, index));
}

function deleteColumn(index) {
  return editDocument(() => DocumentModel.deleteColumn(state, index));
}

function transpose() {
  return editDocument(() => DocumentModel.transpose(state));
}

function currentViewCsv() {
  return (els.spreadsheetText.checked ? Csv.toSpreadsheetCsv : toCsv)(viewDataRowsOnly(), state.separator);
}

const { markdownCell, xmlEscape, columnName, worksheetXml, crc32, createZip, createXlsx } = TableExport;
function currentViewMarkdown() { return TableExport.toMarkdown(viewDataRowsOnly()); }

function downloadView() {
  return runOperation("CSV download prepared.", () => {
    const rows = viewDataRowsOnly();
    const spreadsheet = els.spreadsheetText.checked;
    downloadBlob((spreadsheet ? Csv.toSpreadsheetCsv : toCsv)(rows, state.separator), "text/csv;charset=utf-8", spreadsheet ? "ideo-view-spreadsheet-text.csv" : "ideo-view.csv");
    if (!spreadsheet && rows.length === state.rows.length) { state.dirty = false; scheduleDraft(); }
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  const focused = document.activeElement;
  try {
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("Copy failed. Allow clipboard access or download the CSV.");
  } finally { textarea.remove(); focused?.focus(); }
}

function copyView() { return runOperation("CSV copied.", () => copyText(currentViewCsv())); }
function copyMarkdown() { return runOperation("Markdown copied.", () => copyText(currentViewMarkdown())); }

function downloadXlsx() {
  return runOperation("XLSX download prepared.", () => {
    const rows = viewDataRowsOnly();
    downloadBlob(createXlsx(rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "ideo-view.xlsx");
    if (rows.length === state.rows.length) { state.dirty = false; scheduleDraft(); }
  });
}

function readFile(file) {
  cancelImport();
  const revision = importRevision;
  if (file.size > LIMITS.text) { showStatus("Import limit: 5 MiB file.", true); return; }
  showStatus(`Reading ${file.name || "CSV file"}…`);
  const reader = new FileReader();
  pendingReader = reader;
  const fail = message => { if (revision === importRevision) { pendingReader = null; showStatus(message, true); } };
  reader.addEventListener("load", () => {
    if (revision !== importRevision) return;
    pendingReader = null;
    loadText(String(reader.result ?? ""));
  });
  reader.addEventListener("error", () => fail("File could not be read. Choose it again or paste its content."));
  reader.addEventListener("abort", () => fail("File read cancelled."));
  try { reader.readAsText(file); } catch (error) { fail(error.message); }
}

els.loadPaste.addEventListener("click", () => loadText(els.csvInput.value));
els.sampleData.addEventListener("click", () => {
  els.csvInput.value = sample;
  loadText(sample);
});
els.chooseFile.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files?.[0];
  if (file) readFile(file);
});
els.separator.addEventListener("change", () => {
  const previous = state.separatorChoice;
  const choice = els.separator.value;
  if (state.edited) {
    editDocument(() => {
      state.separatorChoice = choice;
      state.separator = choice === "tab" ? "\t" : choice === "auto" ? detectSeparator(state.sourceText) : choice;
    });
  } else {
    if (!loadText(state.sourceText, choice)) { state.separatorChoice = previous; els.separator.value = previous; }
  }
});
els.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropZone.classList.add("dragging");
});
els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("dragging"));
els.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropZone.classList.remove("dragging");
  const file = event.dataTransfer.files?.[0];
  if (file) readFile(file);
});
els.addFilter.addEventListener("click", addFilter);
els.downloadView.addEventListener("click", downloadView);
els.copyView.addEventListener("click", copyView);
els.copyMarkdown.addEventListener("click", copyMarkdown);
els.downloadXlsx.addEventListener("click", downloadXlsx);
els.previousPage.addEventListener("click", () => { state.page -= 1; renderTable(); renderStats(); });
els.nextPage.addEventListener("click", () => { state.page += 1; renderTable(); renderStats(); });
els.undo.addEventListener("click", undo);
els.redo.addEventListener("click", redo);
els.restoreDraft.addEventListener("click", () => {
  try {
    const snapshot = sessionStorage.getItem(DRAFT_KEY);
    if (!snapshot) return;
    const previous = captureDocument();
    restoreSnapshot(snapshot);
    history.remember(previous);
    state.dirty = true;
    refreshHistory();
    showStatus("Recovery draft restored.");
  } catch (error) { showStatus(`Draft could not be restored: ${error.message}`, true); }
});
els.discardDraft.addEventListener("click", () => {
  try { clearTimeout(draftTimer); sessionStorage.removeItem(DRAFT_KEY); els.restoreDraft.hidden = els.discardDraft.hidden = true; els.draftStatus.textContent = "Recovery draft discarded."; }
  catch (error) { showStatus(error.message, true); }
});
try { els.restoreDraft.hidden = els.discardDraft.hidden = !sessionStorage.getItem(DRAFT_KEY); }
catch { els.restoreDraft.hidden = els.discardDraft.hidden = true; els.draftStatus.textContent = "Recovery draft unavailable; download your work before closing."; }
window.addEventListener("beforeunload", event => {
  if (state.dirty) { saveDraft(); event.preventDefault(); event.returnValue = ""; }
});
document.addEventListener("pointerdown", () => { pointerActive = true; }, true);
document.addEventListener("click", () => { pointerActive = false; flushEditRefresh(); });
document.addEventListener("pointercancel", () => { pointerActive = false; flushEditRefresh(); });
document.addEventListener("pointerup", event => {
  // A click in this document follows pointerup in the same event sequence.
  // Releasing outside the document falls back to the window blur handler.
  if (event.target === document.documentElement) { pointerActive = false; flushEditRefresh(); }
});
window.addEventListener("blur", () => { pointerActive = false; flushEditRefresh(); });
refreshHistory();
window.addEventListener("resize", queueRenderedRowHeightUpdate);

render();
