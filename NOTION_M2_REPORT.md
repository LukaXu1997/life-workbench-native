# Notion 风格 UI 重设计 — Milestone 2 报告

**目标**：在 M1（确立中性灰阶 design token 体系）的基础上，将 Notion 扁平化风格从 token / 共享组件层延伸到全部业务屏幕，去掉残留的 Material 风格描边与阴影。

**完成日期**：2026-08-30
**状态**：✅ 源码级完成（tsc 通过，0 错误）
**验证方式**：因沙箱无 JVM，无法构建 APK 真机验证；采用 `tsc --noEmit` + 全仓源码扫描确认。

---

## 核心规则（M2 统一采用）

| 元素 | M1 残留 | M2 统一值 |
|------|---------|-----------|
| 卡片 / 磁贴描边 | `borderWidth:1` + `outlineVariant` / `outline` | 移除描边，仅靠 `surfaceContainer` 背景区分层级 |
| 输入框 / 文本域边框 | `borderWidth:1` + `outline` | `StyleSheet.hairlineWidth` + `theme.divider` |
| Chip / 胶囊选中态 | `borderWidth:1` + `theme.primary` | `sel ? hairlineWidth : 0` + `sel ? theme.outline : undefined` |
| 列表分隔线 | `borderWidth:1` / `outlineVariant` 背景 | `StyleSheet.hairlineWidth` + `theme.divider` |
| 顶栏底部分隔 | `borderWidth:1` + `outlineVariant` | `StyleSheet.hairlineWidth` + `theme.divider` |

> 所有分隔线统一改用 `theme.divider`（亮色 `#EDEDEB` / 暗色独立值），替换原先直接写死的 `outlineVariant`，以保证暗色模式下分隔线正确渲染（原 `outlineVariant` 暗色为 `rgba(255,255,255,0.09)`，与 `divider` 不一致）。

---

## 变更文件清单（M2）

### 共享组件层（扁平化收口）
- `src/components/kit.tsx`
  - `Card` / `PrimaryCard` / `ActionTile` / `ListItem` / `Chip`：M1 已去描边（本次追加 `TextField` 边框改 hairline、`outlineVariant`→`divider` ×2：列表分隔线、底部抽屉握把）
- `src/components/ui.tsx`
  - `Chip`：`borderWidth:1`+`theme.primary` → `sel?hairline:0`+`sel?theme.outline:undefined`
  - `TextField`：`borderWidth:1`+`theme.outline` → `hairlineWidth`+`theme.divider`
  - `ListRow`：`borderBottomWidth:1` → `StyleSheet.hairlineWidth`（颜色已为 `divider`）
  - `TopAppBar`：底部分隔 `borderWidth:1`+`outlineVariant` → `hairlineWidth`+`theme.divider`
  - `Switch`：关闭态轨道 `outlineVariant` → `theme.divider`

### 业务屏幕
- `src/components/AppTabBar.tsx`：悬浮栏 `borderColor: theme.outlineVariant` → `theme.divider`（保留 `elevation[1]` 微抬升，符合「hairline + 极轻浮起」的 Notion 风格意图）
- `src/components/anim.tsx`：底部抽屉握把 `outlineVariant` → `theme.divider`
- `src/screens/HomeScreen.tsx`：两处 hairline 分隔线 `outlineVariant` → `theme.divider`（已加 `StyleSheet` 导入）
- `src/screens/TasksScreen.tsx`：`fieldStyle` 输入框 `borderWidth:1` → `hairlineWidth`（已加 `StyleSheet` 导入）
- `src/screens/QuickAddScreen.tsx`：`fieldStyle` 与账户胶囊选择器去描边（已加 `StyleSheet` 导入）
- `src/screens/ConfirmTxnScreen.tsx`：账户胶囊选择器 `borderWidth:1`+`theme.primary` → `sel?hairline:0`+`sel?theme.outline:undefined`（已加 `StyleSheet` 导入）
- `src/screens/ImportFlowModal.tsx`：
  - `styles.acctChip`：`borderWidth:1` → `hairlineWidth`
  - `styles.row`：`borderBottomWidth:1` → `hairlineWidth`
  - `styles.pwdRow`：`borderWidth:1` → `hairlineWidth`
  - 账户芯片选中色 `theme.primary` → `theme.outline`；行分隔 `outlineVariant` → `divider`；密码框 `theme.outline` → `theme.divider`
- `src/screens/FinanceScreen.tsx`：
  - 账户胶囊选择器 `borderWidth:1`+`th.primary` → `sel?hairline:0`+`sel?th.outline:undefined`
  - `editFieldStyle` 输入框 `borderWidth:1` → `hairlineWidth`
  - 4 处 hairline 分隔线 `outlineVariant` → `theme.divider`

---

## 验证结果
- ✅ `tsc --noEmit`：0 错误
- ✅ 全仓扫描：无残留 `borderWidth: 1`、`borderColor: theme.outline`、`borderColor: theme.primary`、`outlineVariant` 业务用法（仅 `theme.ts` 的 token 定义保留）
- ⏭️ 真机 APK 验证：跳过（沙箱无 JVM / Java Runtime，且 Hermes 为必需——禁用 Hermes 后 JSC 无法解析 `??` / `?.`，会导致运行时崩溃）

---

## 与 M1 的关系
- M1：确立 Notion 中性灰阶 token（`bg/surface/text/t2/t3/bd/divider/accent/primary` 等），并完成 `theme.ts`、`tokens.ts` 落地 + 共享组件首轮去描边。
- M2：将扁平化延伸到所有业务屏幕，统一分隔线 token 为 `divider`，消除零散的 Material 描边。

## 后续建议（M3，可选）
- 若需进一步贴近 Notion：可统一卡片圆角（当前 `radius.card` 即可）、审查各屏幕内部 `surfaceContainer` 嵌套层级是否过度。
- 真机视觉走查：在 Pixel 设备（46201FDAP007FD）上构建 release APK，对照 Notion 截图微调间距 / 字重。
- i18n：确保 M2 改动未引入新硬编码文案（本次均为样式改动，无文案变更）。
