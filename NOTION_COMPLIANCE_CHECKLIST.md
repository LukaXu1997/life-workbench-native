# Notion 风格合规核对清单（逐像素标尺）

> 用途：本地构建出 APK 安装到 Pixel（46201FDAP007FD）后，按本清单逐屏截图，逐条比对。
> 所有色值提取自 `src/theme.ts`（M1 中性灰阶 + M2 扁平化后的当前生效值）。
> 原则：**无品牌绿、无描边、分隔线极细、阴影近平、强调蓝仅限链接/选中文本**。

---

## 〇、字体加载机制（已解决，验证前必读）

- **Inter 字体通过原生 `assets/fonts/` 打包**，而非 Metro 的 `res/raw` 通道。
  - `assets/fonts/Inter_400Regular.ttf … Inter_700Bold.ttf` 由 `react-native.config.js` 的
    `assets: ['./assets/fonts/']` 复制到 `android/app/src/main/assets/fonts/`（与
    `MaterialCommunityIcons.ttf` 同一目录，后者已验证可正常加载）。
  - expo-font 的 `useFonts({ Inter_400Regular: require('./assets/fonts/Inter_400Regular.ttf') })`
    在 Android 上会从 `assets/fonts/` 原生加载（与图标字体的加载路径完全一致），
    `fontFamily: 'Inter_400Regular'` 等名与 TTF 文件名严格对应。
- **为什么不走 `res/raw`**：RN 0.76 的 Metro 会把 `require('*.ttf')` 产出到
  `generated/res/.../raw`，但 aapt2 的 `optimizeReleaseResources`（且 `enableShrinkResourcesInReleaseBuilds=true`）
  会把这些仅在运行时通过 `getIdentifier("raw", ...)` 引用的字体当作「未使用资源」剥离，
  导致最终 APK 的 `res/raw` 字体计数为 0，App 静默回退系统字体。
- **验证口径**：用 `unzip -l app-release.apk | grep assets/fonts/.*\.ttf` 应有 5 个 TTF
  （Inter ×4 + MaterialCommunityIcons ×1）。当前构建已确认。

---


## 一、当前生效 Token（核对基准）

### 浅色（LIGHT）
| 角色 | 值 | 用途 |
|------|-----|------|
| `bg` 页面底 | `#FFFFFF` | 近白页面 |
| `surface`/`surfaceContainer` 面板 | `#F7F7F5` | 卡片/列表/输入框背景 |
| `text`/`primary` 主文字 | `#37352F` | 暖近黑 |
| `t2` 次要 | `#787774` | 副标题/占位 |
| `t3` 三级 | `#9B9A97` | 极弱 |
| `divider` 分隔线 | `#EDEDEB` | **hairline 极细线** |
| `outline` 描边 | `#D3D1CB` | 仅输入框/未选中描边（hairline 宽度） |
| `primaryContainer` 选中填充 | `rgba(55,53,47,0.06)` | 中性半透明 |
| `accent` 强调蓝 | `#2383E2` | **仅链接/选中文本** |
| `income` 收入语义 | `#1F8A7A` | 低饱和 teal（财务） |
| `expense` 支出语义 | `#D66A60` | 低饱和 coral（财务） |
| `shadow` | `0 1px 2px rgba(15,15,15,0.04)` | 近平 |

### 深色（DARK）
| 角色 | 值 |
|------|-----|
| `bg` | `#191919` |
| `surface`/`surfaceContainer` | `#202020` / `#252525` |
| `text`/`primary` | `#FFFFFF` |
| `t2` | `rgba(255,255,255,0.62)` |
| `t3` | `rgba(255,255,255,0.40)` |
| `divider` | `rgba(255,255,255,0.09)` |
| `outline` | `#3A3A3A` |
| `primaryContainer` | `rgba(255,255,255,0.08)` |
| `accent` | `#529CCA` |
| `income` | `#5FCAB9` |
| `expense` | `#EFA79D` |

---

## 二、通用合规规则（每条必达）

