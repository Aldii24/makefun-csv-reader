// Byte-path reader: reads csv-reader 1.0.0's answers straight from the JSON-escaped
// bytes of /input/cases.json and writes answers.json bytes. The CSV is never decoded:
// a field's escaped bytes are valid JSON string content, so they are copied as they stand,
// and only the characters csv-reader acts on (, " LF CR, a leading U+FEFF) are recognised.
// Answers are compared as JSON values, so escaping may differ from JSON.stringify's.

let inp; // Uint8Array of cases.json
let out; // output Buffer
let o = 0;
let errs; // errors Buffer for the current answer
let eo = 0;
let cl = 0; // byte length of the last decoded escape
let fst = new Int32Array(1024); // out offset of each field's opening quote

function hexv(b) {
  if (b >= 48 && b <= 57) return b - 48;
  b |= 32;
  if (b >= 97 && b <= 102) return b - 87;
  return -1;
}
// Escape at p (inp[p] === 92): its code unit; cl = its byte length.
function esc(p) {
  const b = inp[p + 1];
  cl = 2;
  switch (b) {
    case 34: return 34;
    case 92: return 92;
    case 47: return 47;
    case 98: return 8;
    case 102: return 12;
    case 110: return 10;
    case 114: return 13;
    case 116: return 9;
    case 117: {
      cl = 6;
      const v = (hexv(inp[p + 2]) << 12) | (hexv(inp[p + 3]) << 8) | (hexv(inp[p + 4]) << 4) | hexv(inp[p + 5]);
      return v;
    }
  }
  throw new Error("bad escape");
}
// Code of the char at p (< e), cl its length. Non-escape bytes return the byte (a UTF-8
// lead or continuation byte is never one of the specials).
function chr(p) {
  const b = inp[p];
  if (b !== 92) {
    cl = 1;
    return b;
  }
  return esc(p);
}

function grow(need) {
  if (o + need <= out.length) return;
  let sz = out.length * 2;
  while (sz < o + need) sz *= 2;
  const nb = Buffer.allocUnsafe(sz);
  out.copy(nb, 0, 0, o);
  out = nb;
}
function egrow(need) {
  if (eo + need <= errs.length) return;
  let sz = errs.length * 2;
  while (sz < eo + need) sz *= 2;
  const nb = Buffer.allocUnsafe(sz);
  errs.copy(nb, 0, 0, eo);
  errs = nb;
}
function eAscii(s) {
  egrow(s.length);
  for (let k = 0; k < s.length; k++) errs[eo++] = s.charCodeAt(k);
}
function oAscii(s) {
  grow(s.length);
  for (let k = 0; k < s.length; k++) out[o++] = s.charCodeAt(k);
}

let nErr = 0;
function errHead(code, line, row) {
  if (nErr++ > 0) eAscii(",");
  eAscii('{"code":"' + code + '","line":' + line + ',"row":' + (row < 0 ? "null" : row));
}

// Escape at p (inp[p] === 92), packed: its code unit | its byte length << 16.
function escp(a, p) {
  const b = a[p + 1];
  if (b === 110) return 10 | (2 << 16);
  if (b === 34) return 34 | (2 << 16);
  if (b === 114) return 13 | (2 << 16);
  if (b === 92) return 92 | (2 << 16);
  if (b === 117) {
    const h0 = hexv(a[p + 2]), h1 = hexv(a[p + 3]), h2 = hexv(a[p + 4]), h3 = hexv(a[p + 5]);
    if ((h0 | h1 | h2 | h3) < 0) throw new Error("bad escape");
    return ((h0 << 12) | (h1 << 8) | (h2 << 4) | h3) | (6 << 16);
  }
  if (b === 116) return 9 | (2 << 16);
  if (b === 47) return 47 | (2 << 16);
  if (b === 98) return 8 | (2 << 16);
  if (b === 102) return 12 | (2 << 16);
  throw new Error("bad escape");
}
// Char at p (< e), packed as escp.
function chp(a, p) {
  const b = a[p];
  return b === 92 ? escp(a, p) : b | (1 << 16);
}

