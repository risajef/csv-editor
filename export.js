/* Pure text and workbook serializers. Browser download/clipboard adapters live in app.js. */
globalThis.TableExport = (() => {
  function markdownCell(value) {
    // Entities keep user punctuation literal; only our generated line breaks are HTML.
    return String(value ?? "")
      .replace(/[&<>\\"'|`*_{}\[\]()#+.!~=\-]/g, char => `&#${char.codePointAt(0)};`)
      .replace(/\r\n|\r|\n/g, "<br>");
  }

  function toMarkdown(rows) {
    if (!rows.length) return "";
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => markdownCell(row[index])));
    const header = normalized[0];
    const separator = Array.from({ length: width }, () => "---");
    const body = normalized.slice(1);
    return [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
  }

  function xmlEscape(value) {
    const text = String(value ?? "");
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/u.test(text)) {
      throw new Error("contains a character unsupported by XML; remove it or export CSV instead.");
    }
    if (text.length > 32767) throw new Error("exceeds the XLSX limit of 32,767 characters per cell; export CSV instead.");
    return text
      .replace(/_x[0-9a-fA-F]{4}_/g, match => `_x005F_${match.slice(1)}`)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("\r", "&#13;");
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
    if (rows.length > 1048576 || rows.some(row => row.length > 16384)) throw new Error("XLSX sheet dimensions exceeded; export CSV instead.");
    const sheetData = rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, colIndex) => {
            const ref = `${columnName(colIndex)}${rowIndex + 1}`;
            let text;
            try { text = xmlEscape(value); } catch (error) { throw new Error(`Cell ${ref} ${error.message}`); }
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
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
    const chunks = [];
    const central = [];
    let offset = 0;
    const append = bytes => { chunks.push(bytes); offset += bytes.length; };
    if (files.length > 65535) throw new Error("Too many ZIP entries.");
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      if (name.length > 65535 || data.length > 0xffffffff) throw new Error("ZIP entry is too large.");
      const crc = crc32(data);
      const entryOffset = offset;
      const header = [];
      writeUint32(header, 0x04034b50);
      for (const value of [20, 0, 0, 0, 0]) writeUint16(header, value);
      for (const value of [crc, data.length, data.length]) writeUint32(header, value);
      writeUint16(header, name.length);
      writeUint16(header, 0);
      append(new Uint8Array(header));
      append(name);
      append(data);
      central.push({ name, length: data.length, crc, offset: entryOffset });
    }
    const centralStart = offset;
    for (const entry of central) {
      const header = [];
      writeUint32(header, 0x02014b50);
      for (const value of [20, 20, 0, 0, 0, 0]) writeUint16(header, value);
      for (const value of [entry.crc, entry.length, entry.length]) writeUint32(header, value);
      for (const value of [entry.name.length, 0, 0, 0, 0]) writeUint16(header, value);
      writeUint32(header, 0);
      writeUint32(header, entry.offset);
      append(new Uint8Array(header));
      append(entry.name);
    }
    const footer = [];
    writeUint32(footer, 0x06054b50);
    for (const value of [0, 0, central.length, central.length]) writeUint16(footer, value);
    writeUint32(footer, offset - centralStart);
    writeUint32(footer, centralStart);
    writeUint16(footer, 0);
    append(new Uint8Array(footer));
    if (offset > 0xffffffff) throw new Error("ZIP64 archives are not supported.");
    const result = new Uint8Array(offset);
    let position = 0;
    for (const chunk of chunks) { result.set(chunk, position); position += chunk.length; }
    return result;
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

  return Object.freeze({ markdownCell, toMarkdown, xmlEscape, columnName, worksheetXml, crc32, createZip, createXlsx });
})();
