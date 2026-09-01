# 统一导入器 — 规则冲突报告（2026-08-28）

> 配套文档：`UNIFIED_IMPORTER_DESIGN.md` §11（已修订为权威规则）。
> 本文只做**现状 vs 新规范**的差距分析，**未改动任何代码、未生成 APK**。
> 范围：平台 / 币种 / 账户 / 去重 / 预算 / 匹配 六类规则。

---

## 0. 一句话结论

当前实现用 `NO_DEDUP_SOURCES = new Set(['alipay','tng'])` 对两平台做**整源一刀切免去重**，这与新规范的「§11.3/§11.4 支付宝↔CNY 银行卡、TNG↔MYR 银行卡仍需结算关联」以及「§11.3 同文件重复记录仍需去重」**直接矛盾**。此外适配器**硬编码币种**、**理财直接丢弃**、**Reload/充值误判收入**、**预算缺乏 `budgetCurrency/affectsBudget` 等字段**、**结算关联匹配器缺失** 均未满足新规则。

去重机制需从「整源豁免」改为「`source+accountId+currency+platformRef+date+amount+merchant` 复合键隔离」——这样 Alipay 与 TNG 因 `source/currency/account` 必然不同而**天然不互判**，同时保留同平台去重与同币种结算关联。

---

## 1. 冲突矩阵（规范一~十 → 现状 → 判定）

| # | 新规范要点 | 当前实现现状 | 判定 |
|---|---|---|---|
| 一 | 平台默认属性：支付宝=CNY ewallet，TNG=MYR ewallet；各计各币种预算 | 适配器硬编码 `currency:'CNY'`(alipayCsv.ts:238) / `'MYR'`(tngPdf.ts:139)；预算按 `Budget.currency` 区分 | ⚠️ 部分满足（普通消费路径 OK），但缺 `budgetCurrency` 显式约束、无跨币保留 |
| 二 | 两平台不能互相去重；去重键含 source/accountId/currency/platformRef/date/amount/merchant | `NO_DEDUP_SOURCES` 整源豁免(unify.ts:110)；`duplicate.ts` P1 仅 `accountKey+sourceRef`，P2 缺 source/platformRef 显式 | ❌ 冲突（机制错误：靠豁免而非键隔离；且误杀合法关联） |
| 三 | 支付宝匹配范围：同文件重复 / 另一支付宝 / 支付通知 / **CNY 银行卡充值 / 信用卡账单（结算关联）** | 跨源关联补全(3a/4b)被 `NO_DEDUP_SOURCES` 直接 skip(importService.ts:328,397)；无同币种结算关联匹配器 | ❌ 冲突（支付宝↔CNY 银行卡结算关联未实现） |
| 四 | TNG 匹配范围：同文件重复 / 另一 TNG / 支付通知 / **MYR 银行卡充值 / PayDirect（结算关联）** | 同上，跨源关联被 skip；无同币种结算关联匹配器 | ❌ 冲突（TNG↔MYR 银行卡 / PayDirect 结算关联未实现） |
| 五 | 充值=账户转账(不算收/支)；余额消费=支出；提现=转账 | 支付宝 充值(收/支=收入)→ classify `'income'`(alipayCsv.ts:125)；TNG Reload→ classify `'income'`(tngPdf.ts:59)；无充值↔银行扣款 transfer 关联 | ❌ 冲突（充值/Reload 误判为收入） |
| 六 | 理财：investment/transfer，affectsIncomeExpense=false，affectsBudget=false，可影响余额，不进日常收支 | 理财行**直接 skip 丢弃**(alipayCsv.ts:224 `isWealthManagement` 命中即 `skipped++`)，不导入也不影响余额 | ❌ 语义冲突（规范要「导入为 investment/transfer 并影响余额」，现状是「丢弃」） |
| 七 | 预算：支付宝消费扣 CNY、TNG 消费扣 MYR、理财/Renew 不扣、绝不用汇率混合 | `Txn` 无 `budgetCurrency/affectsBudget/affectsIncomeExpense/transactionNature`(types.ts)；`recompute` 仅按 currency 汇总(types 无字段可查) | ❌ 缺口（缺字段，无法表达「不扣预算」「不进收支」） |
| 八 | 首次分别绑定：支付宝→CNY 账户，TNG→MYR 账户；存 ImportTemplate 下次自动建议 | `accountResolver` 按 hint+currency 名称匹配(accountResolver.ts)；`ImportTemplate` 无 `boundAccountId`(models.ts:102) | ⚠️ 缺口（无显式按源绑定持久化；当前靠币种+名称侥幸分开） |
| 九 | 无币种列→平台推断并提示；与默认冲突→标记待确认、不静默转换、保留真实币种 | 适配器不读币种列、不推断、不检测冲突(standardize.ts 仅用适配器给的币种)；无 `currencyInferred/currencyConflict` 字段 | ❌ 缺口（无法处理异常币种） |
| 十 | 10 条测试底线（含二次导入同平台内去重） | 见 §3 映射 | ❌ 多数未满足（尤其 #4/#5/#6/#7/#10） |

