const state = {
  rawText: "",
  separatorChoice: "auto",
  separator: ",",
  rows: [],
  filters: [],
  sort: null,
  colWidths: [],
  rowHeights: [],
  heightUpdateQueued: false,
};

const els = {
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

function detectSeparator(text) {
  const candidates = [",", ";", "\t", "|"];
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, 10);
  let best = { sep: ",", score: -1 };

  for (const sep of candidates) {
    const counts = lines.map((line) => parseCsvLine(line, sep).length);
    const nonSingle = counts.filter((count) => count > 1).length;
    const consistency = counts.length ? counts.length - new Set(counts).size : 0;
    const score = nonSingle * 10 + consistency;
    if (score > best.score) best = { sep, score };
  }

  return best.sep;
}

function activeSeparator() {
  if (state.separatorChoice === "tab") return "\t";
  if (state.separatorChoice === "auto") return detectSeparator(state.rawText);
  return state.separatorChoice;
}

function parseCsvLine(line, sep) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === sep && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell);
  return cells;
}

function parseCsv(text, sep) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === sep && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length || text.endsWith(sep)) {
    row.push(cell);
    rows.push(row);
  }

  const parsed = rows.filter((cells, index, allRows) => {
    const isTrailingEmpty = index === allRows.length - 1 && cells.length === 1 && cells[0] === "";
    return !isTrailingEmpty;
  });

  return repairUnquotedMultilineRows(parsed, sep);
}

function repairUnquotedMultilineRows(rows, sep) {
  const expected = rows.find((row) => row.length > 1)?.length || 0;
  if (!expected) return rows;

  const repaired = [];
  for (const row of rows) {
    const previous = repaired[repaired.length - 1];
    const canFold = previous && previous.length === expected && row.length !== expected && row.length < expected;

    if (canFold) {
      previous[previous.length - 1] += `\n${row.join(sep)}`;
    } else {
      repaired.push(row);
    }
  }

  return repaired;
}

function csvEscape(value, sep) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes("\n") || text.includes("\r") || text.includes(sep)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsv(rows, sep) {
  return rows.map((row) => row.map((cell) => csvEscape(cell, sep)).join(sep)).join("\n");
}

function loadText(text) {
  state.rawText = text;
  state.separator = activeSeparator();
  state.rows = parseCsv(text, state.separator);
  state.filters = [];
  state.sort = null;
  resetTableSizes();
  els.csvInput.value = text;
  if (state.rows.length) els.importPanel.open = false;
  render();
}

function resetTableSizes() {
  state.colWidths = Array.from({ length: maxColumns() }, () => 160);
  recalculateAllRowHeights();
}

function maxColumns() {
  return Math.max(0, ...state.rows.map((row) => row.length));
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
  const maxLength = Math.max(headerName(index).length, ...state.rows.map((row) => longestLineLength(row[index])));
  state.colWidths[index] = Math.max(48, Math.ceil(maxLength * 7.2) + 24);
  const col = els.tableWrap.querySelector(`[data-col-width="${index}"]`);
  if (col) col.style.width = `${state.colWidths[index]}px`;
  const table = els.tableWrap.querySelector("table");
  if (table) table.style.width = `${tableWidth()}px`;
  recalculateRenderedRowHeights();
  applyRowHeights();
  renderStats();
}

function estimateRowHeight(row, rowIndex) {
  if (rowIndex === 0) return 28;

  let lines = 1;
  const columns = maxColumns();
  const extraWidth = Math.max(0, tableWidth() - baseTableWidth()) / Math.max(1, columns);

  for (let col = 0; col < columns; col += 1) {
    lines = Math.max(lines, estimateTextLines(row[col], colWidth(col) + extraWidth));
  }

  return Math.max(26, lines * 18 + 8);
}

function recalculateAllRowHeights() {
  state.rowHeights = state.rows.map((row, index) => estimateRowHeight(row, index));
}

function recalculateRowHeight(index) {
  if (!state.rows[index]) return;
  state.rowHeights[index] = estimateRowHeight(state.rows[index], index);
}

function headerName(index) {
  const value = state.rows[0]?.[index]?.trim();
  return value || `Column ${index + 1}`;
}

function isNumericColumn(index) {
  const values = state.rows.slice(1).map((row) => row[index]).filter((value) => String(value ?? "").trim() !== "");
  return values.length > 0 && values.every((value) => Number.isFinite(Number(value)));
}

