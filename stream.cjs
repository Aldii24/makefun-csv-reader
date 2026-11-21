// The harness runs `node /bot/main.ts` (node22): it reads every case from /input/cases.json and writes
// /output/answers.json, one answer per case in order, each csv-reader 1.0.0's reading of the case's input (solve.js's run).
// csv.wasm (core/src/lib.rs) reads each case's text straight from cases.json's bytes, 256 KiB at a time, and its
// answer streams out the same way. Anything off the plain shape goes to fast.mjs / solve.js instead.
const fs = require('node:fs');
// Liftoff only: the module is compiled once, at its baseline tier, on this thread (no optimizing recompile in the
// background, whose CPU time would count too).
require('node:v8').setFlagsFromString(process.env.CSV_TEST_V8 || '--liftoff-only');
const IN0 = 1 << 20, IN_END = 5 << 20, HOLE0 = 9 << 20, OUT0 = 10 << 20;
const inPath = (process.env.MAKEFUN_INPUT_DIR || '/input') + '/cases.json';
const outPath = (process.env.MAKEFUN_OUTPUT_DIR || '/output') + '/answers.json';
function fast() {
  const ex = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(__dirname + '/csv.wasm')), {}).exports;
  const buf = Buffer.from(ex.memory.buffer);
  const step = ex.step, retp = ex.retp, take_hole = ex.take_hole, get_w = ex.get_w, set_w = ex.set_w;
  const fd = fs.openSync(inPath, 'r');
  const ofd = fs.openSync(outPath, 'w');
  // (CSV_TEST_*: smaller windows, for tests of the window edges)
  if (process.env.CSV_TEST_FLUSH) ex.set_flush(+process.env.CSV_TEST_FLUSH);
  let cap = +(process.env.CSV_TEST_CAP || 262144), s = 0, e = 0, eof = false, fileBase = 0;
  const fill = () => {
    if (s > 0) {
      buf.copyWithin(IN0, IN0 + s, IN0 + e);
      e -= s;
      s = 0;
    }
    if (e === cap) cap *= 2;
    if (IN0 + cap + 64 > IN_END) throw 0;
    const r = fs.readSync(fd, buf, IN0 + e, cap - e, null);
    if (r <= 0) eof = true;
    e += r > 0 ? r : 0;
  };
  const need = (n) => {
    while (e - s < n && !eof) fill();
  };
  const flush = () => {
    const w = get_w();
    let o = OUT0;
    while (o < w) {
      const n = fs.writeSync(ofd, buf, o, w - o, fileBase);
      fileBase += n;
      o += n;
    }
    set_w(OUT0);
  };
  const putc = (c) => {
    const w = get_w();
    buf[w] = c;
    set_w(w + 1);
  };
  const ws = () => {
    for (;;) {
      need(1);
      if (s >= e) return;
      const b = buf[IN0 + s];
      if (b === 32 || b === 10 || b === 13 || b === 9) s++;
      else return;
    }
  };
  const HEAD = /^\{"id":"[^"\\]*","input":\{"text":"/;
  const TAIL = /^","header":(true|false)\}\}/;
  ws();
  if (buf[IN0 + s] !== 91) throw 0;
  s++;
  ws();
  let first = true;
  if (buf[IN0 + s] === 93) {
    s++;
    putc(91);
  } else
    for (;;) {
      need(512);
      const m = HEAD.exec(buf.latin1Slice(IN0 + s, IN0 + Math.min(e, s + 512)));
      if (m === null) throw 0;
      s += m[0].length;
      putc(first ? 91 : 44);
      first = false;
      ex.begin();
      let hole = -1;
      for (;;) {
        const r = step(IN0 + s, IN0 + e, eof ? 1 : 0);
        const h = take_hole();
        if (h !== 0) hole = fileBase + (h - OUT0);
        s = retp() - IN0;
        if (r === 1) break;
        if (r === 2) flush();
        else if (r === 0) fill();
        else throw 0;
      }
      need(64);
      const t = TAIL.exec(buf.latin1Slice(IN0 + s, IN0 + Math.min(e, s + 64)));
      if (t === null) throw 0;
      s += t[0].length;
      const hl = ex.finish(t[1] === 'true' ? 1 : 0);
      if (hl !== 0) {
        if (hole >= fileBase) buf.copy(buf, OUT0 + (hole - fileBase), HOLE0, HOLE0 + hl);
        else {
          let o = 0;
          while (o < hl) o += fs.writeSync(ofd, buf, HOLE0 + o, hl - o, hole + o);
        }
      }
      ws();
      const c = buf[IN0 + s];
      s++;
      if (c === 44) {
        ws();
        continue;
      }
      if (c !== 93) throw 0;
      break;
    }
  ws();
  if (s !== e || !eof) {
    need(1);
    if (s !== e) throw 0;
  }
  putc(93);
  flush();
  fs.closeSync(ofd);
  fs.closeSync(fd);
}
let ok = false;
try {
  fast();
  ok = true;
} catch {}
if (!ok) {
  (async () => {
    let res = null;
    try {
      res = await (await import('./fast.mjs')).answerToFile(inPath, outPath);
    } catch {
      res = null;
    }
    if (res !== true) {
      const { run } = await import('./solve.js');
      const raw = res !== null && res.fallback ? res.fallback : fs.readFileSync(inPath);
      const answers = [];
      for (const c of JSON.parse(raw.toString('utf8'))) answers.push(run(c.input));
      fs.writeFileSync(outPath, JSON.stringify(answers));
    }
  })();
}
