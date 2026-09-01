# 统一交易导入器 — 设计稿

> 状态：**规则修订中（2026-08-28）**。第 11 节为最新权威规则（平台 / 币种 / 账户 / 去重 / 预算 / 匹配），取代前文任何「平台中立」的笼统表述。
> 实现现状：Phase 1–6 已完成适配器、去重/匹配/提交/撤销的代码骨架，但去重当前采用 `NO_DEDUP_SOURCES` 整源豁免（与第 11 节冲突，详见 `IMPORTER_RULES_CONFLICT_REPORT.md`）。**本次仅修订文档，未改代码、未生成 APK。**
> 目标：把 TNG / 支付宝 / 微信支付 / 通用 CSV / 通用 XLSX / 生活工作台 JSON 合并为用户只看到一个「导入流水」入口的统一导入器；内部保留独立适配器。

---

## 0. 与现有代码的对齐（grounding）

| 现有模块 | 设计中的角色 |
|---|---|
| `src/types.ts` → `Txn`（含 `origAmountMinor/origCurrency/settleAmountMinor/settleCurrency/fxRate/accountId/toAccountId/type/category/merchant/linkedTxnId` 等双币种字段） | `ImportCandidate` 标准化后**直接映射**为 `Txn`。适配器不需要发明新字段。 |
| `src/types.ts` → `Snapshot`（`schemaVersion / txns / accounts / fx / budgets …`） | 即「生活工作台 JSON」格式。`LifeWorkbenchJsonAdapter` 直接校验该结构。 |
| `src/store.ts` → `getTxns/setTxns`、`getAccounts/setAccounts`、`getFx/setFx` | 原子提交与回滚快照的数据来源（`ImportService` 在提交前 `getTxns()`+`getAccounts()` 做快照）。 |
| `src/calc.ts` → `recomputeAccounts(txns, accounts)` | 即「统一自动计算 / recomputeFinance」步骤。导入后调用它重算账户余额与信用卡负债。 |
| `src/notify/dedup.ts`（现有 `fingerprint`） | `DuplicateMatcher` 复用同款 fingerprint 思路，避免重复造轮子。 |
| `src/screens/FinanceScreen.tsx`（底部 Tab） | 「导入流水」入口加在此页；新增 `ImportFlowScreen / ImportPreviewScreen / ImportReportScreen` 通过现有导航挂载。 |
| `src/secure.ts`（`expo-secure-store`） | **注意**：加密 PDF 密码**故意不**走 secure store，只存内存（React ref / 模块级变量），详见 §6.10。 |

**RN 依赖现状（需要新增）**：当前 `package.json` 仅有 `expo-file-system` 与 `async-storage`，**没有** 文件选择器、PDF、XLSX、CSV、Schema 校验库。详见 §7 的依赖清单与 §9 的开放决策。

---

## 1. 统一导入器架构

分层原则：**编排层（UnifiedTransactionImporter / ImportService）不含任何平台规则**；所有平台差异封闭在各自适配器与 `parsers/` 工具内。

```
                 ┌─────────────────────────────────────────────┐
   用户/UI       │  FinanceScreen「导入流水」→ ImportFlowScreen  │
                 └─────────────────────────────────────────────┘
                                    │ 选择文件
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │            UnifiedTransactionImporter               │  ← 编排，无平台规则
        │  1) FileTypeDetector.detect(file)  → fileType       │
        │  2) SourceDetector.detect(file, fileType) → {source,│
        │       confidence, encrypted, reasons}               │
        │  3) ImporterRegistry.resolve(detection) → adapter   │
        │  4) adapter.parse(file, ctx) → ImportParseResult    │
        │  5) standardize(candidates)  → 标准化 ImportCandidate│
        │  6) autoCategorize(candidates) → 分类建议           │
        │  7) DuplicateMatcher / TransferMatcher /            │
        │       RefundMatcher / CrossCurrencyMatcher          │
        │  8) → ImportPreviewScreen（统一预览）               │
        │  9) 用户确认 → ImportService.commit(batch)          │
        │ 10) recomputeAccounts → ImportReportScreen          │
        │ 11) ImportBatch 落库（支持整批撤销）                │
        └───────────────────────────────────────────────────┘
                 │                    │                    │
        ┌────────▼───┐        ┌──────▼──────┐      ┌──────▼──────────┐
        │ Adapters   │        │  parsers/   │      │  ImportService   │
        │ (各平台独立)│        │ 通用解析工具│      │ 原子提交/撤销/报告│
        └────────────┘        └─────────────┘      └──────────────────┘
```

