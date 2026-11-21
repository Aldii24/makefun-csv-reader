# Fast CSV reader (make.fun drop-in)

Faster drop-in for [make.fun](https://make.fun)'s **csv-reader 1.0.0** on the bounty
[Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

`solve.js` exports `run(input)` with the same contract as the house baseline: given
`{ text, header }` it returns `{ columns, rows, errors }` exactly as csv-reader 1.0.0
would, using a single left-to-right scan with batched string slices instead of
character-at-a-time concatenation.

`main.ts` is the harness driver (Node 22): it turns V8 incremental marking off, reads
`/input/cases.json`, calls `run` on each case, and writes `/output/answers.json`.

## License

MIT
