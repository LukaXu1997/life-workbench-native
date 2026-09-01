# 付款通知自动记账 + 统一交易导入器 — 实施方案（待确认，未动代码）

> 本文档是 **UNIFIED_IMPORTER_DESIGN.md 的修订与落地版**。它先分析现有模型，再给出统一状态流转、跨币/去重算法、迁移与回滚、测试用例，并**逐条指出原设计稿与你的新规则冲突之处 + 修订**。
> 状态：**仅方案，未修改任何代码、未出 APK、未装手机**。等你确认后再分阶段实现。

---

## 1. 现有模型检查（Txn / PendingRecord / Account / ImportCandidate / ImportBatch）

### 1.1 `Txn`（`src/types.ts:12`）— 已具备双币种，可直接复用
关键字段已存在，适配器/确认逻辑**无需发明新字段**：
- `type: 'income'|'expense'|'transfer'|'repayment'|'refund'`
- 双币种：`origAmountMinor/origCurrency`（原始，如 MYR 10000）、`settleAmountMinor/settleCurrency`（结算，如 CNY 16800）、`fxRate/fxSource`
- 账户与卡：`accountId`、`toAccountId`、`cardId`、`isCardTxn`、`isPosted`、`postedAmountMinor`、`isRepaid`、`linkedBillId`、`linkedTxnId`
- 统计：`countInStats`（退款默认 true，冲减原支出）
- 通用：`category`、`merchant`、`note`、`date`、`time`、`createdAt`

> 结论：`ImportCandidate` **标准化后直接映射 Txn**，不新增 Txn 字段（仅追加 1 个展示用 `predictedSettleMinor?`，见 §4/§7）。

### 1.2 `PendingRecord`（`src/types.ts:160`）— 通知链路已落地
通知记账**已实现并验收**（V1.2.2 真机通过）。字段含 `amountMinor/currency/merchant/suggestedAccountId/suggestedCategory/confidence/fingerprint/status('pending'|'confirmed'|'ignored'|'matched')/kind/predictedSettleMinor/postingStatus/bankRef/matchOfId/txnId/needsReview`。
- 流程：native `NotifyListener` → 白名单门 → 队列+实时事件 → `ingestEnvelope`（rawDigest 去重 + `recognize` + `findPostingMatch`）→ `PendingRecord` → `ConfirmTxnScreen` 自动填充（已修，late-load 同步 + 不改覆盖）→ `confirmPending` → `buildTxnFromPending` → `store.setTxns`。
- **已满足**你的 §二.5/§二.7：金额/币种/商户/分类建议/建议账户自动填；真实 TNG/支付宝/微信按包名建议账户；ADB 模拟（com.android.shell）留空让用户选；late-load 用 `useEffect`+`touched` 守卫。

### 1.3 `Account`（`src/types.ts:45`）— 余额派生已合规，但有开口
- `balanceMinor?`（cash/debit/ewallet 当前余额）、`creditLimitMinor/currentBillMinor/unbilledMinor/repaidMinor`（卡）、`stmtDay/dueDay`、`includeInNetWorth`。
- `calc.recomputeAccounts`（`src/calc.ts:170`）**从 0 派生**余额（`_bal` 初值 0，累加交易），即余额不靠直接维护 `currentBalance` —— 已符合你的 §八末条「从有效交易重新派生」。
- **缺口**：没有「期初余额」字段。全新用户建账时若账户已有余额但无交易，会显示 0。见 §7 修订 R8（建议加 `openingBalanceMinor?` 并 seed 进 `_bal`）。当前数据因「0 + 全量交易」已正确，故属可选增强。

### 1.4 `ImportCandidate` / `ImportBatch` — **尚不存在**（仅设计稿概念）
需新增，规格见 §5 与下方修订。导入器与通知链路的**统一点**是：两者最终都汇入 `Txn` + `recomputeAccounts`，并共享四个匹配器（去重/转账/退款/跨币）。

---

## 2. 需修改 / 新增的文件