// One case: the text is inp[s, e) (escaped content, no surrounding quotes). Flat, no closures.
function solveCase(s, e, header) {
  const a = inp;
  let p = s;
  if (e - s >= 3 && a[p] === 0xef && a[p + 1] === 0xbb && a[p + 2] === 0xbf) p += 3;
  else if (e - s >= 6 && a[p] === 92 && a[p + 1] === 117 && (escp(a, p) & 0xffff) === 0xfeff) p += 6;

  grow((e - s) + 4096);
  let b = out;
  let w = o;
  eo = 0;
  nErr = 0;
  let line = 1;
  let rowsN = 0;
  let width = -1;
  let pending = header;
  if (!header) {
    o = w;
    oAscii('{"columns":null,"rows":[');
    w = o;
  }
  let f = fst;

  records: for (;;) {
    // lines with no characters are no records
    while (p < e) {
      const x = chp(a, p);
      const c = x & 0xffff;
      if (c === 10) {
        p += x >>> 16;
        line++;
      } else if (c === 13) {
        const L = x >>> 16;
        if (p + L < e && (chp(a, p + L) & 0xffff) === 10) {
          p += L + (chp(a, p + L) >>> 16);
          line++;
        } else break;
      } else break;
    }
    if (p >= e) break;

    const recLine = line;
    const recRow = pending ? -1 : rowsN;
    const recStart = w;
    if (rowsN > 0) b[w++] = 44;
    b[w++] = 91;
    let nf = 0;
    let quoted = false;
    let ended = 0; // 0 comma, 1 line break, 2 end
    do {
      if (w + (e - p) + 64 > b.length) {
        o = w;
        grow((e - p) + (b.length >>> 1) + 64);
        b = out;
      }
      if (nf > 0) b[w++] = 44;
      if (nf >= f.length) {
        const f2 = new Int32Array(f.length * 2);
        f2.set(f);
        f = fst = f2;
      }
      f[nf] = w;
      b[w++] = 34;
      let junk = false;
      quoted = false;
      // ---- a quoted field ----
      if (p < e) {
        const x0 = a[p] === 34 ? 0 : chp(a, p);
        if (a[p] === 92 && (x0 & 0xffff) === 34) {
          quoted = true;
          const qL = x0 >>> 16;
          const open = p;
          const openLine = line;
          const mark = w;
          p += qL;
          let closed = false;
          for (;;) {
            while (p < e) {
              const y = a[p];
              if (y === 92) break;
              b[w++] = y;
              p++;
            }
            if (p >= e) break;
            const x = escp(a, p);
            const c = x & 0xffff;
            const L = x >>> 16;
            if (c === 34) {
              if (p + L < e && (chp(a, p + L) & 0xffff) === 34) {
                p += L + (chp(a, p + L) >>> 16);
                b[w++] = 92;
                b[w++] = 34;
                continue;
              }
              p += L;
              closed = true;
              break;
            }
            if (c === 13) {
              b[w++] = 92;
              b[w++] = 110;
              line++;
              p += L;
              if (p < e && (chp(a, p) & 0xffff) === 10) p += chp(a, p) >>> 16;
              continue;
            }
            if (c === 10) line++;
            for (let k = 0; k < L; k++) b[w++] = a[p + k];
            p += L;
          }
          if (closed) {
            if (p >= e) {
              ended = 2;
              b[w++] = 34;
              nf++;
              break;
            }
            const x = chp(a, p);
            const d = x & 0xffff;
            const dl = x >>> 16;
            if (d === 44) {
              p += dl;
              b[w++] = 34;
              nf++;
              continue; // ended stays 0
            }
            if (d === 10) {
              p += dl;
              line++;
              ended = 1;
              b[w++] = 34;
              nf++;
              break;
            }
            if (d === 13 && p + dl < e && (chp(a, p + dl) & 0xffff) === 10) {
              p += dl + (chp(a, p + dl) >>> 16);
              line++;
              ended = 1;
              b[w++] = 34;
              nf++;
              break;
            }
            junk = true; // what follows the closing quote, read as unquoted
          } else {
            // never closes: a literal quote, the rest read again as unquoted
            p = open + qL;
            line = openLine;
            w = mark;
            b[w++] = 92;
            b[w++] = 34;
            o = w;
            errHead("unterminated_quote", recLine, recRow);
            eAscii("}");
          }
        }
      }
      // ---- unquoted characters up to the next comma or line break ----
      let added = false;
      for (;;) {
        while (p < e) {
          const y = a[p];
          if (y === 44 || y === 92) break;
          b[w++] = y;
          p++;
          added = true;
        }
        if (p >= e) {
          ended = 2;
          break;
        }
        if (a[p] === 44) {
          p++;
          ended = 0;
          break;
        }
        const x = escp(a, p);
        const c = x & 0xffff;
        const L = x >>> 16;
        if (c === 10) {
          p += L;
          line++;
          ended = 1;
          break;
        }
        if (c === 13) {
          if (p + L < e && (chp(a, p + L) & 0xffff) === 10) {
            p += L + (chp(a, p + L) >>> 16);
            line++;
            ended = 1;
            break;
          }
          errHead("stray_cr", recLine, recRow);
          eAscii("}");
          p += L;
          continue;
        }
        if (c === 44) {
          p += L;
          ended = 0;
          break;
        }
        for (let k = 0; k < L; k++) b[w++] = a[p + k];
        p += L;
        added = true;
      }
      if (junk && added) {
        errHead("quote_junk", recLine, recRow);
        eAscii("}");
      }
      b[w++] = 34;
      nf++;
    } while (ended === 0);

    if (nf === 1 && !quoted && w === f[0] + 2) {
      w = recStart;
      continue records;
    }
    if (width < 0) width = nf;
    if (pending) {
      const cols = Buffer.from(b.subarray(recStart + 1, w));
      o = recStart;
      oAscii('{"columns":[');
      grow(cols.length + 16);
      cols.copy(out, o);
      o += cols.length;
      oAscii('],"rows":[');
      b = out;
      w = o;
      pending = false;
      continue records;
    }
    if (nf < width) {
      errHead("short_row", recLine, recRow);
      eAscii(',"fields":' + nf + "}");
      o = w;
      grow((width - nf) * 3 + 16);
      b = out;
      for (let k = nf; k < width; k++) {
        b[w++] = 44;
        b[w++] = 34;
        b[w++] = 34;
      }
    } else if (nf > width) {
      errHead("long_row", recLine, recRow);
      const xs = f[width];
      eAscii(',"extra":[');
      egrow(w - xs + 4);
      b.copy(errs, eo, xs, w);
      eo += w - xs;
      eAscii("]}");
      w = xs - 1; // drop the comma before the first cut field
    }
    b[w++] = 93;
    rowsN++;
  }
  o = w;
  if (pending) oAscii('{"columns":[],"rows":[');
  oAscii('],"errors":[');
  grow(eo + 8);
  errs.copy(out, o, 0, eo);
  o += eo;
  oAscii("]}");
}

