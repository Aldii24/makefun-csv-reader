// The WebAssembly path: cases.json is read straight into the module's memory, the JS shape scan finds each
// case's text, and csv.wasm (csv.wat: the same reading as bytes.js's solveCase, scanning 16 bytes at a time)
// writes each answer's rows, columns and errors as JSON bytes. A case the module cannot finish (a region too
// small, a malformed escape) is read by bytes.js instead; an input not of the plain shape returns null.
import { openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { parseShape, solveOne } from './bytes.js';
import { WASM_B64 } from './wasm-bin.js';

export const stats = { wasm: 0, js: 0 };
const INP = 4096;
const PAGE = 65536;
const align = (n) => (n + 15) & ~15;

/** The answers.json bytes as a list of chunks, or null. */
export function answerChunks(path) {
  const fd = openSync(path, 'r');
  const n = fstatSync(fd).size;
  const outBase = align(INP + n + 64);
  const outSize = n + (n >>> 1) + (2 << 20);
  const errBase = align(outBase + outSize);
  const errSize = (n >>> 2) + (1 << 20);
  const colBase = align(errBase + errSize);
  const colSize = (n >>> 3) + (1 << 16);
  const fstBase = align(colBase + colSize);
  const fstCap = 1 << 16;
  const total = fstBase + fstCap * 4 + 64;

  const mod = new WebAssembly.Module(Buffer.from(WASM_B64, 'base64'));
  const inst = new WebAssembly.Instance(mod, {});
  const ex = inst.exports;
  const mem = ex.mem;
  const pages = Math.ceil(total / PAGE);
  if (pages > mem.buffer.byteLength / PAGE) mem.grow(pages - mem.buffer.byteLength / PAGE);
  const heap = new Uint8Array(mem.buffer);
  const view = heap.subarray(INP, INP + n);
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
  const chunks = [Buffer.from('[')];
  let w = outBase;
  for (let j = 0; j < jobs.length; j++) {
    if (j) chunks.push(Buffer.from(','));
    const [s, e, header] = jobs[j];
    let status = 1;
    try {
      status = ex.solve(INP + s, INP + e, header ? 1 : 0, w, outBase + outSize, errBase, errBase + errSize, colBase, colBase + colSize, fstBase, fstCap);
    } catch {
      status = 1;
    }
    if (status !== 0) {
      stats.js++;
      chunks.push(solveOne(view, s, e, header)); // throws on a malformed escape: the caller falls back
      continue;
    }
    stats.wasm++;
    const W = ex.W.value;
    let head;
    if (!header) head = '{"columns":null,"rows":[';
    else if (ex.HASCOLS.value) head = null;
    else head = '{"columns":[],"rows":[';
    if (head === null) {
      chunks.push(Buffer.from('{"columns":['), Buffer.from(heap.subarray(colBase, ex.COLE.value)), Buffer.from('],"rows":['));
    } else chunks.push(Buffer.from(head));
    chunks.push(heap.subarray(w, W));
    chunks.push(Buffer.from('],"errors":['), Buffer.from(heap.subarray(errBase, ex.EO.value)), Buffer.from(']}'));
    w = align(W);
  }
  chunks.push(Buffer.from(']'));
  return { chunks };
}
