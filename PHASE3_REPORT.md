# 阶段三完成报告 — 微信支付 XLSX 解析（SheetJS `xlsx`）

> 实施约束遵守：未修改任何无关 UI、未生成/签名/安装 APK、未上传任何流水文件、原始交易描述/卡号/账号不写入日志。

## 测试结果（全绿）

| 套件 | 结果 |
|---|---|
| 阶段三（WeChat XLSX） | **39 passed / 0 failed** |
| 阶段二回归（GB18030 / 支付宝） | 55 passed / 0 failed |
| 阶段一回归（模型 / 文件检测 / Schema / 迁移） | 50 passed / 0 failed |
| 既有 notify 基线（含 confirm-form） | 27 passed / 0 failed（累计 163） |
| `tsc --noEmit` | **0 错误** |

## 依赖选型与合规性（按用户要求在执行前确认）

| 项 | 结论 |
|---|---|
| 库 | SheetJS **`xlsx` 0.20.3**（不是 npm 上的 0.18.5） |
| 许可证 | **Apache-2.0**（与 App 兼容，可闭源分发） |
| 安全性 | npm 上的 `xlsx@0.18.5`（2022，最后发布）含已知 CVE：**CVE-2023-30533**（原型链污染）、**CVE-2024-22363**（ReDoS）。修复版本仅由 SheetJS 官方 CDN 分发，故从 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` 安装，已消除上述漏洞。 |
| RN/Hermes 兼容 | `xlsx` 支持 React Native；本阶段仅做 Node 端纯逻辑与单测，APK 接线留待阶段五/六。读取路径用 `type:'array'`（Uint8Array），并在有 `Buffer` 时优先 `type:'buffer'`，兼容 Hermes。 |
| 类型 | 自带 `types/index.d.ts`，`tsc` 解析正常。 |

> 注：`package.json` 中 `dependencies.xlsx` 记录为 CDN tarball URL（SheetJS 官方推荐的安装方式）。若团队要求纯 npm 锁定，可在生产构建前改为锁定到该固定版本的 CDN 源或私有镜像，但**不要回退到 npm 的 0.18.5**。

## 新增 / 修改文件

- `src/import/adapters/wechatXlsx.ts`（**新增**）
  - `readWorkbook`：先用 `isWithinFileSize` 拦截超大文件，再 `XLSX.read`，并关闭公式/宏/VBA/样式/HTML（`cellFormula:false, bookVBA:false, cellStyles:false, cellHTML:false`）；工作表数超 `maxSheets` 直接拒绝。
  - `findWechatSheet`：跨所有 sheet 扫描前 20 行，按表头别名匹配定位真实表头行（兼容前置抬头行：微信支付账单明细 / 导出时间 / 账号）。要求命中 `交易时间`+`金额` 且已知列 ≥4，避免数据行误判。
  - `parse`：逐行解析，金额 → **整数分(fen，CNY)**；`收/支`+`交易类型`+`当前状态` → `income/expense/transfer/refund`；**跳过未终态行**（已关闭/已撤销/失败/待支付/处理中）；`accountHint='微信支付'`；`rawRef` 仅存单号（非 PII）。
  - 日期三态解析：`formatCellDateTime` 支持① Date 对象（cellDates）② Excel 日期序列值（45323→2024-02-01 等，含 1900 闰年修正）③ 字符串（容忍 `2026/1/1 9:5` 这类 1 位月/日/时/分并补零）。
  - `isWechatXlsx(bytes)`：供来源检测调用的纯函数。
  - `parseWechatFile({name,bytes})`：read→detect→parse 编排入口。
- `src/import/sourceDetect.ts`（**修改**）：`SourceProbe` 增加 `bytes?`；`xlsx` 分支在有字节时先调 `isWechatXlsx`，命中则 `source:'wechat'`（置信 0.9），否则回落 `genericXlsx`。**入口仍是唯一「导入流水」流程，不新增「微信导入」独立入口。**
- `src/import/__phase3_tests.ts` + `scripts/import-test-runner.js`（**新增/修改**）：39 条脱敏样本测试；样本全部用 `xlsx.write` 在内存生成，**不落地任何真实账单文件**。覆盖：WeChat 检测/非 WeChat 拒识、来源检测路由、金额/币种/类型映射、跳过非终态、`/` 日期与单数字段、Excel 日期序列值、无表头拒绝、空字节、以及**隐私断言（适配器不向 console 输出商户名/单号）**。

## 已守住的约束

- 本地只读解析，不执行公式/宏/外部链接；文件大小/Sheet/行/列上限在读取前与解析中双重拦截。
- 金额一律整数分，绝不用 JS 浮点作为最终财务金额。
- 原始描述不写日志；`ImportBatch`（阶段六）只存 id + 数值汇总。
- 样本全部脱敏（示例咖啡店 / 示例用户乙 / 4200000xx 假单号）。

## 已知限制（留给后续阶段）

1. **Hermes 加载**：阶段五/六接入 App 入口时需确认 `xlsx` 在 Hermes 下的打包（必要时加 `buffer` 垫片与 metro 配置），本阶段仅在 Node 验证。
2. **加密 Excel**：微信账单一般为非加密；若遇加密 `.xlsx`，`readWorkbook` 会捕获并提示「文件已加密，暂不支持加密的 Excel 账单」。真正的加密解锁流程按用户方案聚焦在 **PDF（阶段四）**。
3. 跨币种去重、字段标准化/分类建议、统一预览、原子提交、撤销在阶段五/六。
4. 微信「支付方式」列（如 `招商银行(1234)`）目前仅用作 `accountHint='微信支付'` 的旁证，未做精细化账户映射（阶段五根据 `accounts` 列表建议具体账户）。

---

请确认阶段三结果。确认后进入**阶段四：TNG 文本型 PDF 解析 + 加密 PDF 密码流程**（按方案①采用 Android 原生/本地 PDF 文本抽取，先做最小文本抽取验证与依赖兼容性确认，再实现 TngPdfAdapter 与加密解锁 UI 逻辑）。