### 新增（核心，RN-free 纯模块优先）
```
src/import/
  models.ts                     # ImportFileType/ImportSource/DetectionResult/ImportCandidate/ImportParseResult/ImportBatch/ImportWarning/ImportError
  UnifiedTransactionImporter.ts # 编排：检测→路由→标准化→匹配→装配预览（无平台规则）
  FileTypeDetector.ts           # 签名优先于扩展名（%PDF-/PK.. / JSON / CSV heuristic）
  SourceDetector.ts             # §来源签名 + 置信度阈值
  ImporterRegistry.ts           # 注册 + 自动路由 + 手动选择仍走 validate 门禁
  ImportService.ts              # validateBatch / commit(原子) / revert / report
  matchers/
    DuplicateMatcher.ts         # 优先级 1&2（同单号 / 同账户日期金额商户）
    TransferMatcher.ts          # 转账配对（A 支出 ↔ B 收入 同额同日）
    RefundMatcher.ts            # 退款配对（refund ↔ 原 expense）
    CrossCurrencyMatcher.ts     # 跨币信用卡 posted 匹配（通知↔导入共享，取代 notify/dedup.findPostingMatch）
  Standardize.ts                # 币种/金额/日期归一（不改写历史汇率）
  AutoCategorize.ts             # 商户/关键词→category 建议
  ImportReport.ts               # 导入报告生成
  adapters/
    TngPdfAdapter.ts AlipayCsvAdapter.ts WechatXlsxAdapter.ts
    GenericCsvAdapter.ts GenericXlsxAdapter.ts LifeWorkbenchJsonAdapter.ts
  parsers/
    MoneyParser.ts DateParser.ts EncodingDetector.ts PdfTableParser.ts SpreadsheetParser.ts
  storage/ImportBatchStore.ts   # ImportBatch 读写（AsyncStorage key）
  tests/run-importer-tests.js + tests/fixtures/
```

### 新增（UI，本次方案先列出，确认后再写）
```
src/screens/ImportFlowScreen.tsx      # 文件选择 → 进度/密码
src/screens/ImportPreviewScreen.tsx   # 统一预览（所有来源同一组件）
src/screens/ImportReportScreen.tsx    # 报告 + 撤销入口
```

### 修改（最小化）
- `src/notify/dedup.ts`：`findPostingMatch` 改为委托 `import/matchers/CrossCurrencyMatcher`（统一）。
- `src/notify/confirm.ts` + `confirmStore.ts`：跨币「预测 vs 实际」分离（predicted 仅展示，posted 才写 settle）；导入与通知共用 `CrossCurrencyMatcher`。
- `src/calc.ts` `recomputeAccounts`：信用卡账单**拆分「已入账/预计」**，awaiting_posting 不计入已确认负债（见 §4/§7-R3）。
- `src/types.ts`：新增 `ImportCandidate/ImportBatch/...` 模型；可选加 `Account.openingBalanceMinor?`、`Txn.predictedSettleMinor?`。
- `src/store.ts`：可选 `getImportBatches/setImportBatches`（或交给 ImportBatchStore）。
- `src/screens/FinanceScreen.tsx`：加「导入流水」入口（唯一可见入口）。
- `App.tsx` / 现有导航：挂载 ImportFlow 路由。
- `package.json` 依赖：`expo-document-picker`、`xlsx`(SheetJS)、GB18030 解码方案、PDF 抽取方案、`zod`(可选，JSON 校验)。**PDF 抽取与 GB18030 是 RN 技术选型待定项**（见 §9 原设计稿，仍待你拍板）。

> 通知链路（§二）**基本已存在**，本次主要改动在：① 跨币预测/入账分离；② 把匹配器抽成共享；③ 新增导入器（§三）。

---

## 3. 通知记账 与 文件导入 的统一状态流转

两个入口最终都收敛到 `Txn` + `recomputeAccounts`，并共享四个匹配器。

### 3.1 通知记账（已实现，此处标出与导入的衔接点）
```
[Android 通知]
  → NotifyListener(原生) → 白名单门(enabled&&!paused&&allowSet)
  → 信封入队 + 实时事件
  → JS startNotifyReceiver 排空队列 / onNotifyReceived
  → ingestEnvelopes → ingestEnvelope
       ├─ rawDigest 去重（同条通知不重复）
       ├─ recognize: 金额/币种/收支/商户/时间/状态 + 按包名建议账户 + 分类建议
       └─ CrossCurrencyMatcher.findPostingMatch（CNY posted 匹配原 MYR awaiting）
  → PendingRecord(status=pending|matched) → wb_life_pending
  → FinanceScreen 横幅(usePendingCount>0) → PendingScreen → openConfirm(id)
  → ConfirmTxnScreen 自动填充(confirmForm, late-load 同步, touched 守卫)
  → confirmPending → (match? reconcilePostingMatch 改原 Txn settle : buildTxnFromPending)
  → store.setTxns + pending.status='confirmed'/txnId
  → useData 触发 recomputeAccounts
```

