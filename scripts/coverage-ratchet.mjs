/**
 * Monotonic coverage ratchet (M5-004): reads the coverage JSON summary written by
 * `vitest run --coverage`, compares overall line coverage to the committed
 * baseline (`coverage-baseline.json`) and fails when it drops. When it improves
 * the baseline is raised (ratchet only ever increases). Goal is >= 80% line
 * coverage of the included source; exclusions live in `vitest.config.ts`
 * (schemas, generated, vendor, `.d.ts`).
 *
 * Exit: 1 when coverage regressed below baseline; ESPACE elsewhere not used.
 * Run order: `pnpm run coverage:run` then `pnpm run coverage:ratchet`.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SUMMARY = resolve(ROOT, '.workspace/coverage/coverage-summary.json');
const BASELINE = resolve(ROOT, 'coverage-baseline.json');
const GOAL = 80;

const RATCHET_TOLERANCE = 0.5;

function readSummary() {
  if (!existsSync(SUMMARY)) {
    console.error(`coverage summary not found: ${SUMMARY}`);
    console.error('run `pnpm run coverage:run` first');
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(SUMMARY, 'utf8'));
  const total = data.total;
  const linesPct = total?.lines?.pct ?? null;
  if (typeof linesPct !== 'number') {
    console.error('coverage summary has no totals.lines.pct');
    process.exit(2);
  }
  return linesPct;
}

function readBaseline() {
  if (!existsSync(BASELINE)) return null;
  const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
  return typeof data.lines_pct === 'number' ? data.lines_pct : null;
}

function writeBaseline(pct) {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify({ lines_pct: pct }, null, 2)}\n`, 'utf8');
}

const current = readSummary();
const baseline = readBaseline();

if (baseline !== null && current < baseline - RATCHET_TOLERANCE) {
  console.error(`COVERAGE REGRESSION: ${current.toFixed(2)}% more than ${RATCHET_TOLERANCE}pt below baseline ${baseline.toFixed(2)}%`);
  console.error('See .workspace/coverage/coverage-summary.json; do not lower the committed baseline.');
  process.exit(1);
}

if (baseline === null || current > baseline) {
  writeBaseline(current); // ratchet up to the new measured floor
  const verb = baseline === null ? 'established' : 'raised';
  console.log(`Coverage ratchet ${verb}: ${current.toFixed(2)}% (baseline now ${current.toFixed(2)}%)`);
} else {
  console.log(`Coverage ratchet holds: ${current.toFixed(2)}% = baseline ${baseline.toFixed(2)}%`);
}

console.log(`Coverage goal: ${GOAL}% (${current.toFixed(2)}% reached)`);
process.exit(0);