编排层只做：文件类型→来源→适配器 的**路由**与**流程串联**；它不解析字段、不解释「Reload/PayDirect/余额宝」等平台语义。这些都由各适配器在 `parse()` 内完成。

---

## 2. SourceDetector 规则

签名优先于扩展名。`SourceDetector.detect(file, fileType)` 读取文件头/样本行/表格表头，**不依赖扩展名**。

### 2.1 输出结构

```ts
export type ImportFileType = 'PDF' | 'CSV' | 'XLSX' | 'JSON';
export type ImportSource =
  | 'TNG' | 'ALIPAY' | 'WECHAT'
  | 'LIFE_WORKBENCH' | 'GENERIC' | 'UNKNOWN';

export interface DetectionResult {
  fileType: ImportFileType;
  source: ImportSource;
  confidence: number;                 // 0..1
  formatVersion?: string;             // 如 'TNG_WALLET_2024' / schemaVersion
  encrypted: boolean;                 // 仅 PDF 可能 true
  reasons: string[];                  // 命中哪些签名（用于 UI 展示 & 调试）
}
```

### 2.2 各来源签名（内容级，非扩展名）

| 来源 | 触发信号（满足即加权） |
|---|---|
| **TNG** | PDF；标题含 `TNG WALLET TRANSACTION HISTORY`；含表头 `Amount (RM)` 与 `Wallet Balance`；含 TNG 固定字段（如 `Reload`、`PayDirect`、`DuitNow`、`Cashback`）。 |
| **ALIPAY** | CSV；编码可能为 **GB18030**；含 `支付宝` 字样（导出说明/表头）；表头含 `交易时间`、`交易分类`、`交易对方`、`收/支`、`交易订单号`。 |
| **WECHAT** | XLSX；任一 sheet 标题含 `微信支付账单明细`；表头含 `交易时间`、`交易类型`、`交易对方`、`金额(元)`、`交易单号`。 |
| **LIFE_WORKBENCH** | JSON；顶层含 `schemaVersion`（数字）且含 `txns:[]` + `accounts:[]`（与现有 `Snapshot` 一致）；通过 JSON Schema 校验。 |
| **GENERIC** | CSV/XLSX 但无上述平台签名；或表头为通用列（日期/金额/描述/收支）。 |

### 2.3 置信度阈值与兜底

- `confidence >= 0.85` → 自动选择适配器。
- `0.5 <= confidence < 0.85` → 仍自动选择，但 UI 在预览页顶部标「来源识别：X（中等置信度）」，并保留「来源识别错误」手动修正入口。
- `confidence < 0.5` 或 `source === 'UNKNOWN'` → **不自动解析**，显示：

  ```
  无法确定账单来源，请选择：
  TNG / 支付宝 / 微信支付 / 通用账单
  ```

  用户选择后**仍必须执行对应适配器的 `validate()`**；校验不过则报错，绝不强行按不匹配文件解析（满足「平台适配器失败后不会自动尝试不安全的错误解析」）。

---

## 3. Adapter 接口

```ts
export interface ImportFile {
  uri: string;            // expo-document-picker 返回的本地 uri
  name: string;
  size: number;
  mimeType?: string;
  // 已读取的字节/文本（由编排层按 fileType 预读，避免适配器各自读盘）
  buffer?: Uint8Array;
  text?: string;          // CSV/JSON 解码后的文本（编码已归一）
}

export interface DetectionContext {
  fileType: ImportFileType;
  // 供适配器使用的轻量工具：编码探测、签名匹配等（见 parsers/）
}

export interface ParseContext {
  detection: DetectionResult;
  fxRate: number;                     // 当前 cnyPerMyr，用于双币种标准化
  defaultAccountIdMYR: string;
  defaultAccountIdCNY: string;
  pdfPassword?: string;               // 仅加密 PDF 时由内存传入，绝不落盘
}

export interface TransactionImportAdapter {
  id: string;                          // 'tng-pdf' | 'alipay-csv' | ...
  source: ImportSource;
  supportedFileTypes: ImportFileType[];

  detect(file: ImportFile, ctx: DetectionContext): Promise<DetectionResult>;
  parse(file: ImportFile, ctx: ParseContext): Promise<ImportParseResult>;
  validate(candidate: ImportCandidate): ValidationResult;
}
```

