// Fast drop-in for make.fun csv-reader 1.0.0 — identical answers, less CPU than the house baseline.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let i = n !== 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  let fValue = "";
  let fEnded = 2;
  let fAdded = 0;

  function readUnquoted(base) {
    let value = base;
    let added = 0;
    let start = i;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) {
        if (i !== start) {
          value += text.slice(start, i);
          added += i - start;
        }
        i += 1;
        fValue = value;
        fEnded = 0;
        fAdded = added;
        return;
      }
      if (c === 10) {
        if (i !== start) {
          value += text.slice(start, i);
          added += i - start;
        }
        i += 1;
        line += 1;
        fValue = value;
        fEnded = 1;
        fAdded = added;
        return;
      }
      if (c === 13) {
        if (i !== start) {
          value += text.slice(start, i);
          added += i - start;
        }
        if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
          i += 2;
          line += 1;
          fValue = value;
          fEnded = 1;
          fAdded = added;
          return;
        }
        errors.push({ code: "stray_cr", line: recordLine, row: recordRow });
        i += 1;
        start = i;
        continue;
      }
      i += 1;
    }
    if (i !== start) {
      value += text.slice(start, i);
      added += i - start;
    }
    fValue = value;
    fEnded = 2;
    fAdded = added;
  }

  function readQuoted() {
    const open = i;
    const openLine = line;
    let value = "";
    let start = ++i;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (i + 1 < n && text.charCodeAt(i + 1) === 34) {
          value += text.slice(start, i) + '"';
          i += 2;
          start = i;
          continue;
        }
        value += text.slice(start, i);
        i += 1;
        if (i >= n) {
          fValue = value;
          fEnded = 2;
          fAdded = 0;
          return;
        }
        const d = text.charCodeAt(i);
        if (d === 44) {
          i += 1;
          fValue = value;
          fEnded = 0;
          fAdded = 0;
          return;
        }
        if (d === 10) {
          i += 1;
          line += 1;
          fValue = value;
          fEnded = 1;
          fAdded = 0;
          return;
        }
        if (d === 13 && i + 1 < n && text.charCodeAt(i + 1) === 10) {
          i += 2;
          line += 1;
          fValue = value;
          fEnded = 1;
          fAdded = 0;
          return;
        }
        readUnquoted(value);
        if (fAdded > 0) errors.push({ code: "quote_junk", line: recordLine, row: recordRow });
        return;
      }
      if (c === 13) {
        value += text.slice(start, i) + "\n";
        line += 1;
        i += i + 1 < n && text.charCodeAt(i + 1) === 10 ? 2 : 1;
        start = i;
        continue;
      }
      if (c === 10) line += 1;
      i += 1;
    }
    i = open + 1;
    line = openLine;
    errors.push({ code: "unterminated_quote", line: recordLine, row: recordRow });
    readUnquoted('"');
  }

  while (true) {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 10) {
        i += 1;
        line += 1;
      } else if (c === 13 && i + 1 < n && text.charCodeAt(i + 1) === 10) {
        i += 2;
        line += 1;
      } else break;
    }
    if (i >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = i < n && text.charCodeAt(i) === 34;
      if (quoted) readQuoted();
      else readUnquoted("");
      fields.push(fValue);
    } while (fEnded === 0);

    if (fields.length === 1 && fields[0] === "" && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: "short_row", line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push("");
    } else if (fields.length > width) {
      errors.push({ code: "long_row", line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? columns ?? [] : null, rows, errors };
}
