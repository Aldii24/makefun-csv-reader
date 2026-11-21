// The WebAssembly path: cases.json is read straight into the module's memory, the module finds each JSON string's
// end for the shape scan (bytes.mjs parseShape), and its embedded module (csv.wat: the same reading as bytes.mjs's solveCase,
// scanning 16 bytes at a time) writes each answer's rows, columns and errors as JSON bytes, which go to the
// output file case by case so one output region is reused. A case the module cannot finish (a region too small,
// a malformed escape) is read by bytes.mjs instead; an input not of the plain shape returns { fallback }.
import { openSync, fstatSync, readSync, writeSync, writevSync, closeSync } from 'node:fs';
// csv.wasm, built from csv.wat (gen-wat.mjs) by wabt (build-wasm.cjs): base64
const WASM_B64 = "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";

export const stats = { wasm: 0, js: 0 };
const INP = 4096;
const PAGE = 65536;
const align = (n) => (n + 15) & ~15;
const OPEN = Buffer.from('[');
const COMMA = Buffer.from(',');
const CLOSE = Buffer.from(']');
const HEAD_NULL = Buffer.from('{"columns":null,"rows":[');
const HEAD_EMPTY = Buffer.from('{"columns":[],"rows":[');
const HEAD_COLS = Buffer.from('{"columns":[');
const MID_COLS = Buffer.from('],"rows":[');
const MID_ERRS = Buffer.from('],"errors":[');
const TAIL = Buffer.from(']}');

// The shape scan of cases.json (the same as bytes.mjs parseShape), its strings' ends found by the module.
let inp;
let q = 0;
let strEndHook = null;
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
function literal() {
  ws();
  const s = q;
  skipValue();
  return Buffer.from(inp.subarray(s, q)).toString("latin1");
}
function strRange() {
  ws();
  if (inp[q] !== 34) throw new Error("shape");
  const s = ++q;
  const j = strEndHook(s);
  if (j < 0) throw new Error("shape");
  q = j + 1;
  return [s, j];
}
function parseShape(bytes, strEnd) {
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

function writeAll(fd, b) {
  let o = 0;
  while (o < b.length) o += writeSync(fd, b, o, b.length - o);
}

function writevAll(fd, list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].length;
  let w = writevSync(fd, list);
  if (w === total) return;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (w >= b.length) {
      w -= b.length;
      continue;
    }
    writeAll(fd, w ? b.subarray(w) : b);
    w = 0;
  }
}

/** Writes answers.json to outPath and returns true; or returns { fallback: bytes } or null. */
export async function answerToFile(inPath, outPath) {
  const fd = openSync(inPath, 'r');
  const n = fstatSync(fd).size;
  const mod = new WebAssembly.Module(Buffer.from(WASM_B64, 'base64'));
  const ex = new WebAssembly.Instance(mod, {}).exports;
  const mem = ex.mem;
  const inEnd = align(INP + n + 64);
  let have = mem.buffer.byteLength / PAGE;
  let need = Math.ceil(inEnd / PAGE);
  if (need > have) mem.grow(need - have);
  let heap = new Uint8Array(mem.buffer);
  let view = heap.subarray(INP, INP + n);
  let got = 0;
  while (got < n) {
    const r = readSync(fd, view, got, n - got, got);
    if (r <= 0) break;
    got += r;
  }
  closeSync(fd);
  if (got !== n) return null;

  const strEnd = ex.strEnd;
  const jobs = parseShape(view, (p) => {
    const j = strEnd(INP + p, INP + n);
    return j < 0 ? -1 : j - INP;
  });
  if (jobs === null) return { fallback: Buffer.from(view) };

  let maxLen = 0;
  for (let j = 0; j < jobs.length; j++) maxLen = Math.max(maxLen, jobs[j][1] - jobs[j][0]);
  const outBase = inEnd;
  const outSize = maxLen + (maxLen >>> 1) + (1 << 20);
  const errBase = align(outBase + outSize);
  const errSize = (maxLen >>> 2) + (1 << 18);
  const colBase = align(errBase + errSize);
  const colSize = (maxLen >>> 3) + (1 << 16);
  const fstBase = align(colBase + colSize);
  const fstCap = 1 << 16;
  need = Math.ceil((fstBase + fstCap * 4 + 64) / PAGE);
  have = mem.buffer.byteLength / PAGE;
  if (need > have) {
    mem.grow(need - have);
    heap = new Uint8Array(mem.buffer);
    view = heap.subarray(INP, INP + n);
  }

  const out = openSync(outPath, 'w');
  try {
    let last_js = false;
    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      const s = job[0], e = job[1], header = job[2];
      let status = 1;
      try {
        status = ex.solve(INP + s, INP + e, header ? 1 : 0, outBase, outBase + outSize, errBase, errBase + errSize, colBase, colBase + colSize, fstBase, fstCap);
      } catch {
        status = 1;
      }
      if (status !== 0) {
        stats.js++;
        writeAll(out, j ? COMMA : OPEN);
        const { solveOne } = await import('./bytes.mjs');
        writeAll(out, solveOne(view, s, e, header)); // throws on a malformed escape: the caller falls back
        last_js = j === jobs.length - 1;
        continue;
      }
      stats.wasm++;
      const parts = j ? [COMMA] : [OPEN];
      if (!header) parts.push(HEAD_NULL);
      else if (ex.HASCOLS.value) parts.push(HEAD_COLS, heap.subarray(colBase, ex.COLE.value), MID_COLS);
      else parts.push(HEAD_EMPTY);
      parts.push(heap.subarray(outBase, ex.W.value), MID_ERRS, heap.subarray(errBase, ex.EO.value), TAIL);
      if (j === jobs.length - 1) parts.push(CLOSE);
      writevAll(out, parts);
    }
    if (jobs.length === 0) writeAll(out, OPEN);
    if (jobs.length === 0 || last_js) writeAll(out, CLOSE);
  } finally {
    closeSync(out);
  }
  return true;
}