**适配器职责（只能做）**
- 识别自己的格式；解析自己的字段；解释平台特有交易类型（Reload/Payment/PayDirect/余额宝/转账/退款…）；输出统一 `ImportCandidate`；返回 warnings 与 confidence。

**适配器禁止（不能做）**
- 直接写 `Txn` 正式账本；修改账户余额；更新预算/信用卡负债；绕过用户预览；自己实现另一套统计逻辑。

---

## 4. ImporterRegistry 实现方式

```ts
class ImporterRegistry {
  private byId = new Map<string, TransactionImportAdapter>();
  private bySource = new Map<ImportSource, TransactionImportAdapter>();

  register(a: TransactionImportAdapter) { this.byId.set(a.id, a); this.bySource.set(a.source, a); }

  // 高/中置信度自动路由
  resolve(detection: DetectionResult): TransactionImportAdapter | null {
    if (detection.source === 'GENERIC') {
      // 通用按文件类型二选一
      return detection.fileType === 'CSV' ? this.byId.get('generic-csv')!
           : detection.fileType === 'XLSX' ? this.byId.get('generic-xlsx')!
           : null;
    }
    return this.bySource.get(detection.source) ?? null;
  }

  // 低置信度时用户手动选择后调用；仍强制 validate
  async runManual(adapterId: string, file: ImportFile, ctx: ParseContext): Promise<ImportParseResult> {
    const a = this.byId.get(adapterId);
    const res = await a!.parse(file, ctx);
    // 即便用户指定，也要对结果做适配器的 validate 门禁
    const bad = res.candidates.filter(c => a!.validate(c).ok === false);
    if (bad.length) res.errors.push({ code: 'VALIDATION_FAILED', message: '文件与所选来源不匹配' });
    return res;
  }
}
```

注册在模块加载时一次性完成（`registry.register(new TngPdfAdapter()); …`）。编排层只持有 `registry`，不直接 `new` 任何适配器。

---

## 5. 统一 ImportCandidate 模型

所有适配器输出**同一结构**，统一进入标准化/分类/去重/匹配/预览/提交。

> ⚠️ 平台/币种/账户/去重/预算/匹配的**强制规则**见第 11 节（权威规则）。本节的 `ImportCandidate` 字段需按 §11.10 扩充（`budgetCurrency` / `affectsBudget` / `affectsIncomeExpense` / `transactionNature` / `platformRef` / `currencyInferred` / `currencyConflict`），并删除整源豁免式的 `NO_DEDUP_SOURCES`。

```ts
export interface ImportCandidate {
  // —— 标准化后直接映射 Txn 的字段 ——
  type: TxnType;                       // 'income'|'expense'|'transfer'|'repayment'|'refund'
  currency: Currency;                  // 原始币种
  origAmountMinor: number;             // 原始金额（分）
  origCurrency: Currency;
  settleAmountMinor?: number;          // 折算本币（MYR 为基准）
  settleCurrency?: Currency;            // 通常 'MYR'
  fxRate?: number;
  accountId?: string;                  // 建议账户（可用户在预览页改）
  toAccountId?: string;                // 转账目标
  category: string;                    // 已给建议值，可改
  merchant?: string;
  note: string;
  date: string;                        // YYYY-MM-DD
  time?: string;

  // —— 导入元数据（不写进最终 Txn，或仅映射到 Txn 已有字段）——
  source: ImportSource;
  sourceRef: string;                   // 平台原单号 / 行号，用于去重与溯源
  rawRowIndex?: number;
  rawSummary?: string;                 // 原始行文本（调试/审计）
  confidence: number;
  fingerprint: string;                 // 去重键（复用 notify/dedup 思路）
  flags: {
    duplicate?: boolean;               // 与已有 Txn 命中
    suspectedDuplicate?: boolean;      // 疑似（需用户确认）
    refund?: boolean;                  // 建议退款匹配
    transfer?: boolean;                // 建议合并转账
    crossCurrencyCard?: boolean;       // 跨币信用卡待posted
    ignored?: boolean;                 // 用户标记忽略
  };
  warnings: ImportWarning[];
}

export interface ImportParseResult {
  detection: DetectionResult;
  sourceSummary?: { fileRangeFrom?: string; fileRangeTo?: string; rowCount: number };
  candidates: ImportCandidate[];
  ignoredRows: { rowIndex: number; reason: string }[];
  warnings: ImportWarning[];
  errors: ImportError[];
}
```

