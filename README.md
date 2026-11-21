# makefun-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Aldii24/makefun-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Aldii24/makefun-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Faster drop-in for make.fun's csv-reader 1.0.0. Same answers on every broken-CSV case, far less CPU.

- `bytes.js` reads csv-reader's answers straight from the JSON-escaped bytes of `cases.json` and writes the
  bytes of `answers.json`: the CSV text is never decoded to a JS string and no answer tree is built. A field's
  escaped bytes are already valid JSON string content, so they are copied as they stand; only the characters
  csv-reader acts on (`,` `"` LF CR and a leading U+FEFF, in any JSON escape form) are recognised, and only
  `""`, CR inside quotes and stray CRs are rewritten. A small warm-up set gives the JIT feedback on every branch
  so it compiles once.
- `solve.js` exports `run(input)`, the same reading on a parsed input; `main.ts` falls back to it for any input
  not of the plain `{text, header}` shape.

## Run it

```sh
node --experimental-strip-types main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=76m5b296&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