### 3.2 文件导入（新增）
```
[FinanceScreen「导入流水」]
  → ImportFlowScreen → expo-document-picker 选文件
  → UnifiedTransactionImporter.run(file):
      1) FileTypeDetector.detect   （签名，非扩展名）
      2) SourceDetector.detect     （内容签名 → source+confidence+encrypted）
      3) confidence<0.5 | UNKNOWN → 让用户选来源（仍强制 adapter.validate）
      4) ImporterRegistry.resolve  → adapter
      5) 加密 PDF → 内存密码输入框（不落盘）
      6) adapter.parse → ImportParseResult(candidates)
      7) Standardize（币种/金额/日期；不覆盖历史汇率）
      8) AutoCategorize
      9) 四个匹配器：Duplicate / Transfer / Refund / CrossCurrency
  → ImportPreviewScreen（单一组件，所有来源同渲染）
       · 顶部：来源 + 时间范围 + 总笔数
       · 汇总：可导入/需确认/确定重复/疑似重复/建议转账/建议退款/无效
       · MYR收/支、CNY收/支、预计账户变化、预计卡负债、与文件汇总差异
       · 每条：编辑/忽略/改账户/改分类/改类型/改币种/确认退款/合并转账/处理重复
       · 「来源识别错误」→ 重走手动选择（仍 validate）
  → 用户确认 → ImportService.commit(batch):
       validateBatch（任一严重错→整批不动、不碰余额/预算/负债）
       → createRollbackSnapshot（store 全量快照）
       → commitBatchAtomically（合并新增 + 修改关联；跨币补全原交易）
       → recomputeFinance（recomputeAccounts）
       → persistImportBatch(status='committed')
  → ImportReportScreen（报告 + 撤销入口）
```

### 3.3 两者的统一点
- **统一写入**：都生成 `Txn`（导入走批量原子提交；通知走单条确认）。
- **统一重算**：都经 `calc.recomputeAccounts`。
- **统一匹配器**：`DuplicateMatcher/TransferMatcher/RefundMatcher/CrossCurrencyMatcher` 定义在 `src/import/matchers/`，**同时**被 `confirm.ts`/`confirmStore.ts`（通知）与 `ImportService`（导入）消费。匹配器接受统一 `Matchable` 接口（见 §4），`PendingRecord`/`ImportCandidate`/`Txn` 都可喂入 —— 这是跨「通知 MYR 消费」与「导入 CNY 账单」做跨币合并的关键。

---

## 4. 跨币信用卡匹配 + 去重算法

### 4.1 统一 `Matchable` 接口（匹配器输入）
```ts
interface Matchable {
  id: string;
  accountId?: string;
  origAmountMinor?: number; origCurrency?: Currency;
  settleAmountMinor?: number; settleCurrency?: Currency;
  merchantNorm: string;            // normMerchant()
  date: string;                    // YYYY-MM-DD
  bankRef?: string;
  postingStatus?: 'awaiting_posting' | 'posted' | null;
  sourceRef?: string;              // 平台原单号
  type?: TxnType;
}
```

### 4.2 去重优先级（对应你的 §七）
- **P1 确定重复**：同 `accountId` + 同 `sourceRef`（平台交易单号/bankRef）→ `duplicate=true`，默认不导入。
- **P2 高度疑似**：同 `accountId` + 同 `date`（同日） + 同 `origAmountMinor` + 同 `origCurrency` + 同 `merchantNorm` → `suspectedDuplicate=true`，**需用户确认**。
- **P4 仅描述相似**：不满足 P1/P2 的相似（如仅商户名像）→ **不**自动认定重复。

### 4.3 跨币信用卡匹配（对应你的 §五，取代 notify/dedup.findPostingMatch）
- 输入：一条 `awaiting_posting` 的 MYR 消费（orig MYR，settle 未定/仅预测） + 一条同 CNY 信用卡账户上的 `posted` CNY 记录（orig=settle=CNY）。
- 匹配条件：`sameAccount` + `merchantNorm` 重叠（相等/包含） + 时间窗（默认 ±3 天，可配） + `!bankRef || bankRef 相等`。
- 输出：链接（`matchOfId`），标记 `crossCurrencyCard`。
- **提交时**（Confirm/Import 共用 `reconcilePostingMatch` 思路）：
  - 写 `settleAmountMinor=实际¥`、`settleCurrency='CNY'`、`fxRate=实际(¥/RM)`、`fxSource='card'`、`isPosted=true`。
  - **绝不新增第二笔支出**；只补全原交易的结算字段。
