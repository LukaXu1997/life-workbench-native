# 集成阶段完成报告 — ①AsyncStorage 适配器 ②导入入口 UI ③跨来源关联补全 ④真机验证

> 日期：2026-08-28 20:0x ｜ 项目：`life-workbench-native`（Expo 52 / RN 0.76.9，bare workflow）
> 设备：`46201FDAP007FD`（已授权，release APK 已安装并验证）
> 用户选型：**expo-document-picker** + **Modal 浮层**（不加 stack navigator）+ **Release APK 装机**。

## 一、测试结果与构建（全绿）

| 项 | 结果 |
|---|---|
| 导入单测 | **329 断言全绿**（一 50 / 二 55 / 三 39 / 四 46 / 五 47 / 六 92） |
| notify 基线 | 全绿（37 + 37 + 28 + 27） |
| `tsc --noEmit` | **0 错误** |
| `./gradlew assembleRelease` | **BUILD SUCCESSFUL**（1m 8s，37.4 MB） |
| `adb install` | **Success** |
| 真机启动 | 无 FATAL、Hermes 加载、`ReactNativeJS: Running "main"`，**无 JS 错误** |
| UI 驱动验证 | 财务 → 流水 → 右上角「导入流水」+ ⋯ 菜单 → Modal 正常渲染 |

---

## ① RN `PersistenceBackend` 适配器（AsyncStorage）

- **`PersistenceBackend` 改为异步**（`load/save` 返回 Promise）——真实 AsyncStorage 是异步的，之前同步接口无法落地。`commit`/`undo` 相应改为 `async`；内存桩把同步状态包进 Promise，测试用 `async IIFE` 包裹。
- **`src/store.ts`**：新增 `KEYS.importBatches = 'wb_life_import_batches'`、`KEYS.importRollback = 'wb_life_import_rollback'`，以及 4 个访问器（`get/setImportBatches`、`get/setImportRollback`）。
- **`src/import/persistence.ts`**（新增）：`createAsyncBackend()`。
  - 写入顺序：`txns → accounts → batches → rollbacks`。这是刻意的**崩溃安全**取舍：宁可只丢撤销能力，也不能留下「有 batch 但没交易」的孤儿撤销记录。
  - 复用 `store.setTxns/setAccounts`（内部 `setJSON` 自带 `emitChange()`），所以屏幕通过 `useReload` **自动刷新**，无需手动通知。
  - 导入状态全部**本地独占**，不进 Snapshot 备份（与 pending 记录同策略）。

## ② 导入入口 UI + 预览/报告/撤销页 + 加密 PDF 密码对话框

- **入口（按你的原始选型）**：`FinanceScreen` 在 `fseg === 'flow'`（流水）时，`TopAppBar.actions` 渲染右上角「导入流水」按钮（`ICONS.backup`）**和** `⋯` 更多菜单 —— 两者是**同一个入口**（菜单项复用同一 handler），不存在 TNG/支付宝/微信 各自独立的入口。
- **`src/screens/ImportFlowModal.tsx`**（新增，Modal 承载全流程，未引入 stack navigator）：
  - `pick` → `preview` → `report`，外加独立的加密 PDF 密码对话框 Modal。
  - 预览页展示：总行数/可导入/跳过重复/疑似重复/跨币合并/未分配账户数，以及逐行列表（商户、日期、分类、账户、金额、重复/疑似徽章，重复行置灰）。
  - 报告页展示 PII-free 摘要（`summarizeReport`）并提供**「撤销本批」**。
  - **密码对话框**：只显示**文件名不含路径**；显/隐切换；密码错误提示；取消即放弃；密码仅存在于 `PdfPasswordSession` 内存中。
- **`src/import/runImport.ts`**（新增，唯一的 RN 侧编排层）：DocumentPicker → `FileSystem` base64 → `b64ToBytes` → `probeFile` → `detectSource` → 对应适配器 → `buildImportPreview`。平台不匹配时**明确报错，不兜底误解析**（对齐 IMPLEMENTATION_PLAN §6.4 #12）。
- **`src/import/accountResolver.ts`**（新增，纯函数可测）：`accountHint → accountId`，优先级为 显式 id > 账户名匹配 > 同币种兜底（ewallet > debit > cash，仅无其他时才用 credit）> `undefined`（宁可不分配，也不猜错）。
- **i18n**：`importFlow` 段落已加 **中英双语**（zh.ts / en.ts）。

## ③ 跨来源「关联补全」+ `modifiedTxnIds` 撤销

- **跨币补全**：导入的 CNY `posted` 行，若账本中已存在同账户、同商户归一化、±3 天的 MYR `awaiting_posting` 交易 → **补全那笔已有交易**（写 `settleAmountMinor/settleCurrency/fxRate/fxSource='card'/isPosted=true`），**不新建第二笔**。
- **退款关联**：退款行在批内无匹配时，关联账本中已有的等额同商户 expense（写 `linkedTxnId`）。
- **可撤销**：`ImportBatch` 增加 `modifiedTxnIds`（**仅 id，保持 PII-free**）；真正的改前快照存在**独立的 `rollbacks`**（`batchId → before[]`），刻意不放进审计记录。`undo` 先 **restore 被改的已有交易**，再删除本批新建的交易，最后清掉该批快照。
- **踩坑**：`importBatchSchema` 是 `.strict()`，新增字段必须同步进 zod schema，否则会把合法 batch 判为非法（曾导致 phase1 `valid batch (no PII)` 回归失败，已修）。