**标准化（standardize）**：统一币种为 `origCurrency+settleCurrency` 双字段；`date` 归一为 `YYYY-MM-DD`（`DateParser` 处理微信 UTC+08:00、TNG 多格式）；金额统一为 minor 整数（`MoneyParser`）。

**自动分类建议（autoCategorize）**：基于 merchant/平台类型/关键词映射到既有 `category` 枚举；建议值可覆盖。

### 5.1 ImportBatch（撤销用）

```ts
export interface ImportBatch {
  id: string;
  createdAt: number;
  source: ImportSource;
  fileName: string;
  txnIds: string[];                    // 本批新增的 Txn.id
  modifiedTxnIds: string[];            // 被本批修改/关联（退款/转账合并）的已有 Txn.id
  rollback: {
    txns: Txn[];                       // 提交前全量快照
    accounts: Account[];               // 提交前账户快照
  };
  status: 'committed' | 'reverted';
}
```

---

## 6. 统一预览与提交流程

### 6.1 统一预览（单一组件）

`ImportPreviewScreen` 接收 `ImportParseResult` + 标准化后的 `ImportCandidate[]`，**无论来源都渲染同一组件**：

- 顶部：识别来源 + 文件时间范围 + 总记录数。
- 汇总卡：可导入 / 需要确认 / 确定重复 / 疑似重复 / 建议转账合并 / 建议退款匹配 / 无效或关闭记录；MYR 收/支、CNY 收/支；预计账户变化；预计信用卡负债变化；与来源文件汇总的差异。
- 每条可操作：编辑 / 忽略 / 改账户 / 改分类 / 改类型 / 改币种 / 确认退款 / 合并转账 / 处理重复。
- 「来源识别错误」按钮 → 重新走 §2.3 的手动选择（仍走 `validate` 门禁）。
- 加密 PDF 密码输入框仅在 `detection.encrypted` 时出现。

### 6.2 统一提交（ImportService）

```
validateBatch(candidates)
  → 任一严重错误：整批不提交、不改余额/预算/负债，返回错误
createRollbackSnapshot()   // store.getTxns()+getAccounts() 全量拷贝到内存
commitBatchAtomically(batch) // 合并进现有 txns（新增 + 修改关联），store.setTxns / setAccounts
recomputeFinance()         // calc.recomputeAccounts(txns, accounts) → setAccounts
generateReport()           // 汇总导入报告
persistImportBatch(batch)  // 写入 ImportBatch（status='committed'），供撤销
```

**原子性保证**：先快照后提交；`commitBatchAtomically` 内若任一写失败，回滚到 `rollback` 快照（重新 `setTxns/setAccounts`），绝不产生半批数据。

### 6.3 统一撤销

`revertBatch(batchId)`：
- 从 `ImportBatch.rollback.txns/accounts` 恢复 `store.setTxns/setAccounts`；
- 删除本批 `txnIds` 新增交易、恢复 `modifiedTxnIds` 被改的原有交易；
- 撤销转账合并 / 退款关联（`linkedTxnId` 复位）；
- `recomputeFinance()` 重算；
- `ImportBatch.status = 'reverted'`（保留记录，不物理删除，便于审计）。

### 6.4 加密 PDF 密码生命周期（§十要求）

- 用户输入的密码**只存内存**：放在 `UnifiedTransactionImporter` 的模块级变量 / React ref，`ParseContext.pdfPassword` 临时传入。
- **不**写入 `AsyncStorage`、配置、`secure.ts`、日志、模板。
- `AppState` 进入后台（`background`）→ 立即清空内存密码。
- `parse()` 完成后 → 清空。
- 密码错误 → 允许重新输入，不尝试破解/绕过。
- 解析器若需密码解 PDF，由 `PdfTableParser` 在内存中使用，绝不缓存。

---

## 7. 目录与文件清单