- 场景映射（对应你的 §五）：
  - 仅通知 RM100 → 存为 `awaiting_posting` 待入账；**不捏造 ¥**；用当前汇率显示 `predictedSettleMinor` 并标「约/预计」。
  - 账单出现 ¥168 → 匹配并补全原交易（用户确认）。
  - 仅账单 ¥168 无 RM → 进 CNY 卡负债，标「缺少原始消费金额」，暂不计入 MYR 本地统计，允许后续与通知合并。

### 4.4 退款匹配（RefundMatcher）
- 候选 `type='refund'`（或适配器识别为退款成功） + 同账户 + 时间窗内存在等额/相近 `expense` + `merchantNorm` 一致 → 建议 `linkedTxnId` 关联。
- 提交：`type='refund'`、`linkedTxnId` 指向原支出、`countInStats=true`（冲减原支出，不重复计）。

### 4.5 转账匹配（TransferMatcher）
- 两条候选或「候选 + 已有」：A 账户 `expense` ↔ B 账户 `income`、同额、同日、商户含「转账/transfer/转入」→ 建议合并为单笔 `transfer`（accountId=A, toAccountId=B）。需用户确认，避免双计。

### 4.6 与现有 `recomputeAccounts` 的协同（重要）
- 当前 `recomputeAccounts` 把 `awaiting_posting` 的预测 settle 也加进 `_bill`（`!txnIsPosted` 时加 `_unbilled`）。这与「不得捏造实际结算金额」「可以先保存为待入账」冲突（见 §7-R3）。
- 修订：拆分 **已入账（posted）** 与 **预计（awaiting）**。仅 `isPosted=true` 计入已确认账单；`awaiting` 进入独立的 `predictedSettleMinor` 展示值（标「约」），**不计入负债/净资产**。

---

## 5. 数据库迁移及回滚方案

### 5.1 是否需要 schema 版本升级
- `Txn` 已含全部字段；导入器只新增 AsyncStorage key（`wb_life_import_batches` 等），**不破坏现有结构** → `SCHEMA_VERSION` 可保持 2，仅新增 key（向后兼容）。
- 若采纳 §7-R8 的 `openingBalanceMinor`/`predictedSettleMinor`，属**新增可选字段**（旧数据缺省按兼容逻辑处理），无需强升版本；但 `recomputeAccounts` 行为变化建议用一个迁移标志位保护（一次性把现有 `balanceMinor` 视为期初余额 seed），防止老用户余额突变。

### 5.2 导入原子提交 + 回滚（ImportBatch）
- `ImportBatch`（落库于 `ImportBatchStore`，独立 key，**不进 Snapshot 备份**，与 pending 同理）：
```ts
interface ImportBatch {
  id: string; createdAt: number;
  source: ImportSource; fileName: string;
  txnIds: string[];            // 本批新增 Txn.id
  modifiedTxnIds: string[];    // 被本批补全/关联(退款/转账/跨币)的已有 Txn.id
  rollback: { txns: Txn[]; accounts: Account[] };  // 提交前全量快照
  status: 'committed' | 'reverted';
}
```
- 提交顺序（无事务型存储下的安全序列）：
  1. `createRollbackSnapshot()`：`store.getTxns()+getAccounts()` 拷入 `batch.rollback`，**先写** batch（status='committed' 但带 rollback）或单独 rollback key。
  2. `setTxns(merged)` → `setAccounts(recomputed)` → `setBatch(status='committed')`。
  3. 任一步 `setX` 失败 → 用 `rollback` 重 `setTxns/setAccounts` 恢复，**绝不半批**。
- 撤销 `revertBatch(id)`：
  - `setTxns(rollback.txns)` + `setAccounts(rollback.accounts)`（删新增、复原被改交易、复位 `linkedTxnId`）。
  - `recomputeFinance()` 重算全部。
  - `batch.status='reverted'`（保留记录供审计，不物理删）。
- 现有 `store.takeSnapshot/applySnapshot/backupForUndo` 保留给「恢复备份撤销」使用，与导入批撤销互不干扰。

