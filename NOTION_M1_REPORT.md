# Notion 风格 UI 重设计 — Milestone 1 完成报告

> **日期**: 2026-08-31
> **范围**: 设计令牌 + 基础组件 + 底部导航 + Home 页面（Milestone 1 核心层）
> **验证**: TypeScript 编译通过 (`tsc --noEmit` clean)，源码逐文件审查确认

---

## 一、设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 配色策略 | **纯中性灰阶** | 去除品牌绿，整体走 Notion 式暖灰；页面近白 `#FFFFFF` / 面板 `#F7F7F5` / 文字 `#37352F` |
| 点缀色 | **Notion 蓝 `#2383E2`** | 仅用于链接、选中文本等点缀，不做主品牌色 |
| 主操作色 | **近黑 `#37352F`** (Light) / `#FFFFFF` (Dark) | Notion 的主按钮/选中态/进度条均用近黑或纯白 |
| 字体 | **Inter (400/500/600/700)** | 通过 `@expo-google-fonts/inter` 内置，注入 `M3Text` 统一入口 |
| 圆角 | **收敛克制** | `sm:6, md:8, lg:10, xl:12, card:12, xxl:14` — 比 M3 更克制 |
| 阴影 | **近乎扁平** | shadowColor 改为中性 `#0F0F0F`，opacity 降低 |
| 卡片/边框 | **去边框、去阴影** | Card 组件移除 borderWidth/borderColor/shadow/elevation，仅保留 bg+radius+padding |
| 图标 | **仅改中性色** | 保持现有 icon shape，颜色跟随 theme 中性色 |

---

## 二、修改文件清单 (6 files)

### M1-① `src/theme.ts` — 核心调色板重写
- **Light 模式**: `bg:#FFF` / `surface:#F7F7F5` / `text:#37352F` / `t2:#787774` / `t3:#9B9A97`
- **Dark 模式**: `bg:#191919` / `surface:#202020` / `text:#FFF` / `t2:rgba(255,255,255,0.62)`
- **accent**: `#2383E2` (Notion 蓝，Light) / `#529CCA` (Dark)
- **primary**: `#37352F` (Light，近黑交互色) / `#FFF` (Dark)
- **primaryContainer**: `rgba(55,53,47,0.06)` (Light) / `rgba(255,255,255,0.08)` (Dark)
- **收入/支出语义色**: 保留低饱和 teal (`#1F8A7A`) / coral (`#D66A60`)
- 所有字段名保持不变 → 零破坏性级联

### M1-② `src/tokens.ts` — 圆角 & 阴影中性化
- radius: `{ sm:6, md:8, lg:10, xl:12, card:12, xxl:14, pill:9999 }`
- elevation shadowColor: `#14301E`(绿) → `#0F0F0F`(中性黑)

### M1-③ `src/components/ui.tsx` — Inter 字体 + 扁平卡片
- 新增 `INTER_FAMILY` 映射表 (400→Inter_400Regular, 500→Inter_500Medium, 600→Inter_600SemiBold, 700→Inter_700Bold)
- `M3Text`: 注入 `fontFamily: INTER_FAMILY[t.fontWeight] ?? 'Inter_400Regular'`
- `Card`: 移除 `borderWidth/borderColor/shadowColor/shadowOpacity/shadowRadius/shadowOffset/elevation:1`
- `Header`: `borderBottomWidth:1` → `StyleSheet.hairlineWidth`, borderColor → `theme.divider`

### M1-④ `src/components/AppTabBar.tsx` — 底部导航中性化
- `bar` 样式: `borderWidth:1` → `StyleSheet.hairlineWidth`
- FAB 自动使用 `theme.primary` (现为近黑/纯白)

### M1-⑤ `App.tsx` — Inter 字体加载注册
- import `Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold` from `@expo-google-fonts/inter`
- `useFonts` 注册全部 4 个 weight

### M1-⑥ `src/screens/HomeScreen.tsx` — 快捷入口去边框
- 快捷瓷砖: 移除 `borderWidth:1, borderColor:theme.outlineVariant`
- 仅保留 `backgroundColor: theme.surface, borderRadius: radius.lg`

---

## 三、验证状态

| 检查项 | 状态 | 说明 |
|--------|------|------|
| TypeScript 编译 | ✅ PASS | `tsc --noEmit` 零错误 |
| theme.ts 调色板 | ✅ CONFIRMED | Notion 中性灰阶完整，含 Light + Dark |
| tokens.ts 圆角/阴影 | ✅ CONFIRMED | 收敛圆角 + 中性阴影 |
| ui.tsx Inter 注入 | ✅ CONFIRMED | fontFamily 映射 + 扁平 Card |
| AppTabBar hairline | ✅ CONFIRMED | hairlineWidth 替代 1px 边框 |
| App.tsx 字体加载 | ✅ CONFIRMED | 4 个 Inter weight 注册 |
| HomeScreen 去边框 | ✅ CONFIRMED | 快捷入口无边框 |
| 设备 APK 验证 | ⚠️ SKIP | 当前环境无 JVM → 无法执行 Gradle 构建；用户需在本地 `npx expo run:android` 验证 |

---

## 四、临时构建变更回滚

以下验证用临时修改已**全部回滚**:

| 文件 | 临时修改 | 当前状态 |
|------|----------|----------|
| `android/gradle.properties` | `hermesEnabled=false` | ✅ 已恢复 `true` |
| `android/app/build.gradle` | debug 加 `.debug` 后缀; release 加 `.shot` 后缀+debug签名 | ✅ 已恢复原始配置 |
| 设备包 | `com.luka.lifeworkbench.shot` + `.debug` | ✅ 已卸载 |

---

## 五、Milestone 2 预览（待用户确认后启动）

M1 覆盖了**设计基础设施层**（tokens → 基础组件 → 首页）。M2 将把 Notion 风格扩展到各业务页面：

1. **Finance（记账理财）** — dashboard 卡片、图表配色、交易列表
2. **Plan/Tasks（计划/任务）** — 任务项、复选框、优先级标签
3. **Habits（习惯打卡）** — 打卡日历、进度环、统计面板
4. **Diary（日记）** — 编辑器、时间线样式
5. **Me/Settings（我的/设置）** — 设置项分组、开关、头像区域

每个页面的改造遵循相同原则：中性底色 + Inter 字体 + 收敛圆角 + 扁平卡片 + Notion 蓝仅作点缀。

---

## 六、使用方式

用户在本地环境执行以下命令即可在设备上预览 M1 效果:

```bash
cd life-workbench-native
npx expo start --dev-client     # 开发模式 (Metro)
# 或
npx expo run:android            # 直连设备构建运行
```

构建时 Hermes 默认启用 (`hermesEnabled=true`)，代码中 `??` / `?.` 操作符可正常运行。
