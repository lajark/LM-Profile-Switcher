/**
 * Measured-evidence reader (measured-feedback loop). Parses the append-only
 * `logs/benchmarks.ndjson` audit log into `BenchmarkResult`s — tolerantly:
 * each line is judged on its own, a malformed or schema-invalid line is skipped
 * instead of poisoning the whole history, because evidence must never break the
 * recommendation that consumes it. Pure module: strings in, results out; the
 * apps own the file read.
 */
import { BenchmarkResultSchema, type BenchmarkResult } from '@lmps/domain';

/**
 * Parse ndjson benchmark-log content. Returns every line that parses as a
 * valid `BenchmarkResult` (passthrough variant: legacy and forward-compatible
 * records both pass); anything else is dropped silently by design.
 */
export function parseBenchmarkLogLines(content: string): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let candidate: unknown;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = BenchmarkResultSchema.safeParse(candidate);
    if (parsed.success) results.push(parsed.data);
  }
  return results;
}