---

## 2. 关键冲突点（带文件:行号）

### 2.1 整源豁免去重 —— 头号冲突
- `src/import/models.ts:34-37`：`export const NO_DEDUP_SOURCES = new Set(['alipay','tng'])`。
- `src/import/unify.ts:110-114`：对 `alipay/tng` 强制 `dupStatus='none'`、`skipByDefault=false`——**即使是同文件同一交易号也永不判重**。
- `src/import/importService.ts:328`（跨源关联补全 3a）、`:397`（跨源退款关联 4b）、`:420-424`（跨源重复抑制 5）均以 `!NO_DEDUP_SOURCES.has(row.source)` 跳过。

**后果**：
1. 违背 §11.3「同一支付宝文件中的重复记录」应去重 → 现状**不去重**（冲突 #10）。
2. 违背 §11.3/§11.4「支付宝↔CNY 银行卡、TNG↔MYR 银行卡结算关联」→ 现状**直接关闭**（冲突 #4/#5）。

**修正方向**：删除 `NO_DEDUP_SOURCES`；去重键改为复合键（§11.10），跨平台不互判由键天然保证。

### 2.2 充值 / Reload 误判收入
- `src/import/adapters/alipayCsv.ts:125`：`收入` → `type:'income'`。支付宝侧「银行卡充值支付宝」在支付宝账单里表现为 `+收入`，应判 `transfer`（§11.5）。
- `src/import/adapters/tngPdf.ts:59`：`(top|up|reload|cashback|credit)` → `type:'income'`。TNG Reload 应判 `transfer`（§11.5）。

**后果**：充值 / Reload 被当收入，叠加银行侧扣款 = 资金被「收入 + 支出」双重计入（冲突 #6/#7）。

### 2.3 理财直接丢弃（而非 investment/transfer）
- `src/import/adapters/alipayCsv.ts:115` `WEALTH_KEYWORDS = [...]`；`:224` 命中即 `skipped++`，**不进入候选**。

**后果**：余额宝/基金等完全不导入，余额不受影响（§11.6 要求可影响余额）。属语义冲突 + 缺口（冲突 #8）。

### 2.4 预算/收支控制字段缺失
- `src/types.ts:12-43` `Txn` 无 `budgetCurrency / affectsBudget / affectsIncomeExpense / transactionNature`。
- `src/import/recompute.ts:26-41` `financeStats` 仅按 `txnOrigCurrency` 汇总 income/expense，无法表达「不进收支」「不扣预算」。

**后果**：即使将来导入理财，也无字段阻止其进入收支/预算（冲突 #7/#8）。

### 2.5 结算关联匹配器缺失
- `src/import/matchers/` 现有 `duplicate / transfer / refund / crossCurrency` 四种。`crossCurrency` 仅处理 **MYR awaiting ↔ CNY posted**（信用卡跨币 posted），**不处理** §11.3/§11.4 的同币种结算关联（支付宝消费 ↔ CNY 信用卡账单；TNG 消费 ↔ MYR 银行/PayDirect）。

**后果**：§11.3/§11.4 的「消费事实 + 结算来源关联到同一主交易」无实现路径（冲突 #4/#5）。

### 2.6 无按源账户绑定
- `src/import/models.ts:102-112` `ImportTemplate` 仅有 `source/fileKind/mappings`，无 `boundAccountId`。
- `src/import/accountResolver.ts:17-44` 依赖 `accountHint` + 名称/币种匹配，无显式持久化绑定。

**后果**：无法满足 §11.8「首次绑定、下次自动建议」；当前靠「CNY≠MYR 币种」侥幸分开，若用户有同名多币种账户会出错（冲突 #9）。

### 2.7 异常币种无处理
- `src/import/standardize.ts:33-56` 仅用适配器给的 `currency`，不读文件币种列、不推断、不检测冲突。
- 适配器（alipayCsv/tngPdf）硬编码币种，不解析文件里可能出现的真实币种。

**后果**：违反 §11.9（无推断提示、无冲突标记、无跨币保留）（冲突 #一/#九）。

---

## 3. 10 条测试底线映射（当前能否通过）