function columnTypes() {
  return Array.from({ length: maxColumns() }, (_, index) => isNumericColumn(index));
}

function validationMessage() {
  if (!state.rows.length) return { text: "No CSV loaded.", cls: "" };
  const lengths = state.rows.map((row) => row.length);
  const expected = lengths[0];
  const bad = lengths
    .map((length, index) => ({ length, index }))
    .filter((item) => item.length !== expected);

  if (!bad.length) {
    return { text: `Valid CSV: all ${state.rows.length} rows have ${expected} columns.`, cls: "ok" };
  }

  const preview = bad.slice(0, 4).map((item) => `row ${item.index + 1}: ${item.length}`).join(", ");
  return { text: `Length mismatch. Expected ${expected} columns; ${preview}.`, cls: "warn" };
}

function rowPassesFilters(row) {
  return state.filters.every((filter) => {
    if (!filter.enabled) return true;
    const value = String(row[filter.column] ?? "");
    const needle = filter.value;

    if (filter.operator === "equals") return value === needle;
    if (filter.operator === "not-equals") return value !== needle;
    if (filter.operator === "empty") return value === "";
    if (filter.operator === "not-empty") return value !== "";
    if (filter.operator === "regex") {
      try {
        return new RegExp(needle).test(value);
      } catch {
        return false;
      }
    }

    const left = Number(value);
    const right = Number(needle);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (filter.operator === "gt") return left > right;
    if (filter.operator === "gte") return left >= right;
    if (filter.operator === "lt") return left < right;
    if (filter.operator === "lte") return left <= right;
    return true;
  });
}

function viewRows() {
  const header = state.rows[0] ? [{ row: state.rows[0], index: 0, header: true }] : [];
  let data = state.rows.slice(1).map((row, offset) => ({ row, index: offset + 1 }));
  data = data.filter((item) => rowPassesFilters(item.row));

  if (state.sort) {
    const numeric = isNumericColumn(state.sort.column);
    data.sort((a, b) => {
      const av = a.row[state.sort.column] ?? "";
      const bv = b.row[state.sort.column] ?? "";
      const result = numeric ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return state.sort.direction === "asc" ? result : -result;
    });
  }

  return header.concat(data);
}

function viewDataRowsOnly() {
  return viewRows().map((item) => item.row);
}

