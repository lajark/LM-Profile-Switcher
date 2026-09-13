# Real-Machine Benchmarks / 真机基准测试

> 完整实测数据与测量方法。README 只保留摘要。本文所有数字来自本机真实 LM Studio 会话（LOCAL-ONLY 原始记录由维护者留存），不构成性能保证。

> **0.2.1-beta.1 v2 重测状态：已完成（2026-09-13）**——维护者本机以 `LMPS_LM_TOKEN` 按 v2 契约重新实测 9B/27B/35B（各 3 样本，`ResourceUsageEvidence` v1 `completeness=complete`），原始记录 `.workspace/bench-v2-*.json`（LOCAL-ONLY）。下方 0.2.0 时代数字保留为历史诊断；v2 数字已合并进本文件与发布说明。

## Test system / 测试环境

- **GPU**：RTX 5060 Ti 16 GB（驱动 596.36）
- **CPU**：Intel Core Ultra 5 225H（14C/14T）
- **RAM**：31.4 GiB
- **OS**：Windows 11
- **LM Studio server**：`127.0.0.1:1234`
- **测量工具**：`lmps benchmark`（默认 3 样本 × 64 tokens；下表标注复测样本数）
- 9B 运行于 `8k context / max GPU offload`；27B/35B 采用自适应 offload 梯度（Q4_K_M 量化）

> **校准勘误（M6-001，2026-09-12）**：0.2.0-beta.1 的 Benchmark 在加载后与推理后复用了加载前硬件快照，并把绝对显存用量与 GPU+系统内存估算比较；27B/35B 校准值仅作历史诊断，**不是有效资源证据**。升级到 0.2.1-beta.1 后请重新 `benchmark --yes` 以获得同步采样的显存/系统内存增量证据。

## Qwen3.5-9B-Q4_K_M（5.2 GB，全量驻留 GPU）

**2026-09-12 复测**（2 样本 × 64 tokens）：

| 指标 | 基线（max/8k/0.7） | `optimize` 后 | Δ |
| --- | ---: | ---: | ---: |
| 加载时间 (ms) | 6295 | 6271 | −0.4% |
| TTFT (ms) | 119 | 120.5 | +1.3% |
| Prefill (tok/s) | 160.1 | 159.1 | −0.6% |
| Decode (tok/s) | 63.6 | 63.5 | −0.1% |
| 峰值显存 (GiB) | 0.253 | 0.253 | 0.0% |

结论：`lmps` 自身几乎零开销——decode 稳定在 ~63–65 tok/s、峰值显存与裸机一致、全程本地。这类模型上优化器的价值在配置治理（记录、Schema 校验、`apply` 可复现）而非提速。（2026-09-10 曾观测 context 8192→4096 候选带来 −18.3% TTFT；依赖所选候选，不作为稳定承诺。）

### v2 重测（2026-09-13，3 样本 × 64 tokens，max offload / 8k / 0.7）

| 指标 | v2 实测 |
| --- | ---: |
| Decode (tok/s) | 63.05 |
| Prefill (tok/s) | 231.88 |
| TTFT (ms) | 144 |
| 加载时间 (ms) | 22942 |
| VRAM 增量峰值 (GiB) | 6.48 |
| 系统内存增量峰值 (GiB) | 6.00 |
| 总内存增量峰值 (GiB) | 12.48 |

> `ResourceUsageEvidence` v1 `completeness=complete`（host-snapshot-delta，3 样本）。

## Qwen3.8-27B-Q4_K_M（15.7 GB，临近显存上限）

- **不再拒绝超显存模型**：offload 梯度（`0 / 0.25 / 0.50 / 0.75 / off`）生成分档候选并做资源分类——`offload-0` → `resource-insufficient`，`offload 0.25/0.50/0.75` → `gpu-resident` 且可推荐。
- **历史校准警告**：≈0.25 GiB 对比 ≈19.2 GiB 及 `ratio≈0.013` 审计行来自无效的 0.2.0-beta.1 契约，仅作追溯；须 v2 证据后方可信任实测回流。
- **诚实速度说明**：16 GB 主机上推荐挡位无法比 `max` 更激进驻 GPU，更高 offload 不提升 decode（≈9.9 → ≈8.0 tok/s）；价值是可运行性 + 测量。

| 27B 指标 | `max`（基线） | offload 0.75 |
| --- | ---: | ---: |
| Decode (tok/s) | ≈9.9 | ≈8.0 |
| TTFT (ms) | ≈1700 | ≈2160 |
| 加载时间 (ms) | ≈36865（冷） | ≈11000（热） |
| 实测峰值显存 (GiB) | ≈0.25 | ≈0.25 |

### v2 重测（2026-09-13，3 样本 × 64 tokens，max offload / 8k）