| 测试# | 内容 | 当前状态 | 说明 |
|---|---|---|---|
| 1 | 支付宝¥100 只进 CNY 支出/预算 | ✅ 普通路径可过 | 但缺 `budgetCurrency` 显式约束 |
| 2 | TNG RM100 只进 MYR 支出/预算 | ✅ 普通路径可过 | 同上 |
| 3 | 支付宝¥100 ≠ TNG RM100 不判重 | ⚠️ 巧合通过 | 靠 `NO_DEDUP` 豁免，机制错误（非键隔离） |
| 4 | 支付宝只匹配 CNY 资金来源/结算 | ❌ 未实现 | 跨源结算关联被 skip，匹配器缺失 |
| 5 | TNG 只匹配 MYR 资金来源/结算 | ❌ 未实现 | 同上 |
| 6 | 支付宝充值不算收入 | ❌ 冲突 | 充值→income |
| 7 | TNG Reload 不算收入 | ❌ 冲突 | Reload→income |
| 8 | 支付宝理财不计入收支/预算 | ⚠️ 巧合通过(丢弃) | 但规范要「导入为 investment 并影响余额」，现状是丢弃 |
| 9 | 两平台分别绑定独立账户 | ⚠️ 部分 | 靠币种侥幸分开，无显式绑定持久化 |
| 10 | 二次导入同文件正确去重 | ❌ 冲突 | `NO_DEDUP` 使二次导入不去重，全量重复 |

**结论**：仅 #1/#2 普通路径稳定通过；#3/#8 靠「豁免/丢弃」巧合通过但机制与规范不符；#4/#5/#6/#7/#10 明确不满足。

---

## 4. 规范内部张力的解释（已在新文档 §11.0/§11.10 解决）

§二要求去重键「必须含 source」（即跨 source 永不 drop 重复），而 §三/§四又要求「支付宝↔CNY 银行卡、TNG↔MYR 银行卡」做结算关联（跨 source）。两者看似矛盾，解释为：

- **去重（drop）键含 source** → Alipay 与 TNG、Alipay 与 bank 之间**永不互相丢弃**（满足 §二）。
- **结算关联（link）是另一操作**，仅在同一 `currency` 内把两条记录关联到同一主交易（消费事实 + 结算来源），**保留两条、不丢弃**（满足 §三/§四）。
- 支付宝 ↔ TNG 之间既不 drop 也不 link（满足「两平台禁止互判/互合」）。

文档已据此在 §11.0 与 §11.10 明确区分两种操作，并新增 `SettlementLinkMatcher`。

---

## 5. 实现前必须修改清单（优先级排序，供下一步实施）

**P0（正确性，解决头号冲突）**
1. 删除 `NO_DEDUP_SOURCES`；`ImportCandidate`/`Txn` 增加 `platformRef`；`duplicate.ts` 去重键改为 `(source, accountId, currency, platformRef, date, amountMinor, merchantNorm)`（P1 同 platformRef；P2 同 source+account+currency+date+amount+merchant）。
2. 新增 `SettlementLinkMatcher`：同币种内 支付宝消费 ↔ CNY 银行卡/信用卡结算记录、TNG 消费 ↔ MYR 银行/PayDirect，关联到同一主交易（保留两条）。
3. 跨源关联补全(3a/4b/5)解除对 `NO_DEDUP_SOURCES` 的依赖，改为按「同币种 + 同 source 族（ALIPAY 关联 CNY 银行类；TNG 关联 MYR 银行类）」放行。

**P1（收入/支出正确性）**
4. 支付宝 `收/支=收入` 且为充值语义 → `transfer`；TNG `topup/reload` → `transfer`；建立充值 ↔ 银行扣款 transfer 关联（§11.5）。
5. `Txn` 增加 `budgetCurrency / affectsBudget / affectsIncomeExpense / transactionNature`；`financeStats`/`recomputeAccounts` 消费这些字段（理财/Renew 不进收支与预算）。

**P1（理财语义）**
6. 支付宝理财行改为导入为 `transactionNature=investment|transfer`、`affectsIncomeExpense=false`、`affectsBudget=false`，可影响对应资产账户余额（不再整行丢弃）。收益类保留 `investmentIncome`。

**P2（账户/币种）**
7. `ImportTemplate` 增加 `boundAccountId`（按 source）；`accountResolver` 优先用模板绑定。
8. 适配器读取文件币种列：无币种列→平台推断并标 `currencyInferred`+预览提示；与默认冲突→标 `currencyConflict`+待确认，保留真实币种（§11.9）。

**测试**
9. 按 §11.11 的 10 条补充单测；其中 #4/#5/#6/#7/#10 需新建（当前全红）。

---

## 6. 备注 / 需你确认的点

- 当前 `WEALTH_KEYWORDS` 含 `基金`/`理财`（alipayCsv.ts:115），范围偏宽，可能误伤普通「基金」类消费文案；实施 P1-6 时建议收窄为余额宝系 / 蚂蚁财富系精确匹配。
- 二次导入去重（#10）的范围：新规范定义为「同一平台 + 同一账户 + 同一 platformRef/金额/日期/商户」。实施时需确认是否对**已存在于账本**的同平台记录也做去重（当前 `findExistingDuplicates` 逻辑会因 P0-3 改动而恢复生效）。
- 结算关联是否要在预览中默认勾选「关联」，还是默认仅标注待用户确认——建议默认标注待确认（保守，避免误合）。