## ④ 真机验证（已装机并跑通）

**两个关键决策/坑（重要，建议后续沿用）**

1. **新增 expo 原生依赖时，不要跑 `expo prebuild`。**
   `expo prebuild` 会用模板覆盖 `MainApplication.kt`，而我们自定义的 `PdfTextExtractorPackage`、`NotifyListener` 注册正写在那里面 —— 跑了就会丢。
   正确做法：`android/settings.gradle` 已配置 `expo-modules-autolinking`，Gradle 同步时会**自动扫描 node_modules**，新装的 `expo-document-picker` 直接被 autolink。所以只跑 `./gradlew assembleRelease` 即可。
   构建命令（无需 `local.properties`）：
   ```bash
   cd android && export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/Users/Luka/Android/Sdk
   ./gradlew assembleRelease --no-daemon
   adb install -r -f app/build/outputs/apk/release/app-release.apk
   ```

2. **`iconv-lite` 在 Metro 下缺 Node 内置模块**（阶段二遗留的待接线项，现已补齐）。
   首次构建在 `createBundleReleaseJsAndAssets` 失败：`Unable to resolve module string_decoder from iconv-lite/encodings/internal.js`。
   修法两步：
   - 安装 `string_decoder` npm 包；
   - 新增 `src/polyfills.ts`（`global.Buffer = Buffer`），并在 `index.js` **首行** `import './src/polyfills';`
     —— ES import 按源码顺序执行，放在第一行才能保证它先于 `App`（进而先于 `src/import/charset.ts`）求值。

**验证过程与结果**
- 构建成功 → 安装 Success → 启动：无 `FATAL EXCEPTION`，`libhermes.so` 加载，`I/ReactNativeJS: Running "main"`，无 RedBox / JS 异常，进程存活。
- `uiautomator` 驱动：首页五个 Tab 正常渲染 → 点击「财务」→ 点击「流水」→ 右上角出现 **两个 `content-desc='导入流水'` 节点 + `⋯`** → 点击后弹出 Modal，渲染出「导入流水 / 选择账单文件 / 支持 TNG PDF、支付宝 CSV(GB18030)、微信支付 XLSX、生活工作台 JSON… / 选择文件…」，**全程无 JS 错误**。

---

## 新增 / 修改文件

**新增**
- `src/import/persistence.ts` — AsyncStorage `PersistenceBackend`
- `src/import/runImport.ts` — 选文件→解析→预览 的 RN 编排层
- `src/import/accountResolver.ts` — hint → accountId（纯函数，含 6 条断言）
- `src/screens/ImportFlowModal.tsx` — 导入全流程 Modal + 密码对话框
- `src/polyfills.ts` — Buffer 垫片（Hermes 下 iconv-lite 必需）
- `INTEGRATION_PHASE_REPORT.md`（本文件）

**修改**
- `src/import/importService.ts` — 后端接口异步化；`BackendState.rollbacks`；跨来源补全；`modifiedTxnIds`；`commit/undo` 应用/回滚补丁
- `src/import/models.ts` — `ImportBatch.modifiedTxnIds`（仅 id）
- `src/import/schemas.ts` — zod 同步新增可选字段
- `src/store.ts` — 新增 2 个 key + 4 个访问器
- `src/screens/FinanceScreen.tsx` — 流水页右上角入口 + 更多菜单 + Modal 挂载
- `src/i18n/zh.ts` / `src/i18n/en.ts` — `importFlow` 双语文案
- `index.js` — 首行引入 polyfills
- `package.json` — 新增 `expo-document-picker@13.0.3`、`string_decoder`
- `scripts/import-test-runner.js` — 注册新模块

---

## 已守住的约束

- 跨币只补全、不捏造；结算币种=账户币种（R1）；当前汇率仅「约」展示（R2）；`awaiting` 不进已确认净资产（R3）。
- `ImportBatch` 审计记录零 PII（仅 id + 数值）；改前快照隔离在独立 rollback 存储。
- 密码仅内存；导入文件只在本地解析、从不上传；UI 只显示文件名不显示路径。
- 未跑 `expo prebuild`，自定义原生模块（PDF 解析 / 通知监听 / 快速记账）完好。

## 遗留（需你人工在设备上确认）

1. **全链路实测**：用真实账单文件走一遍「选文件 → 解析 → 预览 → 导入 → 报告 → 撤销」。系统文件选择器无法用 adb 可靠自动化，故这一步留给你在设备上点。
   - 建议顺序：先一份支付宝 CSV（验 GB18030 + 整数分），再一份 TNG PDF（验本地解析），最后试一次**同一文件重复导入**验证去重与「撤销本批」。
2. **通用 XLSX 列映射尚未开放**：目前非微信的 XLSX 会返回明确报错（不静默误解析），符合计划 §6.3 的门禁要求；如需通用映射，属于后续独立功能。
3. **跨来源「关联补全」目前仅跨币 + 退款两类**；转账的跨来源合并尚未实现。
