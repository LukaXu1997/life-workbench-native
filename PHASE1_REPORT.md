# 统一交易导入器 — 阶段一报告（基础模型 / Schema / 文件类型与来源检测）

> 实施顺序已确认。本阶段只做代码、自动测试与说明；**未生成/签名/安装 APK，未改动任何无关 UI**。
> 等待你确认后，再进入阶段二（支付宝 CSV + GB18030 解码）。

## 一、新增依赖及选择原因

| 依赖 | 版本 | 许可证 | 选择原因 |
|------|------|--------|----------|
| `zod` | 3.25.76 | MIT | 用户已确认用 zod 做结构校验。选 **v3 而非 v4**：v4 改动了内部细节，在 React Native / Hermes 上的稳定性成熟度不如 v3；v3.25.x 是 v3 末代，bug 最少。已安装到项目 `node_modules`，Node 测试可直接 `require`。

> 本阶段仅引入 zod。iconv-lite（GB18030）、SheetJS `xlsx`（XLSX）、以及文件选择器 `expo-document-picker` 均按既定方案留在对应阶段引入，避免提前拉入无关原生/重依赖。

## 二、新增 / 修改的文件

| 文件 | 作用 |
|------|------|
| `src/import/models.ts` | 核心类型：`ImportSource`、`ImportFileKind`、`ImportCandidate`、`ImportTemplate`、`ImportBatch`、`ImportColumnMapping`、`BatchCounters`；及 PII 安全的 `buildImportBatch()` 工厂（只拷贝 id/汇总，绝不接触描述）。 |
| `src/import/limits.ts` | 统一安全上限（文件大小 20MB、Sheet≤32、单 Sheet 行≤5万、列≤256、密码尝试≤5 次等）。 |
| `src/import/fileDetect.ts` | **纯函数**文件类型检测：magic bytes（%PDF、PK zip、gzip）+ 扩展名 + UTF-8 文本嗅探 → `pdf/csv/xlsx/json/unknown`。 |
| `src/import/sourceDetect.ts` | **纯函数**来源检测注册表：支付宝 CSV 签名、生活工作台 JSON（经 schema 校验）、xlsx→genericXlsx、pdf→tng；对二进制容器返回「类型推断默认来源 + 低置信度」，待适配器在阶段三/四解析后确认。 |
| `src/import/schemas.ts` | zod schemas + 校验函数：币种/交易类型/账户类型枚举、账户、Txn、Snapshot、`ImportCandidate/Template/Batch`。`validateLifeWorkbenchSnapshot()` **先校验 schemaVersion**：未来版本直接拒绝并给出可读错误；v1 必须走显式 `migrateSnapshotV1ToV2` 才能按 v2 读取。**错误文案剥离 received 值**，杜绝把描述/卡号/账号写进日志。 |
| `src/import/migration.ts` | `migrateSnapshotV1ToV2()`，复用 `src/migration.ts` 的 `migrateTxns`，保证与 App 内迁移 1:1。 |
| `src/import/__phase1_tests.ts` | 阶段一测试套件（**50 条断言**，全为脱敏样本）。 |
| `scripts/import-test-runner.js` | 与 `notify-test-runner.js` 同构的纯 Node 测试运行器（transpile → 隔离子进程）。 |
| `src/types.ts` | `Account` 新增可选 `openingBalanceMinor?`（阶段五/六 `recomputeAccounts` 拆分已记账/待入账余额所需，向后兼容，不影响既有逻辑）。 |

## 三、测试结果

- **阶段一单测：50 passed, 0 failed**（`node scripts/import-test-runner.js`）。
- **既有 notify 单测：163 passed, 0 failed**（确认 `types.ts` 改动无回归）。
- **`tsc --noEmit`：0 错误**（整个工程类型检查通过）。

测试覆盖要点：
1. 文件类型：PDF / XLSX(zip) / 扩展名 / 文本 `{` → json / 随机二进制 → unknown / 超大文件被拒。
2. 来源检测：支付宝 CSV 签名命中、通用 CSV、生活工作台 JSON 校验通过、xlsx/pdf 返回低置信默认来源、加密 PDF 透传 `encrypted` 标志。
3. Schema 严格性：`currency` 非法被拒且错误**不含 received 回声**；`amountMinor` 非整数被拒；`date` 格式错误被拒；**PII 安全**：描述/备注含机密占位串时，错误消息既不回显 merchant 也不回显 note。
4. `ImportBatch` 采用 `.strict()`：任何意外携带 `merchant/note` 的批次**直接校验失败**，从 schema 层守住「批次不存描述」的契约。
5. Snapshot 版本路由：v2 通过；畸形 JSON 拒绝（kind=json_parse）；**未来版本 v99 拒绝**（kind=unsupported_version，消息含 v99）；**v1 自动迁移为 v2 并通过**（`origAmountMinor` 正确为 1250）；v0 拒绝。

## 四、已落实的隐私 / 安全约束

- `ImportBatch` 仅存 `txnIds` + 数值汇总（行数、整数总额、日期范围），**不含任何交易描述、卡号、账号、密码或密码摘要**。
- `ImportCandidate` 允许在内存中携带 `merchant/note` 用于分类建议，但**永不被写入日志 / AsyncStorage / Batch**；并带 `rawRef` 不透明引用令牌以便溯源而不留存原文。
- 校验错误文案经 `describeIssues()` 清洗，移除 zod 可能附加的 `received '...'` 值。
- 文件大小 / 行 / 列 / Sheet 上限集中在 `limits.ts`，异常文件不会撑爆内存。

## 五、已知限制（按计划留给后续阶段）

1. **XLSX / PDF 尚未真正解析**：阶段一对 xlsx/pdf 只做到「类型识别 + 来源默认推断（低置信度）」，真正的单元格/文本抽取在阶段三（微信 XLSX）、阶段四（TNG PDF + 加密密码流程）实现。
2. **GB18030 解码未做**：阶段一 sourceDetect 接收「已解码文本」作为输入；真实乱码回退解码在阶段二（支付宝 CSV）落地。
3. **系统文件选择器（OS picker）未接入**：阶段一的「文件选择」指**选择/分类的核心逻辑**（`probeFile` + `detectFileKind` + `detectSource`），不依赖 RN。真正的 `expo-document-picker` 包装 + 入口（财务页 → 流水页 → 右上角「导入流水」）在阶段五/六 UI 阶段接入，届时再引入该依赖并验证兼容性。
4. **ImportBatch 持久化（撤销）未实现**：本阶段只定义模型 + 严格 schema + 工厂；落库与整批撤销在阶段六。
5. **跨币匹配 / 去重指纹未做**：`ImportCandidate.fingerprint` 与跨币种合并逻辑在阶段五。

## 六、下一步

请确认阶段一结果。确认后我进入**阶段二：支付宝 CSV 解析 + GB18030 解码**（按既定方案引入 `iconv-lite`，先 BOM → 严格 UTF-8 → GB18030 回退，并用支付宝固定表头/`支付宝` 签名校验解码结果，失败不静默导入乱码）。