```
src/import/
  models.ts                      // ImportFileType/ImportSource/DetectionResult/
                                //   ImportCandidate/ImportParseResult/ImportBatch/…
  UnifiedTransactionImporter.ts  // 编排：检测→路由→标准化→匹配→预览数据装配
  FileTypeDetector.ts            // 扩展名 + 内容签名（%PDF-/PK\x03\x04/JSON/CSV heuristic）
  SourceDetector.ts              // §2 签名规则 + 置信度阈值
  ImporterRegistry.ts            // §4 注册表与路由
  ImportService.ts               // validateBatch/commit/rollback/revert/report
  DuplicateMatcher.ts            // 复用 notify/dedup 的 fingerprint
  TransferMatcher.ts             // 跨来源转账配对
  RefundMatcher.ts               // 退款匹配（原支出 ↔ refund）
  CrossCurrencyMatcher.ts        // 跨币信用卡 posted 匹配
  AutoCategorize.ts              // 分类建议（商户/关键词→category）
  Standardize.ts                 // 币种/金额/日期归一
  ImportReport.ts                // 报告生成
  adapters/
    TngPdfAdapter.ts
    AlipayCsvAdapter.ts
    WechatXlsxAdapter.ts
    GenericCsvAdapter.ts
    GenericXlsxAdapter.ts
    LifeWorkbenchJsonAdapter.ts
  parsers/
    MoneyParser.ts               // "RM 12.50" / "¥12.50" / "12.50" → minor
    DateParser.ts                // 多格式 + UTC+08:00 处理
    EncodingDetector.ts          // BOM/GB18030/UTF-8 探测（见 §9 决策）
    PdfTableParser.ts            // PDF 文本/表格抽取 + 密码解（见 §9 决策）
    SpreadsheetParser.ts         // XLSX/CSV → 行对象（基于 xlsx / 自研 CSV）
  storage/
    ImportBatchStore.ts          // ImportBatch 的读写（AsyncStorage）
  tests/
    fixtures/                    // 各来源样本（含错误扩展名、低置信度样本）
    run-importer-tests.js        // Node 测试运行器（仿 scripts/notify-test-runner.js）
```

### 需新增依赖（建议）

| 包 | 用途 | 备注 |
|---|---|---|
| `expo-document-picker` | 文件选择 | 必需 |
| `xlsx` (SheetJS) | 微信/通用 XLSX 解析 | 必需 |
| 自研轻量 CSV 解析 | 支付宝/通用 CSV | 避免重依赖；或改用 `papaparse` |
| PDF 文本抽取 | TNG 加密/多页 PDF | **见 §9 开放决策**（RN 上最棘手） |
| GB18030 解码 | 支付宝 CSV | **见 §9 开放决策** |
| `zod`（可选） | 生活工作台 JSON Schema 校验 | 也可手写校验，避免加依赖 |

---

## 8. 自动测试计划

沿用现有 `scripts/notify-test-runner.js` 的「纯模块转译 + Node 子进程」模式（`src/import` 内 RN-free 模块可直接在 Node 跑；涉及 `expo-file-system` 的部分用内存桩替换）。**不依赖真机/APK**。

### 8.1 必须覆盖的用例（对应你的 11 条）

1. TNG PDF → 自动选 `TngPdfAdapter`（`detect` 返回 source='TNG', confidence≥0.85）。
2. 支付宝 CSV（GB18030）→ 自动识别编码并选 `AlipayCsvAdapter`。
3. 微信 XLSX → 自动选 `WechatXlsxAdapter`。
4. 未知 CSV → 落 `GenericCsvAdapter`。
5. 未知 XLSX → 落 `GenericXlsxAdapter`。
6. **错误扩展名**（如 `.txt` 实为 PDF / `.csv` 实为 XLSX）→ `FileTypeDetector` 用签名纠正。
7. **低置信度**（如通用表格但字段模糊）→ 返回 `UNKNOWN`/confidence<0.5，要求用户选择，不自动解析。
8. **平台适配器失败不会不安全兜底**：给 `TngPdfAdapter` 传支付宝 CSV → `validate` 失败、报错，绝不回退误解析。
9. **所有来源输出同一 `ImportCandidate` 结构**：断言 6 个适配器 `parse` 结果中每条 candidate 含 §5 全部必填字段。
10. **统一预览/提交/撤销流程**：用内存版 `store` 桩跑 `ImportService.commit` → 断言 `recomputeAccounts` 后余额正确；`revertBatch` → 余额与 txns 恢复到快照。
11. **适配器规则隔离**：改 `AlipayCsvAdapter` 的分类映射后，断言 `TngPdfAdapter`/`WechatXlsxAdapter` 的测试不受影响（独立用例，无共享可变状态）。

