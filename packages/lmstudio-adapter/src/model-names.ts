/**
 * Model identity heuristics (M0-005 / M1-003). The model key is a host
 * identifier for a model file; family / quantization / parameter count are
 * derived for display and estimation readiness. Treat as heuristics only —
 * the host's own reporting wins when it disagrees.
 */

export interface ModelIdentity {
  modelKey: string;
  family: string | null;
  quantization: string | null;
  parametersB: number | null;
}

const FILE_EXT_RE = /\.(gguf|safetensors|bin|onnx|cot)$/i;

/** gguf quant tags (`Q4_0`, `Q4_K_M`, `IQ3_XXS`) and float word sizes (`fp16`, `bf16` …). */
const QUANT_RE = /\b(Q[0-9][._][0-9A-Z_]+|IQ[0-9](?:_[A-Z0-9]+)?|(?:FP|BF|F)[0-9]{1,2})\b/i;

const PARAMS_RE = /(?:^|[-_.])(\d+(?:\.\d+)?)[bB](?=$|[-_ .])/;

/** gguf quant tags conventionally render uppercase (`Q4_K_M`, `IQ3_XXS`). */
function normalizeQuant(token: string): string {
  return /^(?:Q|IQ)[0-9]/i.test(token) ? token.toUpperCase() : token;
}

export function parseModelIdentity(modelKey: string): ModelIdentity {
  const basename = modelKey.split(/[\\/]/).pop() ?? modelKey;
  const stem = basename.replace(FILE_EXT_RE, '');

  const quantMatch = stem.match(QUANT_RE);
  const quantization = quantMatch === null ? null : normalizeQuant(quantMatch[0]);

  const paramsMatch = stem.match(PARAMS_RE);
  const parametersB = paramsMatch === null ? null : Number(paramsMatch[1]);

  const familyRaw = stem.split(/[-_ .]/)[0];
  const family = familyRaw === undefined || familyRaw === '' ? null : familyRaw;

  return { modelKey, family, quantization, parametersB };
}