// ---- the outer JSON: [{"id": ..., "input": {"text": "...", "header": bool}}, ...] ----
let q = 0;
function ws() {
  while (q < inp.length) {
    const b = inp[q];
    if (b === 32 || b === 10 || b === 13 || b === 9) q++;
    else break;
  }
}
function expect(b) {
  ws();
  if (inp[q] !== b) throw new Error("shape");
  q++;
}
// String at q (opening quote): returns [s, e) of its content, q past the closing quote.
let strEndHook = null;
function strRange() {
  ws();
  if (inp[q] !== 34) throw new Error("shape");
  const s = ++q;
  if (strEndHook !== null) {
    const j = strEndHook(s);
    if (j < 0) throw new Error("shape");
    q = j + 1;
    return [s, j];
  }
  for (;;) {
    const j = inp.indexOf(34, q);
    if (j < 0) throw new Error("shape");
    let k = j - 1;
    let bs = 0;
    while (k >= s && inp[k] === 92) {
      bs++;
      k--;
    }
    if ((bs & 1) === 0) {
      q = j + 1;
      return [s, j];
    }
    q = j + 1;
  }
}
function keyIs(r, name) {
  if (r[1] - r[0] !== name.length) return false;
  for (let k = 0; k < name.length; k++) if (inp[r[0] + k] !== name.charCodeAt(k)) return false;
  return true;
}
function skipValue() {
  ws();
  const b = inp[q];
  if (b === 34) {
    strRange();
    return;
  }
  if (b === 123 || b === 91) {
    const close = b === 123 ? 125 : 93;
    q++;
    ws();
    if (inp[q] === close) {
      q++;
      return;
    }
    for (;;) {
      if (b === 123) {
        strRange();
        expect(58);
      }
      skipValue();
      ws();
      if (inp[q] === 44) {
        q++;
        continue;
      }
      if (inp[q] === close) {
        q++;
        return;
      }
      throw new Error("shape");
    }
  }
  // literal or number
  while (q < inp.length) {
    const c = inp[q];
    if (c === 44 || c === 125 || c === 93 || c === 32 || c === 10 || c === 13 || c === 9) break;
    q++;
  }
}
function literal() {
  ws();
  const s = q;
  skipValue();
  return Buffer.from(inp.subarray(s, q)).toString("latin1");
}
function readInput() {
  expect(123);
  let text = null;
  let header = false;
  ws();
  if (inp[q] === 125) throw new Error("shape");
  for (;;) {
    const k = strRange();
    expect(58);
    if (keyIs(k, "text")) {
      ws();
      if (inp[q] !== 34) throw new Error("shape"); // text not a string: let the fallback read it
      text = strRange();
    } else if (keyIs(k, "header")) {
      header = literal() === "true";
    } else throw new Error("shape"); // an input field csv-reader might read: fall back
    ws();
    if (inp[q] === 44) {
      q++;
      continue;
    }
    if (inp[q] === 125) {
      q++;
      break;
    }
    throw new Error("shape");
  }
  if (text === null) throw new Error("shape");
  return [text[0], text[1], header];
}


