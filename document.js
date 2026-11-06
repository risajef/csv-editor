/* Bounded snapshots for reversible document commands. No browser dependencies. */
globalThis.DocumentHistory = class DocumentHistory {
  constructor(limit = 32, budget = 32 * 1024 * 1024) {
    this.limit = limit;
    this.budget = budget;
    this.past = [];
    this.future = [];
  }
  trim(stack) {
    let size = stack.reduce((sum, entry) => sum + entry.length * 2, 0);
    while (stack.length > 1 && (stack.length > this.limit || size > this.budget)) {
      size -= stack.shift().length * 2;
    }
  }
  remember(snapshot) {
    this.past.push(snapshot);
    this.trim(this.past);
    this.future = [];
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    this.trim(this.future);
    return this.past.pop();
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    this.trim(this.past);
    return this.future.pop();
  }
};

/* Structural commands mutate only document data and references, never the DOM. */
globalThis.DocumentModel = (() => {
  function maxColumns(rows) {
    return rows.reduce((width, row) => Math.max(width, row.length), 0);
  }

  function remapColumnReferences(document, columnMap) {
    document.filters = document.filters.filter(filter => columnMap.has(filter.column))
      .map(filter => ({ ...filter, column: columnMap.get(filter.column) }));
    document.sort = document.sort && columnMap.has(document.sort.column)
      ? { ...document.sort, column: columnMap.get(document.sort.column) } : null;
  }

  function reorderRow(document, fromIndex, targetIndex) {
    const [row] = document.rows.splice(fromIndex, 1);
    const insertionIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
    document.rows.splice(insertionIndex, 0, row);
    document.sort = null;
  }

  function reorderColumn(document, fromIndex, targetIndex) {
    const order = Array.from({ length: maxColumns(document.rows) }, (_, index) => index);
    const [moved] = order.splice(fromIndex, 1);
    const insertionIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
    order.splice(insertionIndex, 0, moved);
    // Missing positions must survive the permutation.
    document.rows = document.rows.map(row => order.map(index => row[index] ?? ""));
    document.colWidths = order.map(index => document.colWidths[index] || 160);
    remapColumnReferences(document, new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex])));
  }

  function insertRow(document, index = document.rows.length) {
    const width = Math.max(1, maxColumns(document.rows));
    document.rows.splice(index, 0, Array.from({ length: width }, () => ""));
  }

  function deleteRow(document, index) {
    document.rows.splice(index, 1);
  }

  function insertColumn(document, index = maxColumns(document.rows)) {
    if (!document.rows.length) document.rows.push([]);
    const map = Array.from({ length: maxColumns(document.rows) }, (_, col) => [col, col >= index ? col + 1 : col]);
    remapColumnReferences(document, new Map(map));
    document.rows.forEach(row => {
      while (row.length < index) row.push("");
      row.splice(index, 0, "");
    });
    document.colWidths.splice(index, 0, 160);
  }

  function deleteColumn(document, index) {
    const map = Array.from({ length: maxColumns(document.rows) }, (_, col) => [col, col > index ? col - 1 : col])
      .filter(([col]) => col !== index);
    remapColumnReferences(document, new Map(map));
    document.rows.forEach(row => row.splice(index, 1));
    document.colWidths.splice(index, 1);
  }

  function transpose(document) {
    const width = maxColumns(document.rows);
    document.rows = Array.from({ length: width }, (_, col) => document.rows.map(row => row[col] ?? ""));
    document.filters = [];
    document.sort = null;
    document.colWidths = Array.from({ length: maxColumns(document.rows) }, () => 160);
  }

  return Object.freeze({ maxColumns, remapColumnReferences, reorderRow, reorderColumn, insertRow, deleteRow, insertColumn, deleteColumn, transpose });
})();
