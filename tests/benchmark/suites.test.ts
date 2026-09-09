// M2-003 seed suite is a deterministic data contract: every prompt carries a
// stable id, a positive token budget and a heuristic prompt-size estimate, and
// the ids are unique so the suite never rotates onto a duplicate prompt.
import { describe, expect, it } from 'vitest';
import { SEED_BENCHMARK_SUITE } from '@lmps/benchmark';

describe('SEED_BENCHMARK_SUITE', () => {
  it('ships a versioned suite with exactly three distinct prompts', () => {
    expect(SEED_BENCHMARK_SUITE.version).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    expect(SEED_BENCHMARK_SUITE.prompts.length).toBe(3);
    const ids = SEED_BENCHMARK_SUITE.prompts.map((prompt) => prompt.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every prompt deterministic, bounded and non-empty', () => {
    for (const prompt of SEED_BENCHMARK_SUITE.prompts) {
      expect(prompt.promptText.length).toBeGreaterThan(0);
      expect(prompt.maxTokens).toBeGreaterThan(0);
      expect(prompt.approxPromptTokens).toBeGreaterThan(0);
      expect(prompt.maxTokens).toBeLessThanOrEqual(512);
    }
  });

  it('orders prompts from lightweight to heavier workloads', () => {
    const budgets = SEED_BENCHMARK_SUITE.prompts.map((prompt) => prompt.maxTokens);
    expect([...budgets].sort((a, b) => a - b)).toEqual(budgets);
  });
});