### 8.2 fixtures 清单

`tests/fixtures/` 下准备：
- `tng_sample.pdf`（含 `TNG WALLET TRANSACTION HISTORY` + `Amount (RM)`）
- `tng_encrypted.pdf`（用于密码生命周期测试）
- `alipay_gb18030.csv`（GB18030 编码样本）
- `wechat_sample.xlsx`（含 `微信支付账单明细`）
- `generic_sample.csv` / `generic_sample.xlsx`
- `lw_backup.json`（与 `Snapshot` 一致的备份）
- `misnamed.pdf-as-txt`、`misnamed.xlsx-as-csv`（错误扩展名）
- `ambiguous.csv`（低置信度）

### 8.3 运行方式

```
npm run test:import   # → node src/import/tests/run-importer-tests.js
```
目标：全部用例绿、TypeScript `tsc --noEmit` 0 错误。

---

## 9. 待你确认的开放决策（重要）

1. **PDF 文本抽取（RN 上最棘手）**：`pdfjs-dist`（legacy 构建 + RN polyfill）、原生模块、或复用 Web PWA 已有逻辑？TNG 是多页文字 PDF，需要稳定的文本/表格抽取。请定方案。
2. **GB18030 解码**：RN 的 `TextDecoder` 仅 UTF-8。支付宝 CSV 常是 GB18030。需要引入解码方案（小型 GB18030 映射表 / 原生 / 要求用户导出 UTF-8）。请定方案。
3. **XLSX 库**：用 `xlsx`(SheetJS) 还是其它？SheetJS 体积较大但是最稳。
4. **JSON Schema 校验**：用 `zod` 还是手写校验 `Snapshot` 结构？
5. **入口位置**：确认「导入流水」放在 `FinanceScreen` 顶部按钮 + 底部 Tab 不变；还是也暴露到首页 FAB？
6. **加密 PDF 密码 UI**：当 `detection.encrypted` 时，在 `ImportFlowScreen` 内联密码输入框（不进 secure store）——确认这个 UX 符合预期。

---

## 10. 与既有「通知→待确认」的关系（澄清）

通知链路（`notify/`）产出 `PendingRecord`（待确认），与本次导入器**解耦但可复用**：
- `DuplicateMatcher` 复用 `notify/dedup.ts` 的 fingerprint 思路。
- 导入器产出的是 `ImportCandidate` → 经预览确认 → 直接 `Txn`，**不经过 PendingRecord**（导入是显式批量操作，不需要二次「通知待确认」）。
- 两者最终都汇入同一 `Txn` 账本与 `recomputeAccounts`。

---

## 11. 平台 / 币种 / 账户 / 去重 / 预算 / 匹配 — 权威规则（2026-08-28 修订）

> 本节为**强制约束**，取代前文任何「平台中立」的笼统表述。实现前必须先满足 §11.11 的 10 条测试。
> 与当前代码的逐条冲突见 `IMPORTER_RULES_CONFLICT_REPORT.md`（关键：当前用 `NO_DEDUP_SOURCES` 整源豁免去重，与本节 §11.2/§11.3/§11.4 直接冲突）。

### 11.0 核心结论（摘要）

- 支付宝与 TNG 是**两个独立平台账户体系**：`source` 不同、默认账户类型虽同为 `ewallet` 但**币种不同（CNY vs MYR）**、默认币种不同、默认预算币种不同。绝不能因为「都是电子钱包」就混用、混算或绑定到同一账户。
- 去重 / 匹配核心键 = `source + accountId + currency + platformRef(平台单号) + date + amountMinor + merchantNorm`。由于 Alipay 与 TNG 的 `source/currency/account` 必然不同，两者**天然不会互判重复**——因此**取消 `NO_DEDUP_SOURCES` 这种「整源一刀切免去重」的做法**（见 §11.9 与冲突报告）。
- **「重复（去重）」与「结算关联」是两种不同操作**：
  - 去重：同一笔交易被重复记录 → 丢弃其一（只保留一条主交易）。
  - 结算关联：两条不同来源的记录指向同一笔真实消费（如支付宝消费 ↔ 信用卡账单）→ **两条都保留**，并关联到同一主交易（消费事实 + 结算来源）。此操作不做跨平台（支付宝↔TNG 永不关联）。

### 11.1 平台默认属性（强制）

