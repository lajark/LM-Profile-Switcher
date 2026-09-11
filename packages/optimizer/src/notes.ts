/**
 * Bilingual scoring-note templates (M2-002) — a DATA module like `presets.ts`:
 * the Chinese text is user-facing data, kept out of the code files so the CJK
 * scan only ever joins the declared exemptions. `buildRationale` interpolates
 * the placeholders below; the seed rule rationale (also data) carries the
 * task-specific half of the sentence.
 */
export const RATIONALE_NOTE: { 'zh-CN': string; en: string } = {
  'zh-CN': ' 该配置静态评分 {score}，{confidence}置信度{headroom}。',
  en: ' Static score {score}, {confidence} confidence{headroom}.',
};

export const CONFIDENCE_LABEL: {
  'zh-CN': { high: string; low: string };
  en: { high: string; low: string };
} = {
  'zh-CN': { high: '高', low: '低' },
  en: { high: 'high', low: 'low' },
};

export const HEADROOM_NOTE: { 'zh-CN': string; en: string } = {
  'zh-CN': '，显存余量 {headroom} GiB',
  en: ', VRAM headroom {headroom} GiB',
};

/** M5-002: performance/resource warning + Benchmark guidance for Hybrid/Host candidates. */
export const HYBRID_MEMORY_NOTE: { 'zh-CN': string; en: string } = {
  'zh-CN': '；该候选以混合/主机内存承载，可能较纯显存加载更慢并占用系统内存，建议先启用 Benchmark 实测校准后再选用。',
  en: '; this candidate is carried by Hybrid/Host memory, may load slower than a GPU-resident config and consume system RAM, so calibrate it with a Benchmark before adopting.',
};