# makefun-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Aldii24/makefun-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Aldii24/makefun-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Faster drop-in for make.fun's csv-reader 1.0.0. Same answers on every broken-CSV case, far less CPU.

- `main.ts` only loads `stream.cjs` (CommonJS, so no ES module loader is started, and a tiny file for Node's type
  stripping). `stream.cjs` compiles `csv.wasm` (Liftoff only: one quick compile on the main thread, no optimizing
  recompile in the background) and streams: it reads `cases.json` 256 KiB at a time into the module's memory, and
  the module (`core/src/lib.rs`, Rust `no_std`, wasm SIMD) reads each case's CSV straight from the JSON-escaped
  bytes, a record at a time, and writes the answer's rows as JSON bytes into a 256 KiB output window that goes to
  `answers.json` whenever it fills. No buffer ever holds the whole input or the whole output, so the memory touched
  stays small.
- A field's escaped bytes are already valid JSON string content, so they are copied as they stand; only `,`, `\"`,
  `\r`, `\n` and a raw `"` (the end of the text) are acted on. Plain records go through a 64-byte-block loop
  (bit masks of commas, backslashes and quotes); a record with anything rare in it (a stray CR, quote junk, a quote
  that never closes, a `\u` escape, the end of the input window) is read again by a per-field reader that follows
  csv-reader's policy step by step.
- `header` comes after `text` in each case, so the first record is held back: a gap is left for the answer's head
  (`{"columns":…,"rows":[` or `{"columns":null,"rows":[` plus that record) and written in place once `header` is
  read; errors are kept as records and written when the case ends, their `row` numbered then.
- Anything not of the plain shape (another key order, whitespace in the JSON, an escape csv-reader would act on
  written as `\u`) goes to `fast.mjs` / `bytes.mjs` (the earlier WebAssembly reader) and, last, to `solve.js`,
  whose `run(input)` is the same reading on a parsed input.

Rebuild `csv.wasm`: `./build.sh` (Rust with the `wasm32-unknown-unknown` target).

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=76m5b296&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
