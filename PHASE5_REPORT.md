# 阶段五完成报告 — 统一标准化、字段映射、分类建议、去重与跨币匹配

> 日期：2026-08-28 ｜ 项目：`life-workbench-native`（Expo 52 / RN 0.76.9）
> 依赖技术选型已在阶段一~四确认；本阶段纯逻辑、RN-free、可单测，**未修改任何 UI、未生成/签名/安装 APK、未上传任何流水文件**。

## 测试结果（全绿）
- 阶段五单测 **47 passed / 0 failed**
- 阶段四回归 **46 passed** ｜ 阶段三 **39** ｜ 阶段二 **55** ｜ 阶段一 **50**
- 既有 notify 基线 **全 GREEN**（confirm-form 27 等）
- `tsc --noEmit` **0 错误**

## 新增 / 修改文件

### 共享匹配层（按 IMPLEMENTATION_PLAN §4.3 / R5 抽出，通知与导入共用）
- `src/import/matchers/types.ts`
  - `Matchable` 统一接口（id / accountKey / amountMinor / currency / merchantNorm / date / sourceRef / bankRef / postingStatus / orig+settle）。
  - `normMerchant(s)`、`toMatchable(candidate)`、`toMatchableFromTxn(t)`、`candidateAccountKey`、`dayDiff`。
- `src/import/matchers/duplicate.ts` — **P1/P2/P4** 三档去重：
  - P1 确定重复：同 `accountKey` + 同 `sourceRef`/`bankRef` → 默认不导入。
  - P2 疑似：同 `accountKey` + 同日 + 同金额 + 同币种 + 同 `merchantNorm` → 需用户确认。
  - P4 仅描述相似 → **不**认定重复。跨账户永不匹配（不同真实账户）。
- `src/import/matchers/transfer.ts` — A `expense` ↔ B `income`（不同账户、同额、同日、含「转账」关键词）→ 建议合并为单笔 `transfer`，需确认。
- `src/import/matchers/refund.ts` — `refund` ↔ 同账户等额 `expense` + `merchantNorm` 一致 + 时间窗（默认 30 天）→ 建议 `linkedTxnId` 关联；`countInStats` 冲减、不双计。
- `src/import/matchers/crossCurrency.ts` — **跨币信用卡匹配**（取代 `notify/dedup.findPostingMatch`）：
  - MYR `awaiting_posting` ↔ CNY `posted`（同账户、`merchantNorm` 重叠、±3 天、ref 一致/空）→ 配对。
  - `reconcileCrossCurrency()`：只把真实 CNY 结算补到原交易（写 `settleAmountMinor/settleCurrency(CNY 账户币种, 符合 R1)/fxRate/fxSource='card'/isPosted`），**绝不新增第二笔支出**。

### 标准化与分类（IMPLEMENTATION_PLAN §4 / R2）
- `src/import/standardize.ts`
  - 锚定 `origAmountMinor/origCurrency`（下游去重/匹配统一基准）。
  - 文件自带真实结算（历史汇率）→ **保留** `settle*`，绝不用当前汇率覆盖（R2）。
  - 无结算时仅算 `predictedSettleMinor`（展示「约」），**不写** `settleAmountMinor` 进历史事实。
- `src/import/autoCategorize.ts` — 商户/关键词→分类（餐饮/交通/购物/娱乐/账单/医疗/收入/转账还款/退款/其他），填充 `missing_category` 警告。

### 统一编排（Phase 6 预览的数据源，非 UI）
- `src/import/unify.ts` — `buildImportPreview(candidates, opts)`：分类 → 标准化 → 建 Matchable（可注入 `accountKeyResolver`）→ 跑四个匹配器 → 输出 `UnifiedPreview`（每行 `dupStatus/skipByDefault/建议转账/建议退款` + 汇总计数 + crossCurrencyPairs）。纯函数、无 IO、无持久化、无汇率覆盖。

### 模型微调（仅为承载可选结算/账户锚点）
- `src/import/models.ts`：`ImportCandidate` 增加可选 `settleCurrency? / settleAmountMinor? / accountId?`（与 `Txn` 对齐，供预览/提交阶段使用；始终不存 PII）。

### 测试与接线
- `src/import/__phase5_tests.ts` — 47 条脱敏样本（标准化预测/历史结算不被覆盖、分类、P1/P2/P4、跨账户、转账、退款、跨币配对+reconcile fxRate 校验、unify 端到端含跨币对）。
- `scripts/import-test-runner.js` — 已加入 8 个新模块 + Phase 5 套件。

## 已守住的约束
- 跨币：只补全、不捏造；结算币种 = 账户币种（R1）；当前汇率仅用于「约」展示（R2）。
- 去重仅同账户内；描述相似不误判（P4）。
- 全部样本脱敏，无卡号/账号/明文描述；Matchable 仅含归一化非 PII 字段。
- 未触碰 notify 既有实现，仅新增可共用的匹配层（后续阶段按 R5 把 `notify/dedup.findPostingMatch` 委托给 `CrossCurrencyMatcher`，本次未改以免回归）。

## 已知限制 / 留给后续阶段
1. **真实账户解析**：`accountKey` 默认用 `accountHint`（支付宝/微信/TNG）。跨币「MYR 通知 + CNY 账单」需把同一 CNY 卡的 hint 解析为同一 `accountId` —— 放在 Phase 6 的账户解析/分配逻辑，本阶段 `unify` 已预留 `accountKeyResolver` 注入点。
2. `reconcileCrossCurrency` 在 Phase 6 **提交时**调用（写回原交易）；本阶段只验证算法与字段。
3. `recomputeAccounts` 拆分「已入账 posted / 预计 awaiting」(R3) 与通知链路重构（R4/R5）属 Phase 6 的提交/重算部分。
4. 导入入口 UI、预览/报告/撤销页在 Phase 6。

请确认阶段五结果。确认后进入 **阶段六：统一预览、原子提交、自动重算、导入报告与整批撤销**（含 `ImportService` 原子提交/回滚、撤销、报告生成、及把 `recomputeAccounts` 的 posted/awaiting 拆分接线）。