// Type feedback for every path before the real input: a small fixed pseudo-random text touching each
// branch (each kind of field end, stray CRs, junk, unterminated quotes, short and long rows, escapes), so
// the optimizing compiler sees them all and does not deoptimize and recompile on the first rare event.
function warmSet() {
  const atoms = ["a", "bc", ",", ",", '"', '"', '""', "\n", "\r", "\r\n", "\r\n", "\u00e9", "\ud83d\ude00", "\\", "\t", "\ufeff"];
  let seed = 12345;
  const cases = [];
  for (let c = 0; c < 8; c++) {
    let t = c === 0 ? "\ufeff" : "";
    for (let k = 0; k < 400; k++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      t += atoms[(seed >>> 16) % atoms.length];
    }
    cases.push({ id: "w" + c, input: { text: t, header: (c & 1) === 0 } });
  }
  cases.push({ id: "w8", input: { text: "", header: true } });
  const plain = JSON.stringify(cases);
  // the same set with \u escapes for every special character, so the six-byte paths get feedback too
  const u = plain.replace(/\\[nr"]|[,\u0080-\uffff]/g, (m, off) => {
    if ((off & 3) !== 0) return m;
    const ch = m.length === 2 ? { "\\n": "\n", "\\r": "\r", '\\"': '"' }[m] : m;
    if (ch === "," ) return m; // commas outside the texts stay
    return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
  });
  return [plain, u];
}

let warmed = false;
/** The [start, end, header] of every case's text in the cases.json bytes, or null when not of the plain shape. */
export function parseShape(bytes, strEnd = null) {
  strEndHook = strEnd;
  inp = bytes;
  q = 0;
  const jobs = [];
  try {
    expect(91);
    ws();
    if (inp[q] !== 93) {
      for (;;) {
        expect(123);
        let job = null;
        for (;;) {
          const k = strRange();
          expect(58);
          if (keyIs(k, "input")) {
            if (job) throw new Error("shape");
            job = readInput();
          } else skipValue();
          ws();
          if (inp[q] === 44) {
            q++;
            continue;
          }
          if (inp[q] === 125) {
            q++;
            break;
          }
          throw new Error("shape");
        }
        if (!job) throw new Error("shape");
        jobs.push(job);
        ws();
        if (inp[q] === 44) {
          q++;
          continue;
        }
        if (inp[q] === 93) {
          q++;
          break;
        }
        throw new Error("shape");
      }
    } else q++;
    ws();
    if (q !== inp.length) throw new Error("shape");
  } catch {
    return null;
  } finally {
    strEndHook = null;
  }
  return jobs;
}

/** One case's answer bytes (a copy), read by the JS byte path; throws on a malformed escape. */
export function solveOne(bytes, s, e, header) {
  inp = bytes;
  if (!out) out = Buffer.allocUnsafe((e - s) + (1 << 16));
  if (!errs) errs = Buffer.allocUnsafe(1 << 16);
  o = 0;
  solveCase(s, e, header);
  return Buffer.from(out.subarray(0, o));
}

/** answers.json bytes for the cases.json bytes, or null when the input is not of the plain shape. */
export function answerBytes(bytes) {
  if (!warmed) {
    warmed = true;
    for (const t of warmSet()) {
      const wb = Buffer.from(t, "utf8");
      answerBytes(wb);
      answerBytes(wb);
    }
  }
  inp = bytes;
  q = 0;
  // scan the shape first, so a fallback never leaves a half-written answer
  const jobs = [];
  try {
    expect(91);
    ws();
    if (inp[q] !== 93) {
      for (;;) {
        expect(123);
        let job = null;
        for (;;) {
          const k = strRange();
          expect(58);
          if (keyIs(k, "input")) {
            if (job) throw new Error("shape");
            job = readInput();
          } else skipValue();
          ws();
          if (inp[q] === 44) {
            q++;
            continue;
          }
          if (inp[q] === 125) {
            q++;
            break;
          }
          throw new Error("shape");
        }
        if (!job) throw new Error("shape");
        jobs.push(job);
        ws();
        if (inp[q] === 44) {
          q++;
          continue;
        }
        if (inp[q] === 93) {
          q++;
          break;
        }
        throw new Error("shape");
      }
    } else q++;
    // validate escapes inside each text cheaply happens during solve (esc throws)
  } catch {
    return null;
  }
  out = Buffer.allocUnsafe(Math.ceil(inp.length * 1.25) + (1 << 16));
  errs = Buffer.allocUnsafe(1 << 20);
  o = 0;
  out[o++] = 91;
  try {
    for (let j = 0; j < jobs.length; j++) {
      if (j) out[o++] = 44;
      solveCase(jobs[j][0], jobs[j][1], jobs[j][2]);
    }
  } catch {
    return null;
  }
  out[o++] = 93;
  return out.subarray(0, o);
}
