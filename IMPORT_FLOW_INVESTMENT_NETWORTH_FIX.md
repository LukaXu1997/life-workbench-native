# 理财（投资）不再影响「折合总览」净资产 — 修复记录 (Option A)

## 现象
导入支付宝理财（基金买入/赎回、余额宝收益等）后，Finance 页「③ 折合总览（约）」的
净资产比真实值低——买一笔基金就像钱凭空"蒸发"了。

## 根因
`折合总览` = 净资产 ≈ 资产 − 负债，由 `financeSummary()` → `recomputeAccounts()` 从**账户余额**累加得出。
而 `recomputeAccounts()`（`src/import/recompute.ts`）只按 `t.type` 分流余额，**完全没看 `transactionNature`**：

```ts
case 'expense':
  ...
  else if (a && a.type !== 'credit') { a._bal -= orig; }  // 理财买入也走这里，无抵消
```

支付宝理财交易：`type:'expense'` + `transactionNature:'investment'` + `affectsIncomeExpense:false` + `affectsBudget:false`
（适配器 `alipayCsv.ts`）。买入扣减现金余额，却没有任何"投资资产"账户抵消 → 净资产被压低。
Phase 4 只堵了「日支出 / 预算 / 流水列表」三层，漏掉了「账户余额 / 净资产」这一层。

## 修复（你选的 Option A：理财视为账外）
在 `recomputeAccounts` 的 txn 循环顶部加一行，跳过所有 `transactionNature==='investment'` 的行：

```ts
for (const t of txns) {
  if (t.transactionNature === 'investment') continue; // 账外：不影响余额/净资产
  const a = acc(t.accountId);
  ...
}
```

效果：理财买入 / 赎回 / 收益对账户余额与净资产**完全中性**（一买一赎相互抵消，净值不变）。
转账（充值/提现，transactionNature='transfer'）与正常收支仍正常计入。

## 验证
- 单元测试（`__phase6_tests.ts`）：新增 4 条回归断言，全部通过。
  - 余额 = 收入10000 − 正常支出2000 = 8000；加入理财买入5000/赎回3000 后**仍为 8000**。
  - `financeSummary` 的 `netWorthMYR` / `assetsMYR` 在含/不含理财交易时**相等**。
- `tsc --noEmit` 干净通过。
- 全量套件：Phase 1–7 + UI 全绿（Phase6=160, Phase7=30）。
  - 注：E2E real-files 套件仍红，原因是 TNG PDF 解密文本 `/tmp/tng_text.txt` 在 Phase 4 隐私清理后缺失（环境性，与本次改动无关，未重新解密真实账单）。

## 构建 / 安装
- 重打包签名 APK（v1.2.2 / 10202，SHA-256 `ee1cc073…a1305039`），`adb install -r` 装到 Pixel 9 Pro，数据保留。

## 已知副作用（Option A 的取舍）
因 app 不单独记"投资持仓"资产，理财被排除后：
- **账户余额**会比真实银行卡余额**偏高**「已投理财」的金额（钱仍算在现金里）。
- **净资产≈**反而更接近真实（你仍持有基金价值，只是 app 没单列）。
若你更想要"账户余额=真实卡余额"，需走 Option B（理财=转入投资资产账户，需新增账户类型 + 对应 UI），属较大功能，本次未做。
