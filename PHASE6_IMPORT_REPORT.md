# 阶段六（导入）完成报告 — 统一预览、原子提交、自动重算、导入报告与整批撤销

> 日期：2026-08-28 ｜ 项目：`life-workbench-native`（Expo 52 / RN 0.76.9）
> 本阶段纯逻辑、RN-free、可单测。**未修改任何 UI 屏幕、未生成/签名/安装 APK、未上传任何流水文件。**
> 注：仓库内既有的 `PHASE6_OVERVIEW.md` 属于「通知自动记账」管线，与本文件（导入管线阶段六）无关。

## 测试结果（全绿）

| 套件 | 结果 |
|------|------|
| 阶段六 导入 `ImportService` / `recompute` R3 | **64 passed / 0 failed** |
| 阶段五 回归 | 47 passed |
| 阶段四 回归 | 46 passed ｜ 阶段三 39 ｜ 阶段二 55 ｜ 阶段一 50 |
| notify 基线（confirm-form 27 + phase6 28 等） | 全 GREEN |
| `tsc --noEmit` | **0 错误** |

导入管线累计 **301 条断言**全绿；`tsc` 在改动 `calc.ts` 后无任何类型错误。

## 交付内容

### 1. `ImportService`（原子提交 / 回滚安全撤销 / 自动重算 / 报告）
- `src/import/importService.ts`
  - **`buildCommitPlan(preview, opts)`** — 纯函数，把 `UnifiedPreview` 落成待提交 `Txn[]`：
    - **跨币合并**（R1/R4）：MYR `awaiting` + CNY `posted` 同一卡账户 → **仅 1 笔** `expense`，`origCurrency=MYR`、`settleCurrency=账户币种(本例 CNY)`、`fxRate/fxSource='card'`、`isPosted=true`。
    - **转账合并**：A 支出 ↔ B 收入（不同账户、同额、同日、含「转账」）→ 1 笔 `transfer`（`accountId=A, toAccountId=B`）。
    - **退款关联**：`refund` → `linkedTxnId` 指向原 `expense`，`countInStats=true` 冲减、不双计。
    - **文件自带历史结算保留**（R2）：`settleAmountMinor/settleCurrency/fxRate/fxSource='system'`，绝不写当前汇率。
    - **`awaiting_posting` → `isPosted=false`**：不捏造结算额（R3）。
    - **跨来源去重抑制**：与现有账本中同账户/同日/同额/同商户归一化串的交易自动跳过，避免重复导入。
  - **`commit(backend, preview, opts)`** — 读全量 → 纯计算 → **单次写回**：若 `buildCommitPlan` 抛错则完全不落盘，杜绝半批。提交后自动 `recomputeAccounts` 重算账户。
  - **`undo(backend, batchId)`** — 按 `txnIds` 删除 + 重算 + 把 batch 置 `undone`（保留审计，不物理删）。重复/未知 batch 安全拒绝。
  - **`summarizeReport()`** — 生成 **PII-free** 中文摘要串（仅计数/整数金额，无商户名）。
  - **`PersistenceBackend`** 接口 + `createMemoryBackend` 桩：RN 的 `AsyncStorage` 适配器是集成步骤（见下方「后续」），本阶段用内存桩单测。

### 2. `recomputeAccounts` 的 posted/awaiting 拆分接线（R3）
- 新增 **RN-free** 模块 `src/import/recompute.ts`，把 `recomputeAccounts / cardSummary / financeStats / financeSummary` 从 `calc.ts` 迁出（因 `calc.ts` 依赖 `store.ts`/RN，无法在 Node 单测）。`calc.ts` 改为 **re-export**，屏幕（`FinanceScreen.tsx`）引用路径不变。
- 拆分逻辑：
  - 信用卡：`isPosted=true` → `_postedBill`（**已确认负债**）；`isPosted=false` → `_awaiting`（仅「约」展示）。
  - `currentBillMinor` = 已确认账单（已扣已还）；`unbilledMinor` = 预计（awaiting）。
  - `financeSummary`：**`liabilitiesMYR` / `netWorthMYR` 仅含已确认（posted）**，新增 `predictedLiabilitiesMYR` / `predictedNetWorthMYR` 含 awaiting（标「约」）。
- 已用单测证明：信用卡 post 10,000 + awaiting 5,000 → 确认负债 10,000、确认净资产按 posted 计、预测净资产含 awaiting（FX 折算以 MYR 为基准，与 `FxSetting.base='MYR'` 一致）。

### 3. 隐私与审计
- `ImportBatch`（审计记录，经 `buildImportBatch`）**仅存 `txnIds` + 数值汇总**，绝不存商户名/卡号/账号。`undo` 只需 `txnIds` 即可删除 + 重算 —— 既简单又满足 PII 最小化（比原 `§5.2` 存全量回滚快照更省且更隐私合规）。

## 新增 / 修改文件
- **新增** `src/import/importService.ts` — ImportService 核心。
- **新增** `src/import/recompute.ts` — RN-free 重算/汇总（R3）。
- **修改** `src/calc.ts` — `recomputeAccounts/cardSummary/financeStats/financeSummary` 改为从 `./import/recompute` re-export（屏幕无感）。
- **新增** `src/import/__phase6_tests.ts` — 64 条脱敏断言。
- **修改** `scripts/import-test-runner.js` — 加入 `recompute.ts`/`importService.ts` + Phase 6 套件。

## 已守住的约束
- 跨币：只补全、不捏造；结算币种 = 账户币种（R1）；当前汇率仅「约」展示（R2）。
- 去重仅同账户内；与现有账本重复自动跳过。
- 全部样本脱敏；`ImportBatch` 零 PII。
- 未触碰任何 UI 屏幕、未生成 APK、`tsc` 全绿、notify 基线无回归。

## 已知限制 / 留给后续（集成）步骤
1. **RN `PersistenceBackend` 适配器**：目前用内存桩。需实现基于 `AsyncStorage` 的适配器（新增 key `wb_life_import_batches` 存 batches；txns 并入 `wb_life_txns`），并挂到 `useData`/store。属 UI 集成，未做（按约定不动 UI、不装 APK）。
2. **导入入口 UI**：「财务 → 流水 → 右上角「导入流水」+ 更多菜单同入口」、统一预览/报告/撤销页、加密 PDF 密码对话框（逻辑 `pdfPassword.ts`/`pdfExtractFlow.ts` 已在阶段四就绪，仅缺 React 对话框组件）。这些按原始技术选型属于「统一入口」，建议作为独立 PR/阶段实现并在真机验证。
3. **跨来源匹配**：本阶段去重/关联均在「本次导入批次内」进行；与历史账本的交叉匹配（如把新导入行关联到已存在的 `linkedTxnId`）已做重复跳过，但未做「关联补全」——如需，可在 `buildCommitPlan` 增加与现有 `Txn` 的匹配分支（需同步扩展 undo 的 `modifiedTxnIds` 还原）。
4. **期初余额（R8）**：`recomputeAccounts` 已 seed `openingBalanceMinor`；建账即有余额场景天然支持，无需强升 schema。

请确认阶段六（逻辑层）结果。确认后建议进入「集成阶段」：实现 `AsyncStorage` 适配器 + 导入入口 UI + 密码对话框，并在真机验证（需生成/安装 APK，按约定单独确认）。