function addFilter() {
  if (!state.rows.length) {
    state.rows = [["Column 1"], [""]];
    resetTableSizes();
    state.rawText = toCsv(state.rows, state.separator);
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

function operatorOptions(numeric) {
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
  return numeric ? base.concat(numberOps) : base;
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
    checkbox.checked = filter.enabled;
    checkbox.addEventListener("change", () => setFilter(filter.id, { enabled: checkbox.checked }));
    toggle.append(checkbox);

    const columnLabel = document.createElement("label");
    columnLabel.title = "Column";
    columnLabel.textContent = "Column";
    const column = document.createElement("select");
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
    for (const [value, label] of operatorOptions(isNumericColumn(filter.column))) {
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
  const visible = Math.max(0, viewRows().length - (state.rows.length ? 1 : 0));
  const total = Math.max(0, state.rows.length - (state.rows.length ? 1 : 0));
  const columns = maxColumns();
  const sepLabel = state.separator === "\t" ? "tab" : state.separator;
  els.stats.textContent = `${visible}/${total} data rows, ${columns} columns, separator "${sepLabel}"`;
  els.importMeta.textContent = state.rows.length
    ? `${state.rows.length} rows, ${columns} columns, separator "${sepLabel}"`
    : "Drop, choose, or paste data";
}

function resizeColumn(index, event) {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = colWidth(index);

  function move(moveEvent) {
    state.colWidths[index] = Math.max(72, startWidth + moveEvent.clientX - startX);
    const col = els.tableWrap.querySelector(`[data-col-width="${index}"]`);
    if (col) col.style.width = `${state.colWidths[index]}px`;
    const table = els.tableWrap.querySelector("table");
    if (table) table.style.width = `${tableWidth()}px`;
    queueRenderedRowHeightUpdate();
  }

  function stop() {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", stop);
  }

  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", stop);
}

function tableWidth() {
  return Math.max(baseTableWidth(), els.tableWrap.clientWidth || 0);
}

function baseTableWidth() {
  return 44 + Array.from({ length: maxColumns() }, (_, index) => colWidth(index)).reduce((sum, width) => sum + width, 0);
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
  els.tableWrap.querySelectorAll("tr[data-row-height]").forEach((tr) => {
    const index = Number(tr.dataset.rowHeight);
    recalculateRowHeight(index);
  });
}

function renderTable() {
  els.tableWrap.innerHTML = "";
  if (!state.rows.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.style.padding = "18px";
    note.textContent = "Load CSV data to start editing.";
    els.tableWrap.append(note);
    return;
  }

  const types = columnTypes();
  const rows = viewRows();
  const table = document.createElement("table");
  table.style.width = `${tableWidth()}px`;
  const colgroup = document.createElement("colgroup");
  const rowCol = document.createElement("col");
  rowCol.style.width = "44px";
  colgroup.append(rowCol);
  for (let col = 0; col < maxColumns(); col += 1) {
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
  transposeButton.addEventListener("click", transpose);
  const addRowButton = document.createElement("button");
  addRowButton.type = "button";
  addRowButton.className = "small-button icon-button";
  addRowButton.append(icon("add"));
  addRowButton.title = "Insert row";
  addRowButton.addEventListener("click", () => insertRow());
  cornerTools.append(transposeButton, addRowButton);
  corner.append(cornerTools);
  headRow.append(corner);

  for (let col = 0; col < maxColumns(); col += 1) {
    const th = document.createElement("th");
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
    add.addEventListener("click", () => insertColumn(col + 1));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "small-button icon-button danger";
    del.append(icon("close"));
    del.title = "Delete column";
    del.addEventListener("click", () => deleteColumn(col));

    const resizer = document.createElement("span");
    resizer.className = "col-resizer";
    resizer.title = "Drag to resize column. Double-click to fit content.";
    resizer.addEventListener("mousedown", (event) => resizeColumn(col, event));
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
    add.addEventListener("click", () => insertRow(item.index + 1));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "small-button icon-button danger";
    del.append(icon("close"));
    del.title = "Delete row";
    del.addEventListener("click", () => deleteRow(item.index));
    const rowTools = document.createElement("div");
    rowTools.className = "cell-actions row-cell-actions";
    rowTools.append(add, del);
    rowActions.append(rowLabel, rowTools);
    rowHead.append(rowActions);
    tr.append(rowHead);

    for (let col = 0; col < maxColumns(); col += 1) {
      const td = document.createElement("td");
      if (item.row.length !== maxColumns()) td.className = "cell-error";
      const input = document.createElement("textarea");
      input.value = item.row[col] ?? "";
      input.addEventListener("input", () => {
        while (state.rows[item.index].length <= col) state.rows[item.index].push("");
        state.rows[item.index][col] = input.value;
        state.rawText = toCsv(state.rows, state.separator);
        recalculateRowHeight(item.index);
        tr.style.height = `${rowHeight(item.index)}px`;
      });
      input.addEventListener("change", () => {
        renderValidation();
        renderFilters();
        renderTable();
        renderStats();
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

function render() {
  renderValidation();
  renderFilters();
  renderTable();
  renderStats();
}

function insertRow(index = state.rows.length) {
  const width = Math.max(1, maxColumns());
  const row = Array.from({ length: width }, () => "");
  state.rows.splice(index, 0, row);
  recalculateAllRowHeights();
  state.rawText = toCsv(state.rows, state.separator);
  render();
}

function deleteRow(index) {
  state.rows.splice(index, 1);
  state.rowHeights.splice(index, 1);
  state.rawText = toCsv(state.rows, state.separator);
  render();
}

function insertColumn(index = maxColumns()) {
  if (!state.rows.length) state.rows.push([]);
  state.rows.forEach((row) => row.splice(index, 0, ""));
  state.colWidths.splice(index, 0, 160);
  recalculateAllRowHeights();
  state.rawText = toCsv(state.rows, state.separator);
  render();
}

function deleteColumn(index) {
  state.rows.forEach((row) => row.splice(index, 1));
  state.colWidths.splice(index, 1);
  state.filters = state.filters
    .filter((filter) => filter.column !== index)
    .map((filter) => ({ ...filter, column: filter.column > index ? filter.column - 1 : filter.column }));
  if (state.sort?.column === index) state.sort = null;
  if (state.sort?.column > index) state.sort.column -= 1;
  recalculateAllRowHeights();
  state.rawText = toCsv(state.rows, state.separator);
  render();
}

function transpose() {
  const width = maxColumns();
  const height = state.rows.length;
  const next = [];
  for (let col = 0; col < width; col += 1) {
    const row = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
      row.push(state.rows[rowIndex]?.[col] ?? "");
    }
    next.push(row);
  }
  state.rows = next;
  state.filters = [];
  state.sort = null;
  resetTableSizes();
  state.rawText = toCsv(state.rows, state.separator);
  render();
}

function currentViewCsv() {
  return toCsv(viewDataRowsOnly(), state.separator);
}

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>");
}

function currentViewMarkdown() {
  const rows = viewDataRowsOnly();
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => markdownCell(row[index])));
  const header = normalized[0];
  const separator = Array.from({ length: width }, () => "---");
  const body = normalized.slice(1);
  return [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function downloadView() {
  const blob = new Blob([currentViewCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ideo-view.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function copyView() {
  await copyText(currentViewCsv());
}

async function copyMarkdown() {
  await copyText(currentViewMarkdown());
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function columnName(index) {
  let name = "";
  let number = index + 1;
  while (number > 0) {
    number -= 1;
    name = String.fromCharCode(65 + (number % 26)) + name;
    number = Math.floor(number / 26);
  }
  return name;
}

function worksheetXml(rows) {
  const sheetData = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          const ref = `${columnName(colIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetData}</sheetData>
</worksheet>`;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function writeUint16(bytes, value) {
  bytes.push(value & 255, (value >>> 8) & 255);
}

function writeUint32(bytes, value) {
  bytes.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const bytes = [];
  const central = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const offset = bytes.length;

    writeUint32(bytes, 0x04034b50);
    writeUint16(bytes, 20);
    writeUint16(bytes, 0);
    writeUint16(bytes, 0);
    writeUint16(bytes, 0);
    writeUint16(bytes, 0);
    writeUint32(bytes, crc);
    writeUint32(bytes, data.length);
    writeUint32(bytes, data.length);
    writeUint16(bytes, nameBytes.length);
    writeUint16(bytes, 0);
    bytes.push(...nameBytes, ...data);

    central.push({ nameBytes, dataLength: data.length, crc, offset });
  }

  const centralStart = bytes.length;
  for (const entry of central) {
    writeUint32(bytes, 0x02014b50);
    writeUint16(bytes, 20);
    writeUint16(bytes, 20);
    writeUint16(bytes, 0);
    writeUint16(bytes, 0);
    writeUint16(bytes, 0);
    writeUint16(bytes, 0);
    writeUint32(bytes, entry.crc);
    writeUint32(bytes, entry.dataLength);
    writeUint32(bytes, entry.dataLength);
    writeUint16(bytes, entry.nameBytes.length);
    writeUint16(bytes, 0);
    writeUint16(bytes, 0);
    writeUint16(bytes, 0);
    writeUint16(bytes, 0);
    writeUint32(bytes, 0);
    writeUint32(bytes, entry.offset);
    bytes.push(...entry.nameBytes);
  }

  const centralSize = bytes.length - centralStart;
  writeUint32(bytes, 0x06054b50);
  writeUint16(bytes, 0);
  writeUint16(bytes, 0);
  writeUint16(bytes, central.length);
  writeUint16(bytes, central.length);
  writeUint32(bytes, centralSize);
  writeUint32(bytes, centralStart);
  writeUint16(bytes, 0);

  return new Uint8Array(bytes);
}

function createXlsx(rows) {
  return createZip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="CSV" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: worksheetXml(rows),
    },
  ]);
}

function downloadXlsx() {
  const blob = new Blob([createXlsx(viewDataRowsOnly())], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ideo-view.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

function readFile(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => loadText(String(reader.result ?? "")));
  reader.readAsText(file);
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
  state.separatorChoice = els.separator.value;
  state.separator = activeSeparator();
  state.rows = parseCsv(state.rawText, state.separator);
  state.filters = [];
  state.sort = null;
  resetTableSizes();
  render();
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
window.addEventListener("resize", queueRenderedRowHeightUpdate);

render();