### 5.3 安全与隐私（对应 §八）
- 所有文件**本地**解析；不上传原始流水；日志只记 `merchant`/金额 token，不记完整卡号/账号/原始描述（新增 `redactForLog` 工具，沿用 `notify/redact` 思路）。
- 加密 PDF 密码**仅内存**（模块变量/ref），进后台/解析完即清，不写 AsyncStorage/secure/log。

---

## 6. 测试用例（Node 纯模块，不依赖真机/APK）

沿用 `scripts/notify-test-runner.js` 的「转译 + Node 子进程」模式；涉及 `expo-file-system`/picker 处用内存桩。

### 6.1 通知（已有 163 断言，需补）
- 跨币「预测 vs 实际」：仅 RM100 通知 → `postingStatus='awaiting_posting'` 且 `settleAmountMinor` 不写（仅 `predictedSettleMinor` 且标约）；账单 ¥168 到达 → `reconcilePostingMatch` 补全、txn 仍 1 笔。
- `confirmForm` 账户建议：TNG→MYR ewallet/debit；支付宝→CNY；微信→CNY；ADB(com.android.shell)→空。

### 6.2 导入检测
1. TNG PDF → `source='TNG', confidence≥0.85` 自动选 `TngPdfAdapter`。
2. 支付宝 CSV(GB18030) → 识别编码 + 选 `AlipayCsvAdapter`。
3. 微信 XLSX → 选 `WechatXlsxAdapter`。
4. 未知 CSV → `GenericCsvAdapter`；未知 XLSX → `GenericXlsxAdapter`。
5. **错误扩展名**（`.txt` 实为 PDF / `.csv` 实为 XLSX）→ `FileTypeDetector` 用签名纠正。
6. **低置信度** → `UNKNOWN`+confidence<0.5，要求用户选，不自动解析。

### 6.3 匹配器（核心）
7. `DuplicateMatcher` P1（同单号→确定重复默认不导入）、P2（同账户日期金额商户→疑似）、P4（仅描述相似→不认定）。
8. `CrossCurrencyMatcher` 链接 MYR awaiting + CNY posted，提交后 **txn 仅 1 笔**、MYR 本地 +RM100、CNY 卡负债 +¥168、支出笔数 +1。
9. `RefundMatcher`：退款关联原支出、`countInStats` 冲减、无重复计。
10. `TransferMatcher`：A 支出↔B 收入合并为单 `transfer`、无双计。

### 6.4 适配器隔离 + 统一结构
11. 6 个适配器 `parse` 输出每条候选含 `ImportCandidate` 全部必填字段（统一结构）。
12. 平台适配器失败不兜底：`TngPdfAdapter` 收到支付宝 CSV → `validate` 失败、报错，绝不误解析。
13. 改 `AlipayCsvAdapter` 分类映射，断言 `TngPdfAdapter`/`WechatXlsxAdapter` 用例不受影响（无共享可变状态）。

### 6.5 汇率 / 重算
14. `Standardize`：文件提供 settle/历史汇率 → 用之；**不**用当前汇率覆盖历史；无结算额时仅算 `predicted`（标约），不写 `settleAmountMinor`。
15. `recomputeAccounts`：跨币交易 counted once；`awaiting_posting` **不**计入已确认卡负债；`predicted` 单独展示。

### 6.6 fixtures
`tng_sample.pdf`、`tng_encrypted.pdf`、`alipay_gb18030.csv`、`wechat_sample.xlsx`、`generic_sample.csv/.xlsx`、`lw_backup.json`、`misnamed.*`、`ambiguous.csv`、`cross_cc_cases.json`（一条 MYR 通知 + 一条 CNY 账单）。

---

## 7. 原设计稿 UNIFIED_IMPORTER_DESIGN.md 与你的新规则冲突 + 修订

> 下列 R1–R9 为必须修订项；修订后本文档取代原设计稿。

