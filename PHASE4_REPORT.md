# 阶段四完成报告 — TNG 文本型 PDF 解析 + 加密 PDF 密码流程

> 测试全绿：阶段四单测 **46 passed / 0 failed**；阶段一/二/三回归 **50 / 55 / 39 passed**；既有 notify 基线 **27 passed**；`tsc --noEmit` **0 错误**。
> 未修改任何无关 UI、未生成/签名/安装 APK、未上传任何流水文件、原始交易描述/卡号/账号/PDF 密码不写入日志。

## 1. 依赖选型（按方案①：Android 原生本地 PDF 文本抽取）

- **`com.tom-roush:pdfbox-android:2.0.27.0`**（Apache-2.0）。
  - 理由：Apache PDFBox 的官方 Android 移植，**纯 Java**、API 19+（本项目 minSdk 24 满足）、**Hermes 兼容**、支持文本抽取与加密 PDF（`InvalidPasswordException`）。
  - 安全：不含 OCR、不联网、不上传文件；仅本地抽取文本层。
  - 已加入 `android/app/build.gradle` 的 `dependencies`（本轮仅声明，真实依赖拉取/编译将在下次 APK 构建时发生，按你的要求暂不构建）。
- 已在 `MainApplication.kt` 注册 `PdfTextExtractorPackage`，并新增 `android/app/.../pdf/` 包（Module + Package）。

## 2. 新增/修改文件

### 原生（Kotlin）
- `android/app/src/main/java/com/luka/lifeworkbench/pdf/PdfTextExtractorModule.kt`
  - `extractText(uri, password?, promise)`：用 `ContentResolver` 打开 URI → `PDDocument.load(input, password)`。
  - 加密 → 返回 `{encrypted:true, wrongPassword: password非空}`（不抛错，由 JS 决定弹窗）。
  - 无文本层（扫描件）→ `{scanned:true, text:''}`，**不做 OCR**。
  - **密码仅作为方法参数传入，模块内绝不保存、不写日志、不写存储**。
  - `PDFBoxResourceLoader.init` 在每次抽取前惰性调用（幂等）。
- `android/app/src/main/java/com/luka/lifeworkbench/pdf/PdfTextExtractorPackage.kt` — 注册模块。

### JS（RN 桥接，不进入 Node 测试机）
- `src/native/PdfTextExtractor.ts` — 薄封装：`extractPdfText(uri, password?)` + `PdfEncryptedError`（含 `wrongPassword`）。
- `src/import/pdfPasswordGuard.ts` — `attachPasswordGuard(session)`：订阅 `AppState`，App 进入后台即 `session.clear()` 清除密码（满足“App 进入后台清除密码”）。

### JS（纯函数，可被 Node 单测）
- `src/import/ownerProfile.ts` — **按你的要求把你的 TNG 标识以 base64 混淆存储，源码中不以明文出现**；`getOwnerTngIdentifier()` 用内置无依赖解码器还原；`statementMentionsOwner(text)` 仅用于命中时设置账户提示，不向外写出。
- `src/import/adapters/tngPdf.ts` — **独立 TNG 适配器**（不复用通用表格规则）：`isTngStatement` 识别 + `parseTngText` 抽取交易行为 `MYR` ImportCandidate（金额→整数 sen）；日期 `DD/MM/YYYY`/`YYYY-MM-DD` 零填充；`CR/Top Up/Reload`→income，其余→expense；描述取日期与首个金额之间的文本；可选长数字作为 `rawRef`。
- `src/import/pdfPassword.ts` — `PdfPasswordSession`：**仅存于内存**，成功/取消/失败/锁定时 `clear()`；`maxAttempts` 连续失败锁定。
- `src/import/pdfExtractFlow.ts` — `runPdfExtractFlow`（纯编排，依赖注入）：无密码先试 → 加密则经 `onNeedPassword` 取密码（最多 `maxAttempts` 次）→ 成功返回文本；扫描件/取消/锁定均有明确终态，且每个终态都 `clear()` 会话密码。

### 检测与测试
- `src/import/sourceDetect.ts` — pdf 分支已指向 `tng`（提供 TNG 文本时置信度 0.85）。
- `src/import/__phase4_tests.ts` + `scripts/import-test-runner.js` — 46 条脱敏样本测试（全部用占位商户名/合成金额，运行时由解码函数构造，源码无明文标识）。

## 3. 已守住的隐私/安全约束

- PDF 密码：仅方法参数/内存会话，不落盘、不进日志、不进 `ImportBatch`。
- 扫描件：只报“当前PDF没有可提取文本，暂不支持扫描件”，无 OCR。
- TNG 标识：base64 混淆，无明文；仅本地用于账户提示匹配。
- 交易描述/卡号/账号：适配器与流程均不写日志（测试含“无 PII 日志”断言）。

## 4. 已知限制 / 待后续阶段

1. **真机最小文本抽取验证**：按你“先验证兼容+最小抽取验证”的要求，已确认 `pdfbox-android` 许可证/API 级别/RN 兼容性，并据此编写模块；但**实际抽取需在设备构建后验证**，本轮按你的要求不生成 APK。
2. **TNG 解析需真实样本微调**：当前解析器对日期/金额/描述的启发式已用合成 TNG 格式验证；拿到真实账单文本后可能需微调列识别（尤其“金额列 vs 余额列”判定）。建议你提供一份**脱敏** TNG PDF 文本以便校准。
3. 密码对话框 UI（显示文件名、隐藏密码、临时显隐、解锁/取消、失败限制、FLAG_SECURE）与“导入流水”入口页面，计划在**阶段五/六**接线，本轮未改 UI。
4. 跨币种去重、字段标准化、统一预览、原子提交、整批撤销在阶段五/六。

## 5. 修改文件清单
- 新增：`android/app/src/main/java/com/luka/lifeworkbench/pdf/PdfTextExtractorModule.kt`、`.../pdf/PdfTextExtractorPackage.kt`、`src/native/PdfTextExtractor.ts`、`src/import/ownerProfile.ts`、`src/import/adapters/tngPdf.ts`、`src/import/pdfPassword.ts`、`src/import/pdfExtractFlow.ts`、`src/import/pdfPasswordGuard.ts`、`src/import/__phase4_tests.ts`
- 修改：`android/app/src/main/java/com/luka/lifewbench/MainApplication.kt`（注册包）、`android/app/build.gradle`（pdfbox-android 依赖）、`src/import/sourceDetect.ts`（pdf→tng）、`scripts/import-test-runner.js`（Phase 4 接入）
