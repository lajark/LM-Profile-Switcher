/**
 * Seed rule catalog (PRD FR-07, M2-001): one rule per task kind, delivered as
 * a versioned data document — not scattered constants. `investment-due-diligence`
 * and `rag` carry the full constraint/hint/weight shape; the remaining kinds
 * carry minimal rationale plus at least one constraint or hint by way of
 * placeholder defaults. Rationale is a data field in both project languages
 * (mirroring `CompositeProfile.displayName`), not an i18n key namespace: rules
 * are versioned data, consumer pick the current locale at display time.
 *
 * These values are heuristic/seed defaults for candidate generation (M2-002),
 * NOT measured calibration — real calibration comes from M2-003 Benchmark and
 * the served hardware adapter.
 */
import { StrictRulesDocumentSchema, type RulesDocument } from '@lmps/domain';

export const SEED_RULE_CATALOG: RulesDocument = {
  schemaVersion: 2,
  version: '2026.09.1',
  rules: [
    {
      taskKind: 'quick-chat',
      applicableArchitectures: ['dense', 'moe'],
      rationale: {
        'zh-CN': '面向单轮、低时延对话：优先小上下文与低时延配置，兼顾吞吐与显存占用。',
        en: 'For single-turn, low-latency chat: favour small context and low latency, balancing throughput and VRAM.',
      },
      parameterHints: {
        contextLength: { min: 4096, max: 8192 },
        temperature: { min: 0.6, max: 1.0 },
      },
      scoringWeights: { vramEfficiency: 0.15, latency: 0.35, throughput: 0.3, quality: 0.2 },
    },
    {
      taskKind: 'long-document',
      applicableArchitectures: ['dense', 'moe'],
      rationale: {
        'zh-CN': '长文理解需要宽上下文与高 KV 显存预算；质量优先于 token 速度。',
        en: 'Longer documents need a wide context and KV-cache headroom; quality is preferred over token speed.',
      },
      constraints: { minContextLength: 16384 },
      parameterHints: { contextLength: { min: 16384, max: 65536 } },
      scoringWeights: { vramEfficiency: 0.3, latency: 0.1, throughput: 0.2, quality: 0.4 },
    },
    {
      taskKind: 'rag',
      applicableArchitectures: ['dense', 'moe'],
      rationale: {
        'zh-CN': '检索增强生成：需容纳被检索段落的大型上下文，并依赖 Flash Attention 摊薄长序列算力。',
        en: 'Retrieval-augmented generation: needs a large context to hold retrieved passages and Flash Attention to amortise long-sequence compute.',
      },
      constraints: {
        minVramBytes: 8589934592,
        minContextLength: 32768,
        requiredCapabilities: ['contextLength', 'flashAttention'],
        maxConcurrency: 1,
      },
      parameterHints: {
        contextLength: { min: 32768, max: 131072 },
        evalBatchSize: { min: 8, max: 32 },
        flashAttention: true,
        temperature: { min: 0.0, max: 0.3 },
      },
      scoringWeights: { vramEfficiency: 0.25, latency: 0.15, throughput: 0.35, quality: 0.25 },
    },
    {
      taskKind: 'investment-due-diligence',
      applicableArchitectures: ['dense', 'moe'],
      rationale: {
        'zh-CN': '尽调分析需长上下文核对年报与条款，低温度保证输出可复核；质量压倒时延。',
        en: 'Due diligence needs long context to cross-check filings and terms with low temperature for verifiable output; quality beats latency.',
      },
      constraints: {
        minVramBytes: 6442450944,
        minContextLength: 32768,
        requiredCapabilities: ['contextLength'],
      },
      parameterHints: {
        contextLength: { min: 32768, max: 131072 },
        gpuOffload: { min: 0.5, max: 1 },
        flashAttention: true,
        temperature: { min: 0.0, max: 0.4 },
        maxTokens: { min: 2048, max: 8192 },
      },
      scoringWeights: { vramEfficiency: 0.25, latency: 0.1, throughput: 0.2, quality: 0.45 },
    },
    {
      taskKind: 'meeting-minutes',
      applicableArchitectures: ['dense', 'moe'],
      rationale: {
        'zh-CN': '会议纪要需完整吸收长录音/长文转写；上下文优先，输出长度适中。',
        en: 'Minutes must absorb a long transcript wholesale; context matters most, output stays moderate.',
      },
      constraints: { minContextLength: 8192 },
      parameterHints: {
        contextLength: { min: 8192, max: 32768 },
        maxTokens: { min: 2048, max: 4096 },
      },
      scoringWeights: { vramEfficiency: 0.25, latency: 0.15, throughput: 0.25, quality: 0.35 },
    },
    {
      taskKind: 'coding',
      applicableArchitectures: ['dense', 'moe'],
      rationale: {
        'zh-CN': '代码补全与编辑在宽上下文下保持更一致；低温度减少误用 API。',
        en: 'Code assistance stays more consistent with a wide context; low temperature cuts hallucinated APIs.',
      },
      constraints: { minContextLength: 8192 },
      parameterHints: {
        contextLength: { min: 8192, max: 65536 },
        temperature: { min: 0.0, max: 0.4 },
        maxTokens: { min: 1024, max: 8192 },
      },
      scoringWeights: { vramEfficiency: 0.2, latency: 0.25, throughput: 0.2, quality: 0.35 },
    },
    {
      taskKind: 'structured-extraction',
      applicableArchitectures: ['dense', 'moe'],
      rationale: {
        'zh-CN': '结构化抽取要求低随机性与确定输出；上下文依源文档规模而定。',
        en: 'Structured extraction wants low randomness and deterministic output; context scales with source size.',
      },
      parameterHints: {
        temperature: { min: 0.0, max: 0.2 },
        topP: { min: 0.9, max: 1.0 },
      },
      scoringWeights: { vramEfficiency: 0.25, latency: 0.2, throughput: 0.15, quality: 0.4 },
    },
    {
      taskKind: 'agent',
      applicableArchitectures: ['dense', 'moe'],
      rationale: {
        'zh-CN': '多步代理交互须串行保留中间状态：单并发、宽上下文、适度随机。',
        en: 'Multi-step agent turns keep intermediate state in series: single concurrency, wide context, moderate temperature.',
      },
      constraints: { maxConcurrency: 1 },
      parameterHints: {
        contextLength: { min: 8192, max: 65536 },
        temperature: { min: 0.0, max: 0.6 },
        maxTokens: { min: 2048, max: 8192 },
      },
      scoringWeights: { vramEfficiency: 0.15, latency: 0.3, throughput: 0.3, quality: 0.25 },
    },
    {
      taskKind: 'creative-writing',
      applicableArchitectures: ['dense', 'moe'],
      rationale: {
        'zh-CN': '创作注重多样性与文采：较高温度与 top-p，上下文适中即可。',
        en: 'Creative writing values diversity and style: higher temperature and top-p, moderate context.',
      },
      parameterHints: {
        contextLength: { min: 4096, max: 16384 },
        temperature: { min: 0.7, max: 1.1 },
        topP: { min: 0.9, max: 1.0 },
      },
      scoringWeights: { vramEfficiency: 0.15, latency: 0.2, throughput: 0.15, quality: 0.5 },
    },
    {
      taskKind: 'vision',
      applicableArchitectures: ['vision'],
      rationale: {
        'zh-CN': '视觉任务需图像 token 预算：按图像数量放大上下文，输出与输入分离。',
        en: 'Vision tasks need image-token budget: context grows with image count, output stays decoupled from input.',
      },
      parameterHints: {
        contextLength: { min: 4096, max: 16384 },
        maxTokens: { min: 1024, max: 4096 },
      },
      scoringWeights: { vramEfficiency: 0.15, latency: 0.25, throughput: 0.2, quality: 0.4 },
    },
    {
      taskKind: 'custom',
      rationale: {
        'zh-CN': '用户自定义任务形状：不施加预置约束与参数提示，交由 Profile 自身设定决定。',
        en: 'User-defined task shape: no preset constraints or hints apply; the profile itself decides.',
      },
    },
  ],
};

// Developer-time guard: the seed must always satisfy the strict contract.
// A throw here means someone shipped a seed that the schema rejects.
const seedCheck = StrictRulesDocumentSchema.safeParse(SEED_RULE_CATALOG);
if (!seedCheck.success) {
  throw new Error(`SEED_RULE_CATALOG failed strict validation: ${seedCheck.error.message}`);
}