| 指标 | v2 实测 |
| --- | ---: |
| Decode (tok/s) | 7.87 |
| Prefill (tok/s) | 21.64 |
| TTFT (ms) | 1479 |
| 加载时间 (ms) | 34831 |
| VRAM 增量峰值 (GiB) | 14.00 |
| 系统内存增量峰值 (GiB) | 14.55 |
| 总内存增量峰值 (GiB) | 28.55 |

> `ResourceUsageEvidence` v1 `completeness=complete`（host-snapshot-delta，3 样本）。v2 契约下 VRAM 增量与系统内存增量合计约 28.6 GiB，远超单显卡 16 GB——该模型在本机以混合内存方式运行，校准比较现基于同步增量而非绝对驻留。

## Qwen3.6-35B-A3B-Q4_K_M（19.7 GB MoE，超出显存）

- 梯度产出 `offload-0` → `resource-insufficient`、`offload 0.25/0.50` → `gpu-resident`；≈0.25 GiB 对比 ≈21.4 GiB 校准比较在 0.2.0-beta.1 契约下无效，仅作历史。
- 更高 offload 不提升 decode（≈27.2 → ≈24.6 tok/s）；价值是可运行性，非校准/速度承诺。

| 35B 指标 | `max`（基线） | offload 0.5 |
| --- | ---: | ---: |
| Decode (tok/s) | ≈27.2 | ≈24.6 |
| TTFT (ms) | ≈596 | ≈710 |
| 加载时间 (ms) | ≈45090（冷） | ≈24000（热） |
| 实测峰值显存 (GiB) | ≈0.25 | ≈0.25 |

### v2 重测（2026-09-13，3 样本 × 64 tokens，max offload / 8k）

| 指标 | v2 实测 |
| --- | ---: |
| Decode (tok/s) | 23.91 |
| Prefill (tok/s) | 20.54 |
| TTFT (ms) | 705 |
| 加载时间 (ms) | 43480 |
| VRAM 增量峰值 (GiB) | 12.91 |
| 系统内存增量峰值 (GiB) | 16.95 |
| 总内存增量峰值 (GiB) | 29.86 |

> `ResourceUsageEvidence` v1 `completeness=complete`（host-snapshot-delta，3 样本）。v2 契约下 VRAM 增量约 12.9 GiB（MoE 权重驻留）+ 系统内存增量约 17.0 GiB，合计约 29.9 GiB；校准比较现基于同步增量而非绝对驻留。

## Measurement conditions and honest notes / 测量条件与诚实标注

- 9B 首次基线命中冷磁盘缓存（峰值 271 MB / 加载 23.5 s）；上表为干净复测值。
- 27B/35B 数值为 2026-09-12 会话真机实测（RTX 5060 Ti 16 GB + 外接硬盘），实测峰值仅反映服务端报告的 GPU 驻留峰值，不代表主机内存总用量。
- 27B/35B 的 `max` 基线是作者手动调出的运行配置，不是 LM Studio 出厂默认。
- **v2 重测（2026-09-13）**：9B/27B/35B 均以 `max` offload / 8k context 实测，`resourceUsage` 为同步硬件快照增量（加载前/后 + 每次推理后），`completeness=complete`，可作推荐回流证据；原始 `bench-v2-9b/27b/35b.json` 为维护者本机 LOCAL-ONLY 记录。
- 功能修复（2026-09-12）：数值 offload 挡位经 REST v1 `/load` 提交的 `gpu_offload` 键会被 LM Studio 以 `400 unrecognized_keys` 拒绝导致 benchmark 崩溃；已改为数值挡位走 `lms load --gpu <ratio>`（measure 仍走 REST chat），`max`/`off`/`auto` 维持 REST 加载。
- **实测排序（2026-09-12）**：配置已在本机 benchmark 后，`optimize` 不再按静态启发式排序，实测候选提升至列表顶部并按真实 decode 吞吐与 TTFT 排序。真机验证（qwen3.5-9b）：`optimize --yes` 保存头号候选 → `benchmark` 实测 decode=64.1 tok/s 并记录精确快照（`gpuOffload=0, context 36864, temperature 0.2`）→ 下次 `optimize` 逐值匹配并标记 `MEASURED`（`adjustedTotal=0.70, confidence=high`）提升至顶部。

## Known limitations / 已知限制

- 单一测试平台（RTX 5060 Ti 16 GB / Windows 11）；其他硬件、驱动、LM Studio 版本与模型量化下的表现可能不同。
- 27B/35B 的校准值已由 2026-09-13 v2 契约重测（同步增量、`completeness=complete`）更新，可参与推荐；0.2.0 时代的无效比较仅作历史诊断保留。
- 测量结果反映所声明配置下的行为，不是性能保证；欢迎在 Issue 中提交你的硬件×模型组合供后续扩展。