- **R1（结算币种）**：原稿 §5 `settleCurrency` 注「通常 'MYR'」。你的 §六.5/.6 要求「settlementCurrency 必须是实际入账账户币种，不能固定为 MYR；人民币信用卡应为 CNY」。→ **修订**：`settleCurrency = 账户币种`（从 `accountId` 派生），不再默认 MYR。
- **R2（汇率不可覆盖历史）**：原稿 §5/§7 `Standardize`「折算本币（MYR 为基准）」隐含用**当前** FX 改写。你的 §六.1/.2/.3/.7 要求优先文件真实原始/结算/历史汇率、**禁止用当前汇率覆盖历史**、当前汇率只用于预计显示且标「约」、只用于资产总览折算。→ **修订**：Standardize 仅当文件给出结算额/历史汇率时写 `settleAmountMinor/fxRate/fxSource`；否则留空，只算 `predictedSettleMinor`（展示用「约」），**绝不**写进历史事实。
- **R3（预测≠入账）**：当前 `recomputeAccounts` 把 `awaiting_posting` 的预测 settle 计入 `_bill`/`_unbilled`。你的 §五允许「先保存为待入账，不得捏造实际结算金额，可用当前汇率显示约」。→ **修订**：拆分「已入账 posted」与「预计 awaiting」；仅 posted 计入已确认负债/净资产；awaiting 仅展示 `predictedSettleMinor`（标约）。
- **R4（跨币写时机）**：`buildTxnFromPending` 在 posting 前就把 `settleAmountMinor` 按当前 FX 写出。→ **修订**：posting 前 settle 不写（或仅 `predicted`）；实际 settle/fxRate 仅在银行账单 posted 匹配后由 `CrossCurrencyMatcher` 补全（与通知链路 `reconcilePostingMatch` 一致）。
- **R5（共享匹配器）**：原稿 §10 仅「DuplicateMatcher 复用 fingerprint 思路」，未明确四匹配器跨通知/导入共享。你的 §七要求明确优先级且跨来源匹配。→ **修订**：`Duplicate/Transfer/Refund/CrossCurrency` 四匹配器定义在 `src/import/matchers/`，**同时**被 `confirm*.ts`（通知）与 `ImportService`（导入）消费；`notify/dedup.findPostingMatch` 改为委托 `CrossCurrencyMatcher`。
- **R6（去重规则细化）**：原稿只说「复用 fingerprint」。→ **修订**：按 §4.2 明确 P1/P2/P4 三档 + 仅同账户内匹配，避免误判。
- **R7（来源选择项）**：原稿 §2.3 低置信度弹「TNG/支付宝/微信/通用」。你的语境含银行 App。→ **修订**：选项扩为「TNG / 支付宝 / 微信支付 / 银行或通用账单」，且手动选择后仍强制 `validate` 门禁。
- **R8（期初余额）**：你的 §八末条「从期初余额和有效交易重新派生」。当前 `_bal` 初值 0。→ **修订（建议）**：`Account` 增 `openingBalanceMinor?`，`recomputeAccounts` seed `_bal += openingBalanceMinor ?? 0`；现有数据「0+全量交易」已正确，此字段为可选增强（建账即有余额场景）。
- **R9（隐私日志）**：原稿未强调导入日志脱敏。→ **修订**：新增 `redactForLog`，导入解析器不得把完整卡号/账号/原始描述写入日志（沿用 notify/redact）。

---

## 8. 实施顺序建议（供你确认后分阶段）

1. **模型与共享层**：`import/models.ts` + `matchers/*`（RN-free，先写测试）。
2. **Standardize / AutoCategorize / ImportReport**（纯函数 + 测试）。
3. **ImportService**（原子提交/回滚/撤销 + 内存 store 桩测试）。
4. **重构 notify 跨币**：`recomputeAccounts` 拆分 posted/awaiting；`findPostingMatch`→`CrossCurrencyMatcher`；通知 confirm 走共享匹配器。
5. **适配器 + parsers**（依赖 §9 技术选型：PDF/GB18030/JSON 校验）。
6. **UI**：ImportFlow/Preview/Report 三屏 + FinanceScreen 入口 + 导航。
7. **端到端测试 + 真机验收**（待你批准后）。

---

## 9. 仍需你拍板的技术选型（沿用原稿，阻断第 5 步）
1. **PDF 文本抽取**（TNG 多页/加密）：`pdfjs-dist`(legacy+polyfill) / 原生模块 / 复用 Web PWA？
2. **GB18030 解码**（支付宝 CSV）：小型映射表 / 原生 / 要求用户导出 UTF-8？
3. **XLSX 库**：`xlsx`(SheetJS)？
4. **JSON Schema 校验**：`zod` 还是手写校验 `Snapshot`？
5. **入口位置**：仅 FinanceScreen「导入流水」按钮，还是也放首页 FAB？
6. **加密 PDF 密码 UI**：`detection.encrypted` 时内联密码框（不进 secure store）——是否符合预期？
