/**
 * Seed benchmark prompt suite (M2-003). Delivered as a versioned data document
 * — not scattered constants — mirroring the optimizer seed rule catalog. The
 * suite is the ONLY source of benchmark prompts: raw user input is never stored
 * or replayed, so measurements are deterministic and reproducible across runs.
 *
 * Prompts are fixed English model inputs (deterministic ASCII avoids
 * tokenizer/encoding variance); they are data, not UI strings, and belong to
 * the DATA_MODULES allowance for the CJK-free source gate.
 *
 * `approxPromptTokens` is a heuristic prompt-size estimate (no local
 * tokenizer); TTFT/prefill figures derived from it are documented as
 * approximate until a tokenizer lands.
 */
export interface BenchmarkPrompt {
  id: string;
  promptText: string;
  maxTokens: number;
  /** Heuristic prompt length estimate in tokens (no local tokenizer). */
  approxPromptTokens: number;
}

export interface BenchmarkSuite {
  id: string;
  version: string;
  prompts: BenchmarkPrompt[];
}

export const SEED_BENCHMARK_SUITE: BenchmarkSuite = {
  id: 'default',
  version: '2026.09.1',
  prompts: [
    {
      id: 'short-chat',
      promptText: 'Say hello in one short sentence.',
      maxTokens: 32,
      approxPromptTokens: 8,
    },
    {
      id: 'medium-context',
      promptText:
        'The quick brown fox jumps over the lazy dog. Summarize the sentence above in at most two sentences, mentioning the subject and the action.',
      maxTokens: 64,
      approxPromptTokens: 32,
    },
    {
      id: 'structured-output',
      promptText:
        'List three colors and three animals as a JSON object with keys "colors" and "animals". Output only the JSON object.',
      maxTokens: 96,
      approxPromptTokens: 40,
    },
  ],
};