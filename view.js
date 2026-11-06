/* Pure dataset validation, inference and filtered/sorted projections. */
globalThis.TableView = (() => {
  function isNumericColumn(rows, index) {
    const values = rows.slice(1).map((row) => row[index]).filter((value) => String(value ?? "").trim() !== "");
    return values.length > 0 && values.every((value) => Number.isFinite(Number(value)));
  }

  function columnTypes(rows, columns) {
    return Array.from({ length: columns }, (_, index) => isNumericColumn(rows, index));
  }

  function validationMessage(rows) {
    if (!rows.length) return { text: "No CSV loaded.", cls: "" };
    const lengths = rows.map((row) => row.length);
    const expected = lengths[0];
    const bad = lengths
      .map((length, index) => ({ length, index }))
      .filter((item) => item.length !== expected);

    if (!bad.length) {
      return { text: `Valid CSV: all ${rows.length} rows have ${expected} columns.`, cls: "ok" };
    }

    const preview = bad.slice(0, 4).map((item) => `row ${item.index + 1}: ${item.length}`).join(", ");
    return { text: `Length mismatch. Expected ${expected} columns; ${preview}.`, cls: "warn" };
  }

  function rowPassesFilters(row, filters, rowIndex, regexMatches = new Map(), regexReady = true) {
    return filters.every((filter) => {
      if (!filter.enabled) return true;
      const value = String(row[filter.column] ?? "");
      const needle = filter.value;

      if (filter.operator === "equals") return value === needle;
      if (filter.operator === "not-equals") return value !== needle;
      if (filter.operator === "empty") return value === "";
      if (filter.operator === "not-empty") return value !== "";
      if (filter.operator === "regex") return regexReady && !!regexMatches.get(filter.id)?.has(rowIndex);

      if (value.trim() === "" || String(needle).trim() === "") return false;
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

  function viewRows(rows, filters, sort, regexMatches = new Map(), regexReady = true) {
    const header = rows[0] ? [{ row: rows[0], index: 0, header: true }] : [];
    let data = rows.slice(1).map((row, offset) => ({ row, index: offset + 1 }));
    data = data.filter((item) => rowPassesFilters(item.row, filters, item.index, regexMatches, regexReady));

    if (sort) {
      const numeric = isNumericColumn(rows, sort.column);
      data.sort((a, b) => {
        const av = a.row[sort.column] ?? "";
        const bv = b.row[sort.column] ?? "";
        if (numeric) {
          const aMissing = String(av).trim() === "";
          const bMissing = String(bv).trim() === "";
          if (aMissing !== bMissing) return aMissing ? 1 : -1;
        }
        const result = numeric ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sort.direction === "asc" ? result : -result;
      });
    }

    return header.concat(data);
  }

  return Object.freeze({ isNumericColumn, columnTypes, validationMessage, rowPassesFilters, viewRows });
})();
