// The harness runs `node /bot/main.ts` (node22): it reads every case from /input/cases.json and writes
// /output/answers.json, one answer per case in order, each csv-reader 1.0.0's reading of the case's input.
// fast.js reads the cases' bytes with csv.wasm (bytes.js for any case it cannot finish); an input not of the
// plain shape goes through solve.js's run() on the parsed JSON, which returns the same answers.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--no-concurrent-recompilation');

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const inPath = join(INPUT_DIR, 'cases.json');
const outPath = join(OUTPUT_DIR, 'answers.json');

let res: true | { fallback?: Buffer } | null = null;
try {
  const { answerToFile } = (await import(new URL('./fast.js', import.meta.url).href)) as {
    answerToFile: (i: string, o: string) => Promise<true | { fallback?: Buffer } | null>;
  };
  res = await answerToFile(inPath, outPath);
} catch {
  res = null;
}
if (res !== true) {
  const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };
  const raw = res !== null && res.fallback ? res.fallback : readFileSync(inPath);
  const cases = JSON.parse(raw.toString('utf8')) as { id: string; input: unknown }[];
  const answers: unknown[] = [];
  for (const c of cases) answers.push(run(c.input));
  writeFileSync(outPath, JSON.stringify(answers));
}
