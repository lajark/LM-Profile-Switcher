import { describe, expect, it } from 'vitest';

import { parseModelIdentity } from '@lmps/lmstudio-adapter';

describe('parseModelIdentity (model key heuristics)', () => {
  it('parses family, quantization and parameters from a gguf key', () => {
    expect(parseModelIdentity('mistral-7b-instruct.Q4_K_M.gguf')).toEqual({
      modelKey: 'mistral-7b-instruct.Q4_K_M.gguf',
      family: 'mistral',
      quantization: 'Q4_K_M',
      parametersB: 7,
    });
  });

  it('reads larger parameter counts and numeric suffix keys', () => {
    expect(parseModelIdentity('Meta-Llama-3-70B-Instruct.Q4_0.gguf')).toMatchObject({
      quantization: 'Q4_0',
      parametersB: 70,
    });
    expect(parseModelIdentity('architect-3.1-8b-instruct')).toMatchObject({
      family: 'architect',
      parametersB: 8,
    });
  });

  it('handles paths and upper/lower-case quant tags', () => {
    const key = 'D:\\models\\qwen2.5-coder-7b-instruct.Q5_K_M.gguf';
    expect(parseModelIdentity(key)).toMatchObject({
      modelKey: key,
      family: 'qwen2',
      quantization: 'Q5_K_M',
      parametersB: 7,
    });
    expect(parseModelIdentity('model-q8_0-f16.gguf')).toMatchObject({ quantization: 'Q8_0' });
  });

  it('returns nulls when nothing is recognizable', () => {
    expect(parseModelIdentity('my-model')).toEqual({
      modelKey: 'my-model',
      family: 'my',
      quantization: null,
      parametersB: null,
    });
    expect(parseModelIdentity('')).toEqual({
      modelKey: '',
      family: null,
      quantization: null,
      parametersB: null,
    });
  });

  it('skips non-b-parameter digits like "3.1" in an 8b name', () => {
    expect(parseModelIdentity('architect-3.1-8b-instruct')).toMatchObject({ parametersB: 8 });
  });
});