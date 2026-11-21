// The harness runs `node /bot/main.ts` (node22): it reads every case from /input/cases.json and writes
// /output/answers.json, one answer per case in order, each csv-reader 1.0.0's reading of the case's input.
// The fast path reads the cases' bytes directly (bytes.js); any input not of the plain shape goes through
// solve.js's run() on the parsed JSON, which returns the same answers.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--no-concurrent-recompilation');

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = readFileSync(join(INPUT_DIR, 'cases.json'));
const { answerBytes } = (await import(new URL('./bytes.js', import.meta.url).href)) as {
  answerBytes: (b: Uint8Array) => Uint8Array | null;
};
const fast = answerBytes(raw);
if (fast !== null) {
  writeFileSync(join(OUTPUT_DIR, 'answers.json'), fast);
} else {
  const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };
  const cases = JSON.parse(raw.toString('utf8')) as { id: string; input: unknown }[];
  const answers: unknown[] = [];
  for (const c of cases) answers.push(run(c.input));
  writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
}