| 维度 | 支付宝 `ALIPAY` | TNG eWallet `TNG` |
|---|---|---|
| `source` | `ALIPAY` | `TNG` |
| 默认账户类型 | `ewallet` | `ewallet` |
| 默认账户币种 | `CNY` | `MYR` |
| 原始交易默认币种 | `CNY` | `MYR` |
| 计入 | CNY 收入 / 支出 + CNY 预算 | MYR 收入 / 支出 + MYR 预算 |
| 禁止计入 | **MYR 预算** | **CNY 预算** |

- 若文件**明确提供**其它币种（如支付宝出现外币消费、TNG 出现非 MYR），**保留文件真实币种**，标记为「跨币交易」，**不得**用平台默认币种静默覆盖（走 §11.9 异常流程）。

### 11.2 两平台不能互相去重

- 即使日期 / 金额数字 / 商户相似，支付宝 ¥100 与 TNG RM100 也**不得**判重——原因：来源不同、账户不同、币种不同、实际价值不同。
- 去重键**必须至少含**：`source`、`accountId`、`currency`、`platformRef`/`sourceRef`(平台交易编号)、`date`、`amountMinor`、`merchant`。
- 支付宝 ↔ TNG 之间**默认禁止**任何自动去重或自动合并。

### 11.3 支付宝匹配范围

仅可与以下记录尝试匹配 / 关联：

- 同一支付宝文件中的**重复记录**（同交易号）→ 去重
- 另一份支付宝导出文件 → 去重
- 支付宝支付通知 → 关联
- 为支付宝提供资金的 **CNY 银行卡流水**（充值来源）→ 结算关联
- 支付宝绑定的**人民币信用卡账单** → 结算关联

示例：支付宝向商户支付 ¥100，人民币信用卡账单也显示「支付宝 ¥100」。确认属于同一消费后：

- 只计算**一笔 CNY 支出**；
- 只扣**一次 CNY 预算**；
- 信用卡负债 **+¥100**；
- 支付宝记录 = **消费事实**，信用卡记录 = **结算来源**；
- 两条来源**关联到同一主交易**（不丢弃任一条）。

**支付宝不能与 TNG 账单匹配。**

### 11.4 TNG 匹配范围

仅可与以下记录尝试匹配 / 关联：

- 同一 TNG 文件中的**重复记录**（同 TNG ref）→ 去重
- 另一份 TNG 导出文件 → 去重
- TNG 支付通知 → 关联
- 为 TNG 充值的 **MYR 银行卡流水**（Reload 来源）→ 结算关联
- TNG **PayDirect** 绑定的银行卡 / 信用卡流水 → 结算关联

示例：TNG 显示商户消费 RM12.50，Maybank 账单也显示 TNG / PayDirect 扣款 RM12.50。确认属于同一消费后：

- 只计算**一笔 MYR 支出**；
- 只扣**一次 MYR 预算**；
- 对应银行账户 **−RM12.50**；
- 两条来源**关联到同一主交易**。

**TNG 不能与支付宝账单匹配。**

### 11.5 充值与实际消费必须分开（防重复核心）

- **支付宝**：
  - CNY 银行卡充值支付宝 = **账户转账（transfer）**，不算收入或支出；
  - 支付宝余额真实消费 = **CNY 支出**；
  - 提现到银行卡 = **账户转账**，不算收入或支出。
- **TNG**：
  - MYR 银行卡 Reload 到 TNG = **账户转账（transfer）**，不算收入或支出；
  - TNG 余额真实消费 = **MYR 支出**；
  - 提现 / 转回银行 = **账户转账**，不算收入或支出。
- 若同一笔银行卡扣款是「充值」，**[不得]** 把它识别成商户消费——避免收入/支出被重复计算。即：支付宝充值与对应银行扣款应作为一对 `transfer` 关联；TNG Reload 与对应银行扣款应作为一对 `transfer` 关联。

### 11.6 支付宝理财规则

以下支付宝相关流水**不计入日常 CNY 收支与预算**：

- 转入余额宝 / 余额宝转出
- 蚂蚁财富申购 / 蚂蚁财富赎回
- 基金买入 / 卖出
- 理财账户内部调仓
- 资产冻结 / 解冻

设置：`transactionNature = investment | transfer`；`affectsIncomeExpense = false`；`affectsBudget = false`；`currency = CNY`。

这些记录**可以影响**支付宝余额、银行卡、余额宝、蚂蚁财富等资产账户的余额，但**不能变成**普通收入或支出。