1. **无品牌绿**：任何主操作、图标、选中态都不得出现亮绿（旧 `theme.primary` 绿 `#5FB87A` 类）。图标应为中性 `primary` 色（浅色 `#37352F` / 深色 `#FFFFFF`）。
2. **无描边卡片**：卡片/磁贴仅以背景色（surface）区分层级，**不得有 1px `outline` 实线边框**，不得有掉落阴影（除近平 `shadow`）。
3. **分隔线极细**：列表分隔线为 hairline（`StyleSheet.hairlineWidth`），颜色 = `divider`，浅色下为极淡灰 `#EDEDEB`，**不得是 `#D3D1CB` 重描边**。
4. **输入框/文本域**：如有可见边，应为 hairline 宽度 + `divider` 色，错误态才变 `error` 红。
5. **Chip/胶囊选中态**：`sel` 时 = hairline 描边 + `primaryContainer` 半透明中性填充；未选中 = 无描边 + `surfaceContainer` 背景。
6. **FAB / 主按钮**：中性色（浅色近黑 `#37352F`、深色白），**不得有彩色辉光**（阴影色为中性，非品牌色）。
7. **强调蓝克制**：`accent` `#2383E2` 仅在链接 / 选中文本出现，不得大面积铺色。
8. **字体**：正文为 Inter（已内联 100–900），无系统回退观感。
9. **暗色模式分隔线可见**：`divider = rgba(255,255,255,0.09)` 需能在深背景上辨认（极淡但存在）。

---

## 三、逐屏截图清单（Pixel 46201FDAP007FD）

```bash
S=46201FDAP007FD
CAP(){ adb -s $S exec-out screencap -p > ~/Desktop/lwb_$1.png; }
adb -s $S shell am start -n com.luka.lifeworkbench/.MainActivity

CAP 01_home            # 今日：四宫格 + 余额卡
CAP 02_finance_overview# 财务-概览
CAP 03_finance_flow    # 财务-流水
CAP 04_finance_budget  # 财务-预算
CAP 05_plan            # 计划/待办
CAP 06_diary           # 记录/日记
CAP 07_me              # 我的
CAP 08_settings        # 设置
CAP 09_quickadd        # 速记/快捷添加
CAP 10_dark_home       # 切深色：今日
CAP 11_dark_finance    # 切深色：财务概览
```

> 切换深色：设置 → 主题 → 深色，或系统跟随。每张图命名对应，便于逐条比对。

---

## 四、每屏重点核对项

| 截图 | 重点检查 |
|------|----------|
| 01_home | 四宫格图标 = 中性 `#37352F`（非绿）；余额卡扁平无框；次级文字 `#787774` |
| 02_finance_overview | 卡片无描边；Tab 选中态为中性半透明；收入/支出数字可保留 teal/coral 但低饱和 |
| 03_finance_flow | 列表分隔线 hairline + `divider`；无重描边 |
| 04_finance_budget | 进度条主色中性；无品牌绿 |
| 05_plan | 任务项分隔线极细；完成态用中性灰 |
| 06_diary | 卡片扁平；心情/标签色克制 |
| 07_me | 身份头部填充 = `primaryContainer` 半透明中性；NavRow 分隔极细 |
| 08_settings | 列表项无描边卡片；开关中性 |
| 09_quickadd | 输入框 hairline + `divider`；Chip 选中态中性 |
| 10/11_dark | 分隔线在深底可见；图标白色；无彩色辉光 |

---

## 五、判定口径

- ✅ 通过：符合上述全部规则，无品牌绿、无描边、分隔极细、阴影近平。
- ⚠️ 需修：某项偏离但非阻断（如某分隔线偏重），列出具体位置 + 建议改法。
- ❌ 不通过：出现品牌绿 / 实线描边卡片 / 彩色辉光 / 强调蓝滥用，给出精确文件 + 行号修复建议。

> 收到截图后，我会逐图贴出像素色值比对（如有需要会用取色核对），并产出一份 `NOTION_VERIFY_RESULT.md` 汇总通过/待修/不通过三项。
