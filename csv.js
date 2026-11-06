/* Pure CSV parsing and serialization; no document or browser dependencies. */
globalThis.Csv = (() => {
  class CsvSyntaxError extends Error {
    constructor(message, offset) { super(`${message} at character ${offset + 1}.`); this.name = 'CsvSyntaxError'; this.offset = offset; }
  }
  function parseCsv(input, separator, maxRecords = Infinity) {
    if (typeof separator !== 'string' || separator.length !== 1 || /["\r\n]/.test(separator)) throw new Error('Invalid separator.');
    const text = input.startsWith('\uFEFF') ? input.slice(1) : input;
    const rows = [];
    let row = [], cell = '', mode = 'start', present = false;
    const field = () => { row.push(cell); cell = ''; mode = 'start'; present = false; };
    const record = () => { field(); rows.push(row); row = []; };
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (mode === 'quoted') {
        if (char === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 1; }
          else mode = 'closed';
        } else cell += char;
        continue;
      }
      if (char === separator) { field(); continue; }
      if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        record();
        if (rows.length >= maxRecords) return rows;
        continue;
      }
      if (mode === 'closed') throw new CsvSyntaxError('Unexpected content after closing quote', i);
      if (char === '"') {
        if (mode !== 'start') throw new CsvSyntaxError('Quote inside an unquoted field', i);
        mode = 'quoted'; present = true;
      } else { cell += char; mode = 'plain'; present = true; }
    }
    if (mode === 'quoted') throw new CsvSyntaxError('Unterminated quoted field', text.length);
    if (present || row.length || mode === 'closed') record();
    return rows;
  }
  function detectSeparator(text) {
    let best = { separator: ',', score: -1 };
    for (const separator of [',', ';', '\t', '|']) {
      try {
        const rows = parseCsv(text, separator, 10);
        const counts = rows.map(row => row.length);
        const score = counts.filter(count => count > 1).length * 10 + counts.length - new Set(counts).size;
        if (score > best.score) best = { separator, score };
      } catch { /* A candidate violating quoting rules is not a match. */ }
    }
    return best.separator;
  }
  function csvEscape(value, separator) {
    const text = String(value ?? '');
    return /["\r\n]/.test(text) || text.includes(separator) ? `"${text.replaceAll('"', '""')}"` : text;
  }
  function toCsv(rows, separator) {
    return rows.map(row => row.length === 1 && row[0] === '' ? '""' : row.map(cell => csvEscape(cell, separator)).join(separator)).join('\n');
  }
  return Object.freeze({ parseCsv, detectSeparator, csvEscape, toCsv, CsvSyntaxError });
})();