> 余额宝收益 / 基金收益 / 分红 / 蚂蚁财富收益也**暂不进入日常收入统计**，保留为 `transactionNature = investmentIncome`，供未来投资报表使用。

### 11.7 预算计算

- 支付宝普通消费：`budgetCurrency = CNY`，**只扣 CNY 预算**。
- TNG 普通消费：`budgetCurrency = MYR`，**只扣 MYR 预算**。
- 支付宝理财：**不扣 CNY 预算、不扣 MYR 预算**。
- TNG Reload：**不扣 MYR 预算、不扣 CNY 预算**。
- **不同币种预算绝不可通过当前汇率混合计算。**

### 11.8 账户绑定要求

首次导入需分别绑定：

- 支付宝流水 → 一个 **CNY 支付宝账户**（ewallet / CNY）
- TNG 流水 → 一个 **MYR TNG eWallet 账户**（ewallet / MYR）

绑定关系保存在 `ImportTemplate.boundAccountId`（按 `source` 区分），下次自动建议；导入预览**仍需显示账户与币种**。

**不能因为两者都是电子钱包，就把支付宝与 TNG 绑定到同一个账户。**

### 11.9 异常情况（币种）

- 支付宝文件**无币种列**：默认建议 CNY，预览显示「根据支付宝来源推断为 CNY」。
- TNG 文件**无币种列**：默认建议 MYR，预览显示「根据 TNG 来源推断为 MYR」。
- 文件内容与默认币种**冲突**（如支付宝文件出现 MYR 列、TNG 文件出现 CNY 列）：标记「币种与平台默认值不一致」，**必须让用户确认**，**不得静默转换**；保留文件真实币种并标记为跨币交易。

### 11.10 数据模型变更（实现前必须落地）

**`ImportCandidate` 增加 / 明确字段：**

- `budgetCurrency?: Currency` —— 该笔应扣的预算币种（支付宝=CNY，TNG=MYR，理财/Renew=undefined 即不扣）。
- `affectsBudget?: boolean` —— 默认 `true`；理财 / Renew = `false`。
- `affectsIncomeExpense?: boolean` —— 默认 `true`；理财 / Renew = `false`。
- `transactionNature?: 'normal' | 'investment' | 'transfer' | 'settlement' | 'investmentIncome'` —— 理财=`investment|transfer`；收益=`investmentIncome`（保留，不进日常收入）。
- `platformRef?: string` —— 平台交易编号（支付宝 交易号 / TNG ref），去重 P1 主键。
- `currencyInferred?: boolean` —— 币种是平台推断（无币种列）还是文件明示。
- `currencyConflict?: boolean` —— 文件币种与平台默认冲突，待用户确认。

**`Txn` 增加对应字段**（`budgetCurrency` / `affectsBudget` / `affectsIncomeExpense` / `transactionNature`），`recomputeAccounts` 与预算扣减须消费这些字段（理财 / Renew 不进收支与预算）。

**`ImportTemplate` 增加** `boundAccountId?: string`（按 `source` 绑定，首次导入建立）。

**去重键改为** `(source, accountId, currency, platformRef, date, amountMinor, merchantNorm)`；**删除 `NO_DEDUP_SOURCES` 整源豁免**（跨平台不互判由键天然保证）。

**新增结算关联匹配器** `SettlementLinkMatcher`：同币种内，支付宝消费 ↔ CNY 银行卡 / 信用卡结算记录（按 merchant + amount + date 相近），TNG 消费 ↔ MYR 银行卡 / PayDirect 结算记录，关联到同一主交易（保留两条、不丢弃）。

### 11.11 测试要求（验收底线，10 条）

1. 支付宝 ¥100 只进入 CNY 支出与 CNY 预算。
2. TNG RM100 只进入 MYR 支出与 MYR 预算。
3. 支付宝 ¥100 与 TNG RM100 **不能**被判定为重复。
4. 支付宝记录**只能**匹配 CNY 资金来源 / 结算记录。
5. TNG 记录**只能**匹配 MYR 资金来源 / 结算记录。
6. 支付宝充值**不算**收入。
7. TNG Reload **不算**收入。
8. 支付宝理财**不计入**日常收支与预算。
9. 两个平台**分别绑定独立账户**。
10. 二次导入各自相同文件，能够在**同一平台 + 账户**范围内正确去重。
