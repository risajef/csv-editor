const state = {
  rawText: "",
  separatorChoice: "auto",
  separator: ",",
  rows: [],
  filters: [],
  sort: null,
};

const els = {
  fileInput: document.querySelector("#file-input"),
  dropZone: document.querySelector("#drop-zone"),
  csvInput: document.querySelector("#csv-input"),
  loadPaste: document.querySelector("#load-paste"),
  sampleData: document.querySelector("#sample-data"),
  separator: document.querySelector("#separator"),
  validation: document.querySelector("#validation"),
  stats: document.querySelector("#table-stats"),
  tableWrap: document.querySelector("#table-wrap"),
  addFilter: document.querySelector("#add-filter"),
  filtersList: document.querySelector("#filters-list"),
  clearFilters: document.querySelector("#clear-filters"),
  clearSort: document.querySelector("#clear-sort"),
  insertRow: document.querySelector("#insert-row"),
  insertColumn: document.querySelector("#insert-column"),
  transpose: document.querySelector("#transpose"),
  copyView: document.querySelector("#copy-view"),
  downloadView: document.querySelector("#download-view"),
};

const sample = `name,status,count,error
Ada,ok,12,
Grace,error,4,timeout
Linus,ok,18,
Katherine,ok,33,
Dennis,error,7,invalid input`;

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

  return rows.filter((cells, index, allRows) => {
    const isTrailingEmpty = index === allRows.length - 1 && cells.length === 1 && cells[0] === "";
    return !isTrailingEmpty;
  });
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
  render();
}

function maxColumns() {
  return Math.max(0, ...state.rows.map((row) => row.length));
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

    const columnLabel = document.createElement("label");
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

    const actions = document.createElement("div");
    actions.className = "filter-actions";
    const enabled = document.createElement("label");
    enabled.className = "inline-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = filter.enabled;
    checkbox.addEventListener("change", () => setFilter(filter.id, { enabled: checkbox.checked }));
    enabled.append(checkbox, " enabled");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small-button danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteFilter(filter.id));
    actions.append(enabled, remove);

    row.append(columnLabel, operatorLabel, valueLabel, actions);
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
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "row-number";
  corner.textContent = "#";
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
      pill.textContent = "number";
      title.append(document.createElement("br"), pill);
    }
    const actions = document.createElement("div");
    actions.className = "row-actions";

    const sort = document.createElement("button");
    sort.type = "button";
    sort.className = `small-button sort-button ${state.sort?.column === col ? "active" : ""}`;
    sort.textContent = state.sort?.column === col ? state.sort.direction : "Sort";
    sort.title = "Sort by this column";
    sort.addEventListener("click", () => {
      const direction = state.sort?.column === col && state.sort.direction === "asc" ? "desc" : "asc";
      state.sort = { column: col, direction };
      renderTable();
      renderStats();
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "small-button";
    add.textContent = "+";
    add.title = "Insert column after";
    add.addEventListener("click", () => insertColumn(col + 1));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "small-button danger";
    del.textContent = "x";
    del.title = "Delete column";
    del.addEventListener("click", () => deleteColumn(col));

    actions.append(sort, add, del);
    content.append(title, actions);
    th.append(content);
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const item of rows) {
    const tr = document.createElement("tr");
    const rowHead = document.createElement("th");
    rowHead.className = "row-number";
    const rowActions = document.createElement("div");
    rowActions.className = "row-actions";
    const rowLabel = document.createElement("span");
    rowLabel.textContent = String(item.index + 1);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "small-button";
    add.textContent = "+";
    add.title = "Insert row after";
    add.addEventListener("click", () => insertRow(item.index + 1));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "small-button danger";
    del.textContent = "x";
    del.title = "Delete row";
    del.addEventListener("click", () => deleteRow(item.index));
    rowActions.append(rowLabel, add, del);
    rowHead.append(rowActions);
    tr.append(rowHead);

    for (let col = 0; col < maxColumns(); col += 1) {
      const td = document.createElement("td");
      if (item.row.length !== maxColumns()) td.className = "cell-error";
      const input = document.createElement("textarea");
      input.value = item.row[col] ?? "";
      input.addEventListener("change", () => {
        while (state.rows[item.index].length <= col) state.rows[item.index].push("");
        state.rows[item.index][col] = input.value;
        state.rawText = toCsv(state.rows, state.separator);
        render();
      });
      td.append(input);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  els.tableWrap.append(table);
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
  state.rawText = toCsv(state.rows, state.separator);
  render();
}

function deleteRow(index) {
  state.rows.splice(index, 1);
  state.rawText = toCsv(state.rows, state.separator);
  render();
}

function insertColumn(index = maxColumns()) {
  if (!state.rows.length) state.rows.push([]);
  state.rows.forEach((row) => row.splice(index, 0, ""));
  state.rawText = toCsv(state.rows, state.separator);
  render();
}

function deleteColumn(index) {
  state.rows.forEach((row) => row.splice(index, 1));
  state.filters = state.filters
    .filter((filter) => filter.column !== index)
    .map((filter) => ({ ...filter, column: filter.column > index ? filter.column - 1 : filter.column }));
  if (state.sort?.column === index) state.sort = null;
  if (state.sort?.column > index) state.sort.column -= 1;
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
  state.rawText = toCsv(state.rows, state.separator);
  render();
}

function currentViewCsv() {
  return toCsv(viewDataRowsOnly(), state.separator);
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

async function copyView() {
  const text = currentViewCsv();
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
els.clearFilters.addEventListener("click", () => {
  state.filters = [];
  render();
});
els.clearSort.addEventListener("click", () => {
  state.sort = null;
  renderTable();
  renderStats();
});
els.insertRow.addEventListener("click", () => insertRow());
els.insertColumn.addEventListener("click", () => insertColumn());
els.transpose.addEventListener("click", transpose);
els.downloadView.addEventListener("click", downloadView);
els.copyView.addEventListener("click", copyView);

render();
