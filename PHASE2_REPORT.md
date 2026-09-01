# 阶段二完成报告 — 支付宝 CSV 解析 + GB18030 解码

> 状态：**仅代码 + 纯 Node 自动测试 + 说明**，未修改无关 UI、未生成/签名/安装 APK。
> 进入下一阶段（第三阶段：微信 XLSX）前需你确认。

## 测试结果

| 套件 | 结果 |
|------|------|
| 阶段一 回归（models / fileDetect / sourceDetect / schemas / migration） | **50 passed, 0 failed** |
| 阶段二（charset GB18030/UTF-8 / Alipay CSV adapter） | **55 passed, 0 failed** |
| 既有 notify 基线（确认页自动填充等） | **27 passed, 0 failed** |
| `tsc --noEmit` 类型检查 | **0 错误** |

合计本次新增 **55 条阶段二断言 + 50 条阶段一回归 = 105 条 import 断言全绿**，基线无回退。

## 新增依赖（及选择原因）

| 依赖 | 版本 | 许可 | 用途 | 兼容性结论 |
|------|------|------|------|-----------|
| `iconv-lite` | `^0.6.3` | MIT | 设备本地 GB18030 / UTF-8 解码，纯 JS、无网络、无 OCR | 0.6.3 **自带 `lib/index.d.ts` 类型**；纯 JS，RN/Hermes 通用 |
| `buffer` | `^6.0.3` | MIT | Hermes 下提供 `Buffer` 实现（`iconv-lite` 与 charset 依赖 Buffer） | Expo/RN 标准 polyfill 方案；已显式加入 dependencies |

> 注：按你的选型，GB18030 走 `iconv-lite` 在**设备本地**完成，流水与密码**不上传**任何服务。

## 新增 / 修改文件

- `src/import/charset.ts`（新增）— 编码自动识别与解码
  - 顺序：UTF-8 BOM → 严格 UTF-8 → GB18030；以**品牌/表头签名**（如 `"支付宝"`）校验解码结果
  - 返回结构含 `encoding`、`bom`、`replacementRatio`；当 UTF-8 与 GB18030 都无法可靠判断时返回 `needs_user_choice`（供 UI 让用户手选），**绝不静默导入乱码**
  - `forceDecode()` 供 UI 在用户手选编码后强制解码（仍报告替换率以便告警）
  - 模块**不写任何日志**，原始交易文本只留在内存
- `src/import/adapters/types.ts`（新增）— `ImportAdapter` 统一契约（validate / parse）
- `src/import/adapters/alipayCsv.ts`（新增）— 支付宝 CSV 适配器
  - 定位真实表头行（含 `金额` + 时间列 + `收/支`/`收付款方向`），兼容新旧两种表头
  - RFC4180 引号字段切割；金额 → **整数分（fen）**，币种固定 `CNY`；`收/支`+`交易状态` → `income/expense/transfer/refund`
  - 跳过未终态行（失败/处理中/已关闭）；商户取「交易对方」，缺则取「商品说明」
  - `accountHint='支付宝'`（供后续按币种建议账户）；`rawRef`/`meta.orderId` 仅存平台单号（非 PII）
  - `parseAlipayFile()` 编排：解码 → 校验 → 解析，非支付宝文件在校验阶段即拒绝
- `src/import/__phase2_tests.ts`（新增）— 55 条脱敏样本测试（含 GB18030 字节级往返、签名校验、乱码→手选、金额/币种/类型映射、跳过逻辑、隐私无日志）
- `scripts/import-test-runner.js`（修改）— 注册 charset / adapters / money 与新套件
- `package.json`（修改）— 增加 `iconv-lite`、`buffer` 依赖

## 已守住的约束（对照你的选型）

- ✅ GB18030 本地解码，依次 BOM→UTF-8→GB18030，并用「支付宝」等签名校验
- ✅ 解码失败/不可靠时**不静默导入**，返回需用户手选
- ✅ 原始交易描述**不写入日志**（测试显式断言 console 无任何商户名泄露）
- ✅ 金额一律转为整数分/fen，禁止浮点直接作为最终金额
- ✅ 样本全部脱敏（商户为「示例咖啡店 / 星巴克(国贸店) / 示例用户乙」等占位，无真实卡号/账号）

## 已知限制 / 待办（留给后续阶段）

1. **Hermes Buffer 垫片**：`charset.ts` 已显式 `import { Buffer } from 'buffer'`，但 `iconv-lite` 内部可能引用全局 `Buffer`。建议在应用启动处加一行 `global.Buffer = require('buffer').Buffer`（属 Phase 5/6 UI 接入时的接线，本阶段不碰 App 入口）。Node 测试环境全局 Buffer 天然存在，故测试全绿。
2. **未加引号的千分位逗号**：真实支付宝金额用纯小数（如 `1234.56`），不含千分位。若某字段出现**未加引号**的内嵌逗号（CSV 歧义），按 CSV 规范无法可靠拆分；已支持**加引号**的数字（如 `"1,234.56"`）正确解析为 123456 分。
3. **PDF / XLSX / 生活工作台 JSON 适配器**尚未实现（分别在阶段四 / 三 / 一已建 schema）。
4. **跨币去重、标准化、原子提交、撤销**在阶段五/六；本阶段只产出 `ImportCandidate`，不做写入。

请确认阶段二结果。确认后进入**阶段三：微信支付 XLSX 解析**（引入 SheetJS `xlsx`，本地只读、多 Sheet、自动找表头、日期序列值/字符串并存、金额转整数分/fen）。
