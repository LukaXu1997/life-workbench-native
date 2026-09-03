# 更新记录

本文件记录「生活工作台」原生安卓版（life-workbench-native）的版本变更。

- 版本格式：`V主版本.次版本.修订版本`
- `versionCode = 主 × 10000 + 次 × 100 + 修订`（每次发布必须严格递增，不可重复或降低）
- 界面显示统一使用大写 `V`（如 `V1.0.0`）；Android `versionName` 不带 `V`（如 `1.0.0`）
- 包名固定为 `com.luka.lifeworkbench`，不可更改（否则系统视为另一个 App）
- 历史本地数据与 Supabase 云备份始终保持兼容，不破坏

---

## V3.0.1 — 2026-09-03
安全加固正式发布版（基于 V2.14.16 安全加固内容，SCHEMA_VERSION 仍为 2，无存储结构/导航/功能逻辑改动）：
- 版本号由 2.14.16 升为 3.0.1（versionCode 21416 → 30001），作为正式签名发布版
- 加密随机源 / 安全存储分级 / 安全迁移 / 云同步可恢复错误 / 12 项加密单测 + 安全门禁 / 两处缺陷修复 / Release 签名门禁 —— 内容与 V2.14.16 一致，仅版本号变更
- 纯安全/缺陷修复：未改动存储结构与 SCHEMA_VERSION

## V2.14.16 — 2026-09-03
安全加固 + 缺陷修复（SCHEMA_VERSION 仍为 2，无存储结构/导航/功能逻辑改动）：
- 加密随机源：src/crypto.ts 移除 AES-GCM salt/IV 的 Math.random() 回退，改为原生 CSPRNG（expo-crypto SecRandomCopyBytes / Android SecureRandom）→ Web Crypto → 缺失时抛 SecureRandomUnavailableError 使备份失败而非降级
- 安全存储分级：src/secure.ts 将 syncPass 标记为 STRICT（仅安全存储，不可用时抛 SecureStoreUnavailableError，绝不落 AsyncStorage）；sbKey 为非秘密可降级
- 安全迁移：store.ts migrateSecrets 改为「先确认安全写入成功（读回校验）再删旧明文」
- 云同步可恢复错误：cloud.ts 捕获 SecureRandomUnavailableError / SecureStoreUnavailableError 返回可恢复 CloudResult；i18n zh/en 新增对应提示
- 新增 12 项加密/安全单测 + security-check 静态门禁并接入 verify
- 缺陷修复：kit.tsx tabIndex 类型错误；notify ingest TnG 来源标签 com.tngdigital.wallet → "Touch 'n Go"
- 构建：android/app/build.gradle Release 缺正式签名参数时改为显式失败（不再静默回退 Debug 证书）
- 纯安全/缺陷修复：versionCode 21415 → 21416，未改动存储结构与 SCHEMA_VERSION

## V2.14.15 — 2026-09-03
CN/EN i18n 全量对齐收尾（SCHEMA_VERSION 仍为 2，纯本地化，无功能/逻辑改动）：
- 全树扫描 src，剥离注释后定位并修复 6 处真正绕过 t() 的硬编码用户可见中文：kit.tsx BottomSheet 的无障碍标签「关闭」、OnboardingWizard 自动建账户名、calc.ts 相对日期、store.ts 种子账户名 + 备份校验消息、cloud.ts 全套 Supabase 同步/备份/恢复消息（约 15 处）、PdfTextExtractor.ts 的 PDF 密码错误/加密/原生不可用
- zh.ts/en.ts 对称新增 date / seed / backup / cloud / pdf 五组共 36 个键（含 onboarding.defaultNameCny/Myr）
- 机制：非 React 模块（store/cloud/calc/PdfTextExtractor）通过 src/i18n/index.tsx 的模块级 `export const t` 直接 import 使用，随 I18nProvider 同步维护的 i18n.locale 变化
- 字典键对称检查 ZH=783 / EN=783，零缺失；历史遗留的「底部导航未本地化」问题早已修复（AppTabBar 用 t(def.labelKey)），本次确认不再是缺口
- 刻意保留不翻译项：'信用卡还款'、ShopPriority '高/中/低'、路由名 '财务'/'计划'、AppTabBar.name/labelKey（持久化数据/内部标识，本地化会破坏存储兼容与导航）
- 已构建 APK 并装机验证：tsc 零新增错误、assembleRelease BUILD SUCCESSFUL、Pixel 启动无 FATAL/crash
- 纯本地化：versionCode 21414 → 21415，未改动存储结构与 SCHEMA_VERSION

## V2.14.14 — 2026-09-03
Notion 风格二次精修收口（计划屏待确认列表，SCHEMA_VERSION 仍为 2，纯前端视觉）：
- 用户重发「其余屏（计划/任务/日记/我的子页）二次精修」指令，本次逐屏读源码复核四屏真实状态：任务屏浮条已在 V2.14.12 收敛；日记屏 / 我的屏 + 子页统一采用 kit 的 ListGroup/NavRow/Switch/TextField + token，已对齐；唯一真实偏差在 **计划屏「待确认交易」列表（PendingScreen）**：
  - 列表容器 Surface 硬编码 `borderRadius:16` → 改用 token `radius.card`（12），圆角与全站卡片节奏一致
  - 滚动容器 `padding:16` 硬编码 → 改用 `pageMargin` token，消除魔法数
  - **双分隔线**：ui.tsx 的 `ListRow` 自身已带 hairline 底边，外层又手动加 `height:1` 分隔线，造成视觉双线；移除外层冗余分隔线，仅保留 `ListRow` 单层 hairline
- 注：V2.14.12 的「其余三屏已近扁平、本次不动」结论当时仅覆盖任务屏浮条；计划屏的上述三处偏差属当时扫描遗漏，本次补修
- 纯展示层：仅动 PendingScreen 容器/分隔线 style 与 token 引用，未碰逻辑 / 存储 / SCHEMA_VERSION；versionCode 21413 → 21414

## V2.14.13 — 2026-09-03
收口：关闭实时捕获自检诊断日志（DIAGNOSE=false），出干净正式版：
- TxnCaptureService.kt 的 DIAGNOSE 由 true 置 false，仅静音诊断 Log.d（包名 + 布尔匹配旗标 + 屏幕长度，不含屏幕文字与金额）；实时捕获逻辑与门控完全不变、可逆（改回一行即可恢复自检）
- 此前保留 DIAGNOSE=true 供用户自验拼多多付款成功页捕获（success=true + CAPTURED）；确认行为稳定后出干净版
- 纯日志开关，未碰逻辑 / 存储 / SCHEMA_VERSION；versionCode 21412 → 21413

## V2.14.12 — 2026-09-03
Notion 风格二次精修（任务屏批量操作浮条双层深度收敛，SCHEMA_VERSION 仍为 2，纯前端视觉）：
- 任务屏多选「批量操作」浮条此前同时使用边框（borderWidth + outlineVariant）与强阴影（shadowOpacity 0.14 / shadowRadius 14 / elevation 6），违反 §十「边框+底色+阴影不同时用」的克制原则，且 elevation 高于全站其它浮层（token 最高 3 级 = elevation 4）
- 收敛为单层软阴影：删边框、shadowOpacity 0.08 / shadowRadius 10 / shadowOffset height 3 / elevation 4（token 3 级），保留 surface 底色与 radius.xl 浮条形态，与全站浮层深度一致
- 其余三屏（计划/日记/我的+子页）经扫描已基于 kit 且近扁平，本次不动，零回归风险
- 纯展示层：仅动 TasksScreen 浮条 style，未碰逻辑 / 存储 / SCHEMA_VERSION；versionCode 21411 → 21412

## V2.14.11 — 2026-09-03
Notion 风格 UI/UX 打磨续（剩余金额数字字重收敛，SCHEMA_VERSION 仍为 2，纯前端视觉）：
- 枚举全站 Amount 用法，收敛最后 3 处默认 600 的数据数字 → 500，与已收敛的 hero/子数字层级一致：
  - 首页「即将到期」信用卡应还金额（titleMedium）
  - 财务概览「本月收支」结余净额与次级净额（titleMedium ×2）
- 自此全站金额数字字重统一为 500（hero 与子数字同级）、并带负字距（V2.14.10），层级与观感完全齐整
- 纯展示层，未碰逻辑 / 存储 / SCHEMA_VERSION；versionCode 21410 → 21411

## V2.14.10 — 2026-09-03
Notion 风格 UI/UX 打磨续（大数字负字距，SCHEMA_VERSION 仍为 2，纯前端视觉）：
- 大金额数字此前只靠 tabular-nums 等宽、未收紧字距，而周围标题（V2.14.7 起）已带负字距，导致 hero/金额数字比标签更松、层级观感不齐
- 在共享金额组件 AnimatedBalance（anim.tsx）与 AutoFitAmount（ui.tsx）按字号比例加 letterSpacing（−fontSize×0.015，约 −0.015em），与 M3Text 标题负字距同源——首页结余 / 财务净资产 / MiniStat / 本月收支等所有金额数字现在与标签观感一致
- 纯展示层：仅动金额组件 style，未碰任何逻辑 / 存储 / SCHEMA_VERSION；versionCode 21409 → 21410

## V2.14.9 — 2026-09-03
Notion 风格 UI/UX 打磨续（hero/子数字字重层级收敛，SCHEMA_VERSION 仍为 2，纯前端视觉）：
- 首页「本月收入/支出」MoneyColumn 子数字（Amount 默认 600）收为 500，不再重于本月结余 hero（已 500），修正「子数字比主数字更粗」的层级倒置
- 财务概览 MiniStat（负债/本月收支等，titleLarge 默认 600）收为 500，与净资产 hero（V2.14.8 已 500）层级一致；影响财务页所有 MiniStat 用法，统一生效
- 全局负字距 + tabular-nums 不变；纯增量 versionCode 21408 → 21409，未改动存储结构与 SCHEMA_VERSION

## V2.14.8 — 2026-09-03
Notion 风格 UI/UX 打磨续（财务页 hero 字重收敛，SCHEMA_VERSION 仍为 2，纯前端视觉）：
- 财务概览「净资产」大数字（displaySmall）字重 600 → 500，与首页本月结余 hero（V2.14.7 已收 600→500）保持一致，跨页 hero 视觉权重统一、更贴 Notion 的轻量大数字
- 全局标题负字距（V2.14.7 已落地）同步作用于财务页所有 title/display 角色，无需额外改动
- 纯增量：versionCode 21407 → 21408，未改动存储结构与 SCHEMA_VERSION

## V2.14.7 — 2026-09-03
Notion 风格 UI/UX 进一步打磨（系统排版 + 首页，SCHEMA_VERSION 仍为 2，纯前端视觉）：
- 大标题负字距：displaySmall(−0.5) / headlineMedium(−0.3) / titleLarge(−0.2) / titleMedium(−0.1) 收紧字偶间距，typography.ts 新增 letterSpacing 字段、M3Text 全局应用——全站标题更克制紧凑，是 Notion / Apple 中性观感的招牌细节
- 首页余额 hero 字重收敛：本月结余主数字 600 → 500、副币种 500 → 400，弱化「数字喧宾夺主」，层级更靠近 Notion 的轻量标题（tabular-nums 等宽不变，数字切换不跳动）
- 首页四宫格扁平化：快捷入口由 surface 填充块改为透明 borderless 图标+文字网格（等宽 flex:1 / 24dp 图标 / 14sp 标题 / 按压态不变），更贴 Notion 的留白网格
- 纯增量：versionCode 21406 → 21407，未改动存储结构与 SCHEMA_VERSION

## V2.14.6 — 2026-09-02
界面打磨三处（SCHEMA_VERSION 仍为 2，纯前端 UI）：
- 数据与安全：移除「生物识别诊断」区块（硬件 / 支持类型 / 是否已录入 / 安全等级 / 最后错误码），页面更克制专业；应用锁开关与「不可用原因」提示保留
- 用户名同步：今日页问候语不再写死 "Luka"，改为读取「我的」页可编辑的用户名（store.getProfileName）；store 新增 onProfileNameChange 订阅，「我的」改名后今日页实时刷新「晚上好，{用户名}」
- 识别来源 App：删除重复的旧包名选项 —— Grab 的 com.grabtaxi（误写，正确为 com.grabtaxi.passenger）、TnG 的 com.tngdigital.wallet（误写，正确为 my.com.tngdigital.ewallet）；保留官方包名，避免同一 App 出现两个来源选项
- 纯增量：versionCode 21405 → 21406，未改动存储结构与 SCHEMA_VERSION

## V2.14.5 — 2026-09-02
拓展电子钱包付款实时捕获至国内 App 拼多多（SCHEMA_VERSION 仍为 2）：
- 包名确认：拼多多真实包名为 com.xunmeng.pinduoduo（小米应用商店 / 当快 / 西西 / techylist 多源一致，厂商「上海寻梦信息技术有限公司」）
- 原生金额检测补 CNY：TxnCaptureService 原仅识别 RM，现新增 ¥/￥ 与「元」正则，识别「任意金额 + 成功关键词」即捕获；拼多多付款成功页为 ¥xx.xx +「支付成功」，可正确命中
- 捕获包名白名单重命名：EWALLET_CAPTURE_PACKAGES → TXN_CAPTURE_PACKAGES（现混合 MYR 电子钱包 + 国内 CNY App，原名不准），并加入 com.xunmeng.pinduoduo；parsers.ts 的 CNY_APP 集合、ingest.ts 的 APP_LABELS（拼多多）同步接入，CNY 解析器此前已就绪
- 设置页文案泛化：tngCaptureHint（CN/EN）补充拼多多等国内电商、支持 ¥ 金额
- 纯增量：versionCode 21404 → 21405，未改动存储结构与 SCHEMA_VERSION

## V2.14.4 — 2026-09-02
电子钱包捕获包名全量修正 + 拓展为整套电子钱包（SCHEMA_VERSION 仍为 2）：
- 在 Pixel 真机核对已安装支付 App 真实包名：TNG=`my.com.tngdigital.ewallet`、Grab=`com.grabtaxi.passenger`（原误写 `com.grabtaxi`）、Shopee=`com.shopee.my`、Lazada=`com.lazada.android`
- 新增 Lazada 到 EWALLET 识别集合、APP_LABELS、无障碍捕获门控白名单；开启「电子钱包付款实时捕获」开关后，把 TnG / Grab / Shopee / Lazada / Boost / MAE / BigPay 全套包名推给原生门控，任一钱包付款成功页均可被读屏捕获
- 设置页与 i18n（CN/EN）文案由「TnG 付款实时捕获」泛化为「电子钱包付款实时捕获」
- 纯增量：versionCode 21403 → 21404，未改动存储结构与 SCHEMA_VERSION

## V2.14.3 — 2026-09-02
TnG 捕获包名修正（根因修复，SCHEMA_VERSION 仍为 2）：
- 根因：真机 TnG eWallet 包名为 `my.com.tngdigital.ewallet`，而捕获白名单/识别器/标签三处都只写了 `com.tngdigital.wallet`，导致无障碍门控 `isCaptureAllowed` 永远 false，且即使读到屏也无法识别为 TnG 交易
- 修正：parsers.ts `EWALLET` 集合、pendingStore 的 `captureAllowlist`/`captureEnabled` 判定、NotifySettingsTab 开启时写入的白名单、ingest.ts 标签映射，四处均补入 `my.com.tngdigital.ewallet`（保留 `com.tngdigital.wallet` 兼容旧变体 / 测试用例）
- 纯增量：versionCode 21402 → 21403，未改动存储结构与 SCHEMA_VERSION

## V2.14.2 — 2026-09-02
TnG 捕获诊断 + WebView 容错（debug 版，SCHEMA_VERSION 仍为 2）：
- TxnCaptureService 新增隐私安全诊断日志（仅记包名 + 匹配布尔 rm/success + 屏长，绝不记屏内容/金额）：真机 `adb logcat -s TxnCapture` 可定位「包名未 allow / 读不到屏 / 未匹配 RM / 未匹配 success」卡在哪一步。
- `rootInActiveWindow` 增加一次 `refresh()` 重试：应对 WebView/H5 付款成功页在窗口事件触发瞬间节点尚未挂载、首次遍历为空。
- `DIAGNOSE=true` 为调试开关，定位稳定后正式版置 false。
- 纯增量：versionCode 21401 → 21402，未改动存储结构与 SCHEMA_VERSION。

## V2.14.1 — 2026-09-02
无障碍授权状态误判修复 + 权限精简：

- 修复「TnG 付款实时捕获」无障碍权限已在系统开启、App 内仍显示「需要授权」：原生 `isTxnCaptureEnabled` 此前用 `ComponentName.flattenToString()` 与 `AccessibilityServiceInfo.id` 做字符串相等比较，两者在 Android 上形式不一致（长式 `pkg/pkg.ClassName` vs 短式 `pkg/.ClassName`）导致误判；改为基于 `ComponentName` 的可靠比对（读 `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` + `AccessibilityManager` 双路兜底）
- 权限精简：移除冗余的 `USE_EXACT_ALARM` 与 `READ_MEDIA_IMAGES`；保留 `INTERNET` / `VIBRATE` / `SCHEDULE_EXACT_ALARM` / `USE_BIOMETRIC`

## V2.14.0 — 2026-09-02
TnG 付款实时捕获（无障碍为主 + OCR 截图兜底，复用既有「待确认→确认」记账管线；SCHEMA_VERSION 仍为 2）：

- 根因：Touch 'n Go 付款成功不推送任何系统通知，既有通知监听管线（NotificationListenerService）永远收不到 TnG 交易，无法「付款后立即统计支出」
- 方案（混合，无障碍为主 + OCR 兜底）：新增 `TxnCaptureService`（AccessibilityService），仅在已开启且勾选的 App（默认 Touch 'n Go）上读取付款成功页「文字节点」（Berjaya/支付成功 + RM xx.xx），生成与通知同构的 `NotifyEnvelope`（source="accessibility"）；兜底路线为分享 TnG 截图，由 ML Kit 本地 OCR（`com.google.mlkit:text-recognition:16.0.1`，纯端侧、无网络）识别后同样生成信封（source="ocr"）
- 两条路线都复用 `NotifyBridge.emit` + 同一持久队列 + `parseEnvelope`/`recognize`/`dedup`/`ingestEnvelope` → 待确认列表 → 确认入账，零重复解析/去重逻辑；不自动入账、不发裸通知
- 隐私边界（显式、有意）：仅读文字节点，不截图、不读剪贴板、不上传；仅对你勾选的 App 生效；屏幕/截图文本只写入 App 私有临时队列（JS 入账后即清空），不持久化原始文本
- 设置页新增「TnG 付款实时捕获」独立开关：开启时自动把 `com.tngdigital.wallet` 加入识别来源，并显示无障碍权限授予状态与「前往系统设置授予」跳转；与既有「通知识别」开关相互独立（互不 pause）
- 启动即下发配置：App 冷启动也会把捕获配置推到原生，无障碍服务在授权后、App 至少运行一次后即常驻生效
- 全量 CN/EN i18n：tngCapture / tngCaptureHint / tngCaptureOn / tngCaptureOff / tngCaptureOpenSettings / tngCaptureManualHint 共 6 条
- 纯增量：未改动任何存储结构与写入规则，未动 SCHEMA_VERSION（仍为 2），零破坏性变更

## V2.13.4 — 2026-09-02
修复「待办闹钟不响铃」与「待办建好不能改」两类问题（不动存储结构与 SCHEMA_VERSION，仍为 2）：

- 闹钟不响铃：根因是通知渠道在 V2.13.0 创建时未设 sound，Android 一旦创建即永久静音、且不可改。本次将渠道 ID 升级为 task-reminders-v2 / habit-reminders-v2 强制重建，补上 sound: 'default' + audioAttributes.usage=ALARM（像闹钟一样响），前台 handler 的 shouldPlaySound 改为 true，通知内容也显式带 sound
- 待办不能改：此前项目里根本没有「编辑任务」入口——TaskRow 只能勾选/删除/长按多选。本次新增「点击任务行主体即打开预填编辑表单」（复用新增表单），保存时原地更新任务（保留 id / createdAt / completed / note / subtasks），并先取消旧提醒再按新值重排程
- 编辑交互：待办分栏与日历分栏的任务行均支持点击进入编辑；勾选圈、删除、子任务展开按钮不触发编辑
- 全量 CN/EN i18n：新增 editSchedule / editA11y 两条

## V2.13.3 — 2026-09-02
本地任务提醒通知内容优化（纯展示层，不改逻辑与 SCHEMA_VERSION）：

- 标题改为「提醒：{任务名}」（如 提醒：会议 / Reminder: Meeting），一眼看清是哪条任务，不再显示空标题占位
- 正文改为「{任务时间} · {提前量}」（如 16:30 · 准时 / 16:30 · 30分钟前），到点前多久、任务几点一目了然
- 仅改通知文案结构与两条新增 i18n 文案（reminderTitle / reminderTimeLead），未改动调度/存储/SCHEMA_VERSION（仍为 2）

## V2.13.2 — 2026-09-02
修复 Android 12+ 本地提醒到点不弹（精确闹钟权限缺失）：

- 根因：APK 未声明 SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM，expo-notifications 底层 setExact 被系统降级为非精确触发，闹钟虽登记但不准时弹出（实测 Android 15 / SDK 37）
- 修复：app.json android.permissions 新增 android.permission.SCHEDULE_EXACT_ALARM 与 android.permission.USE_EXACT_ALARM（USE_EXACT_ALARM 声明即由系统自动授权，最适合提醒类应用）
- 通知权限 POST_NOTIFICATIONS、双渠道 task/habit、DND 状态经真机核实均正常，问题仅出在精确闹钟权限缺失
- 纯权限声明修复，未改动 TS 逻辑、存储结构与 SCHEMA_VERSION（仍为 2）

## V2.13.1 — 2026-09-02

提醒提前量选择器改为内联下拉（纯 UI 打磨，不改逻辑与 SCHEMA_VERSION）：

- 任务表单「提醒提前量」由 7 个换行 chip 改为与「日期/时间」同款的单行可点击字段，点按就地展开内联下拉面板（准时/15分钟前/30分钟前/1小时前/2小时前/3小时前/1天前），选中后收起
- 视觉收敛：消除 chip 占用多行导致的表单纵向膨胀，与日期/时间字段风格统一（少边框、留白充足）
- 新增 chevronUp 图标（MaterialCommunityIcons），下拉开合箭头方向正确

## V2.13.0 — 2026-09-02

提醒升级：相对提前量 + 习惯每日提醒（功能小版本，复用 expo-notifications，SCHEMA_VERSION 仍为 2）：

- 任务提醒改为「相对提前量」：开启后从 准时 / 15分钟前 / 30分钟前 / 1小时前 / 2小时前 / 3小时前 / 1天前 中选择，实际提醒时刻 = 任务时间 − 提前量（运行时计算）
- 重复任务零成本顺延：存的是提前分钟数而非绝对时刻，下一笔实例用自己的日期/时间自动重算，无需手动顺延逻辑
- 无时间任务自动 09:00：开启提醒但任务没有时间时，时间默认填 09:00（仍可改）
- 习惯新增「每天几点提醒」：新建习惯（HabitForm）与习惯详情（HabitDetailScreen）均可设置/修改/关闭每日提醒，走独立 habit-reminders 渠道
- 双通知渠道：task-reminders（任务，蓝）/ habit-reminders（习惯，绿），均 Android 8+ 渠道，可单独管理
- 完成即取消：任务完成 / 删除 / 批量完成时自动取消本地提醒，撤销恢复对应提醒；习惯提醒随开关实时增删
- 点击跳转：点按 task-* / habit-* 通知均跳转「计划」tab
- 权限友好：开启提醒时按需请求 POST_NOTIFICATIONS 权限，被拒则提示并放弃该提醒（数据仍保留）
- 全量 CN/EN i18n：reminder / reminderLead / lead0~lead1440 / reminderTime / reminderHint / reminderPast / reminderPermissionDenied / reminderScheduled / reminderAt / habitReminder / habitReminderHint / habitReminderBody 共 16 条
- 纯可选字段：Task.reminder 改为可选 number（提前分钟数，空=不提醒），Habit.reminderTime 为可选 string（'HH:MM'，空=不提醒），旧数据仍正常（向后兼容），SCHEMA_VERSION 仍为 2

## V2.11.0 — 2026-08-30

任务批量操作（功能小版本，零新增依赖）：

- 待办多选模式：待办页新增「选择」入口，点按进入多选；勾选圈由圆形切换为方形（checkbox 语义），整行可点选中，选中行高亮
- 全选 / 取消全选：批量操作栏一键选中 / 取消全部可见待办
- 批量完成：一键将选中任务标记为完成，任务从待办移除，底部 Snackbar「已完成 N 项」并支持撤销
- 批量删除：一键删除选中任务，弹窗二次确认「确定删除选中的 N 项？」，删除后 Snackbar「已删除 N 项」支持撤销
- 批量加标签：为选中任务批量添加标签，复用标签编辑器（chip 展示 + 输入回车添加）+ 新建标签入口，写入后 Snackbar「已为 N 项添加标签」
- 选中 0 项时三个操作按钮禁用，并提示「请先选择任务」
- 全量 CN / EN i18n：`selectMode` / `exitSelect` / `selectAll` / `deselectAll` / `selectedCount` / `batchComplete` / `batchDelete` / `batchTag` / `batchTagTitle` / `confirmBatchDelete` / `batchDeleteHint` / `batchCompleted` / `batchDeleted` / `batchTagged` / `cancelSelect` / `batchEmpty` / `newTag` / `selectTaskA11y` 共 18 条
- 纯展示层 + 派生字段：未改动任何存储结构与写入规则，`SCHEMA_VERSION` 仍为 2，零新增依赖

---

## V2.10.0 — 2026-08-30

任务标签与标签筛选（功能小版本，零新增依赖）：

- 任务支持标签（`tags`）：每个任务可挂任意数量标签，复用计划页新增标签编辑器（chip 展示 + 输入回车添加 + 单标签删除），创建时一并写入
- 标签筛选：待办 / 日历新增「标签」筛选条，按全部任务聚合出的标签横向滚动展示，点按某标签即仅显示带该标签的任务；「全部标签」一键清除筛选
- 待办三分组（逾期 / 今天 / 即将到来）与日历日详情均受标签筛选约束，分组语义不变
- 搜索 + 标签筛选可叠加生效：两者同时输入时结果取交集
- 任务行（`TaskRow`）新增标签展示：带标签的任务在标题下以 `#标签` 小药丸呈现，一眼可辨归类
- 空结果提示：搜索 / 筛选无匹配时显示「没有匹配的任务」及换关键词提示，替代原空状态
- 全量 CN / EN i18n：`tags` / `addTag` / `tagPlaceholder` / `noTags` / `filterByTag` / `allTags` / `tagAdded` / `deleteTagA11y` 共 8 条
- 纯数据扩展：`Task.tags` 为可选字段（`string[]`），旧数据无该字段仍正常（向后兼容），`SCHEMA_VERSION` 仍为 2

---

## V2.9.0 — 2026-08-30

任务搜索与智能排序（功能小版本，零新增依赖）：

- 待办 / 日历新增搜索框：按标题与备注实时过滤（不区分大小写），跨分栏共享同一搜索词，切换待办 ↔ 日历时搜索保持同步
- 智能排序：新增排序切换，支持 优先级 / 截止日期 / 创建时间 / 标题 四档；默认按截止日期（与原分组顺序一致）
- 待办排序在「逾期 / 今天 / 即将到来」各分组内分别生效，分组语义（逾期优先）保持不变
- 日历日详情按所选排序呈现当天任务（含已完成）；搜索时仅过滤当天任务，月历圆点不受影响
- 空结果提示：搜索无匹配时显示「没有匹配的任务」及换关键词提示，替代原空状态
- 全量 CN / EN i18n：`search` / `searchPlaceholder` / `sortBy` / `sortPriority` / `sortDate` / `sortCreated` / `sortAlpha` / `noResults` 共 8 条
- 纯展示层 + 派生字段：未改动任何存储结构与写入规则，`SCHEMA_VERSION` 仍为 2

---

## V2.8.0 — 2026-08-30

重复任务（Recurring Tasks，零新增依赖）：

- Task 新增可选 `repeat` 字段（`RepeatFrequency`：`none` / `daily` / `weekly` / `monthly` / `yearly`），向后兼容，旧数据无此字段仍正常
- 任务表单新增「重复」分段控件（不重复 / 每天 / 每周 / 每月 / 每年），创建时可设定重复频率
- `TaskRow` 新增重复徽章：有 `repeat` 的任务行末显示频率缩写（`D` / `W` / `M` / `Y`）底色标识
- **完成时自动生成下一笔**：勾选完成的重复任务自动按频率偏移日期创建新任务（保留标题 / 优先级 / 分类 / 备注 / 子任务）
- **启动补生成**：App 冷启动时扫描已完成的重复任务，对过期的自动补生成下一笔（最多向前查 20 笔，去重防重复）
- 撤销支持：自动生成的下一笔可通过 Snackbar 撤销单独移除（不影响原任务完成态）
- 全量 CN / EN i18n：`repeat` / `repeatNone` / `repeatDaily` / `repeatWeekly` / `repeatMonthly` / `repeatYearly` / `generatedNextRecurring` 共 8 条
- 纯数据扩展：`repeat` 为可选字段，未改动 `SCHEMA_VERSION`（仍为 2）

---

## V2.7.0 — 2026-08-30

任务子任务（功能小版本，零新增依赖）：

- 任务支持子任务（SubTask）：每个 Task 可挂载任意数量子项，复用现有 48dp 勾选圈（CheckCircle，新增 `size` 可选，子任务用 32dp）
- 勾选行（TaskRow）新增「子任务进度」展示：有子任务时显示 已完成/总数（如 `2/5`）并附 chevron 折叠/展开按钮；展开后内嵌子任务列表
- 子任务列表（SubTaskList）：每项 32dp 勾选圈 + 标题 + 删除按钮；行末「+」行内嵌 `TextInput` 添加子任务（自动聚焦，回车提交，失焦空输入取消）
- 子任务经 `store.setTasks` 写入，复用 `useData` 的 `onChange` 自动刷新，无需手动同步状态
- 父子解耦：父任务完成态独立，子任务勾选不级联父任务（明确设计取舍，避免误标完成）
- 同时覆盖 TodoSub（待办）与 CalendarSub（日历日详情）两个入口，共享 TaskRow，体验一致
- 全量 CN/EN i18n：subtasks / subtaskProgress / addSubtask / 增删提示等 9 条文案
- 纯数据扩展：Task.subtasks 为可选字段，旧数据无该字段仍正常（向后兼容），未改动 SCHEMA_VERSION（仍为 2）

---

## V2.6.5 — 2026-09-02

深色模式原生层精修（纯视觉/原生资源层，不动逻辑与 SCHEMA_VERSION）：

- 新增 `values-night/colors.xml`：`splashscreen_background` → `#191919`（对齐 `theme.bg` 深色），消除深色模式下 App 启动时的**白屏闪**
- `iconBackground` 夜间覆盖为 `#191919`：修复深色桌面下 launcher 图标背景白块
- `colorPrimaryDark` 夜间覆盖为 `#191919`：避免深色下系统 tint 遗留白色闪烁
- **实证截图 QA**：设备切系统深色 → 截取 Home 屏 → JS 主题层零泄漏、对比度充足、tonal elevation 正确、语义色清晰
- `tokens.ts` 阴影在深色下已不可见（符合 Apple/Notion 原则），未做降级重构

---

## V2.6.4 — 2026-08-30

日记页视觉一致性打磨 + 我的/设置子页审查（纯视觉，未改动 SCHEMA_VERSION）：

- 速记勾选控件统一为与 Plan/Home 一致的 48dp 实心勾选圈（CheckCircle）：完成=primaryContainer 实心+check，未完成=surfaceContainer+描边，消除此前 18dp 绿色描边 IconTile 的第三种不一致样式
- 日记条目卡片对齐 Card 基线：内距 16 / 卡间距 cardGap / 圆角 radius.card，与全站卡片节奏一致（原 padding:14 / marginBottom:10 / radius.lg）
- 段控容器外距 hardcoded 16 改为 pageMargin token
- 我的/设置 7 个子页（外观/语言/数据与安全/通知/币种汇率/关于/二级骨架）经逐一审查，已统一采用 SubPage+ListGroup+NavRow 的 Notion 式结构，无不一致，本次未改动
- 纯展示层改动：未新增存储、未改写入规则、不动 SCHEMA_VERSION（仍为 2）

## V2.6.3 — 2026-08-30

Home 勾选控件跨屏统一（视觉一致性，未改动 SCHEMA_VERSION）：

- 将 Home「今日计划」的 24dp 描边勾选 icon 替换为与 Plan 模块（V2.6.1）一致的 48dp 实心勾选圈（CheckCircle）：完成=primaryContainer 实心+check，未完成=surfaceContainer+描边
- 消除 Home 与 Plan 勾选控件尺寸/风格不一致；Home 四宫格、底部导航、Home 余额等宽数字此前已符合规格，本次未改动
- 纯展示层改动：未新增存储、未改写入规则、不动 SCHEMA_VERSION（仍为 2）

## V2.6.2 — 2026-08-30

财务 dashboard 细化（视觉/UX 打磨，未改动 SCHEMA_VERSION）：

- 新增统一「洞察条」InsightRow：左中性灰 caption + 右 tabular 值，纵向等距；储蓄率 / 环比上月 / 预算日均可用 三处派生指标统一呈现，消除窄屏 inline 断行参差
- 配色收敛（少配色）：储蓄率、日均可用改为中性；仅「环比」保留方向语义（▲绿/▼红），净资产为负、预算超支、余额为负等真告警保留红
- 间距节奏统一：卡内洞察条间距与 hairline 上下留白收口一致
- 本月收支卡内「储蓄率/环比」作为本月区收尾洞察，与「固定」子区之间以 hairline 分层
- 纯展示层改动：未新增存储、未改写入规则、不动 SCHEMA_VERSION（仍为 2）

## V2.6.1 — 2026-08-30

计划页分段重构 + Notion 风格打磨（功能小版本，未改动 SCHEMA_VERSION）：

- 计划页分段由 5 档收敛为 4 档，顺序固定为：日历 / 待办 / 待买 / 习惯；「日历」置顶并作为默认落地页
- 合并「今日」小模块：选中日期为「今天」时，日历详情区同时展示当日任务与「今日习惯」列表，不再单列 today 档
- 四档行式统一为 [48dp 勾选圈] + [标题/副信息] + [删除] 的 Notion 式克制行，抵消原先占用一行/两行参差的问题
- 分段标题统一中性灰（onSurfaceVariant），并新增日历网格与当日明细之间的极细分隔线，层级节奏一致
- 纯展示层改动：直接复用 Task[] / Habit[]，不新增存储、不改写入规则、不动 SCHEMA_VERSION（仍为 2）

## V2.6.0 — 2026-08-30

计划页新增「日历 / 月视图」（功能小版本，未改动 SCHEMA_VERSION）：

- 计划页新增第 5 档「日历」：以月视图集中浏览当月所有日程，一眼看清哪些天有安排
- 月历以周日为起始（日一二三四五六），有任务的日期下方显示主色圆点；今天高亮主色数字，选中日以主色容器底色标示
- 支持上 / 下月切换（chevron 按钮），跨月浏览历史与未来安排
- 点选任意日期，下方列出当日任务并复用现有 TaskRow（含勾选 / 删除 / 撤销），空日显示空状态
- 纯展示层：直接复用 Task[]，不新增存储、不改写入规则、不动 SCHEMA_VERSION（仍为 2）

## V2.5.0 — 2026-09-02

财务 dashboard 完善（功能小版本，未改动 SCHEMA_VERSION）：

- 本月收支结余新增「储蓄率」：本月 (收入−支出)/收入，一眼看清这个月存下多少
- 本月收支结余新增「环比上月」：与上月净结余对比，▲/▼ 百分比（绿涨红跌），纯派生无存储改动
- 预算使用新增「日均可用」：当前月剩余天数 + 日均可花费（剩余预算 ÷ 剩余天数），仅查看当月时显示
- 支出趋势 Top5 分类进度条补「占比 %」：各分类占当月同类币种支出比例
- 全部为纯派生指标：不新增存储、不改任何写入规则

## V2.4.1 — 2026-09-02

夜间模式修复（bug fix，未改动 SCHEMA_VERSION）：

- 新增「定时」外观模式：按本地时间 19:00–06:59 自动切换深色，跨过日/夜边界即时生效（分钟级刷新），不再依赖系统深色开关
- 默认外观改为「定时」：新装/未手动设置用户开箱即晚上自动进入夜间模式（旧「跟随系统」仅跟随系统深色，系统未开深色时夜晚不生效）
- 修正「选 light 反而是夜间」类反相问题：源码中 light→浅色、dark→深色、system→跟随系统 的映射本身正确，问题源于旧构建；本次重新构建交付，确保映射正确
- 外观设置与「我的」页当前模式文案同步支持「定时」

## V2.4.0 — 2026-09-01

生物识别进入 App + 防夜间闪白隐私遮罩（功能升级）：

- 新增「进入 App 时验证」：默认关闭，由用户主动开启；**开启与关闭前都必须先进行一次生物识别验证**，验证成功才保存为开启状态，杜绝误锁与跳过
- 新增「回到 App 时重新验证」：切到后台超过自动锁定时间后返回需再次验证（子项，仅在主锁开启时可用）
- 新增「自动锁定时间」：提供 立即 / 30 秒 / 1 分钟 / 5 分钟，默认 30 秒（即 App 进入后台超过 30 秒后重新验证）
- 新增「隐藏最近任务画面」：通过原生 `FLAG_SECURE`（`SecureWindowModule` / `SecureWindowPackage`）阻止系统最近任务缩略图与截图，防内容泄露；纯 JS 无法做到，已落地原生模块并通过 `src/secureWindow.ts` 桥接
- 新增「使用设备密码作为回退」：生物识别失败时可用锁屏密码代替
- 防夜间闪白隐私遮罩：冷启动 / 后台 / 恢复瞬间以不透明主题底色盖住内容，避免深色模式下白闪；`AppLoading` 底色同步为主题底色
- 设置键迁移：旧 `biometricLock` 自动迁移为「进入 App 时验证」初始值，升级后行为不变；**未改动 `SCHEMA_VERSION`**

## V2.3.4 — 2026-09-01

应用锁真实可用（修复 V2.3.3 诊断全为「否」）：

- **根因**：`src/biometric.ts` 与 `src/components/BiometricGate.tsx` 写成 `import LocalAuthentication from 'expo-local-authentication'`，但该包（16.0.5）的 `build/LocalAuthentication.js` **只有具名导出、没有 `export default`** → 运行时 `LocalAuthentication === undefined` → `hasHardwareAsync()` 抛 `TypeError` → 被诊断首个 `try/catch` 记为 `native_unavailable`。因此诊断区一律显示「否」，开关始终置灰
- 两处 import 改为命名空间导入 `import * as LocalAuthentication from 'expo-local-authentication'`，四项检测现在真正走到原生实现
- `getBiometricDiagnostics()` 新增运行时守卫：先校验 `typeof LocalAuthentication?.hasHardwareAsync === 'function'`，新增 `module_missing` 分类，将「JS 绑定缺失」与 `no_hardware` / `native_unavailable` 彻底区分
- `BiometricDiagnostics` 新增 `errorDetail`（原始错误 message），诊断区可直接看到底层原因
- 新增 CN/EN 文案 `settings.biometricReasonModuleMissing`
- 排查结论备忘：V2.3.3 APK 经 dex 描述符核验，`Lexpo/modules/localauthentication/LocalAuthenticationModule;` 已注册进 `ExpoModulesPackageList`，`Landroidx/biometric/BiometricPrompt;` 已打包，`USE_BIOMETRIC` / `USE_FINGERPRINT` 已声明——**原生层与权限全部正常，问题纯在 JS 层引用写法**

---

## V2.3.3 — 2026-09-01

生物识别设备判断修复（不再统一提示「未设置」）：

- 重写诊断链路：依次执行 `hasHardware` / `supportedAuthenticationTypes` / `isEnrolled` / `getEnrolledLevel` 四项非敏感检测，分别判定「无硬件 / 系统未提供可用类型 / 仅设备锁屏密码 / 弱人脸受限 / 模块不可用 / 调用异常」
- 认证失败后按具体错误码分别提示：用户取消 / 验证失败 / 临时锁定 / 未录入 / 第三方不可用 / 未设锁屏密码 / 调用异常，不再一律显示「当前设备暂未设置面容或指纹」
- 认证调用改用兼容配置：`biometricsSecurityLevel` 默认 `weak`（允许人脸 / 指纹 / 设备密码），不强制 `strong`，避免弱人脸被系统拒绝
- 设置页新增「生物识别诊断」区，仅展示设备能力（硬件 / 支持类型 / 是否已录入 / 安全等级 / 最后错误码），不记录任何生物识别数据
- 设置页新增「高安全验证」开关（仅强识别或设备密码），默认标准验证
- 权限确认：`USE_BIOMETRIC` / `USE_FINGERPRINT` 已在 Manifest 声明并随 APK 打包，生物识别非运行时授权，无需弹权限申请框

## V2.3.2 — 2026-09-01

应用锁（面容 / 指纹）：

- 新增「应用锁」开关（我的 → 数据与安全）：开启后每次打开应用、或离开超过 30 秒后回到前台时，需验证面容或指纹
- 全屏锁定页采用 Notion 式克制设计：大量留白、单一解锁按钮，进入即自动唤起系统生物识别；验证失败仅保持锁定，不弹刺眼报错
- 设备未录入任何生物识别时开关自动置灰并提示，不影响正常打开
- iOS 侧预置 `NSFaceIDUsageDescription`，Android 侧声明 `USE_BIOMETRIC` 权限

## V2.3.1 — 2026-09-01

待买清单支持马币（MYR）：

- 新增物品表单新增「币种」切换（RM / ¥），默认马币（MYR）
- 预估价格输入框前缀随币种联动显示 RM / ¥
- 列表项价格按各自币种显示（RM 0.00 / ¥ 0.00），不再统一硬编码人民币
- 合计按币种分组展示（如「待买 5 · RM 120.00 + ¥ 350.00」），不做汇率换算

## V2.0.0 — 2026-08-29

信息架构重构 + 克制动效。本次为大改版（导航结构变更，故升主版本号）。

**导航结构（§一 / §二）：**
- 底部第四档「设置」改为「我的」，图标由齿轮改为 `account-circle-outline`
- 导航重构为 `RootStack > MainTabs(TodayStack / PlanStack / FinanceStack / MeStack)`，四档各自独立嵌套堆栈
- 速记（Diary）、账单导入、待确认交易、确认交易改为二级页面，统一带返回箭头，安卓物理返回键层级正确
- 取消「隐藏 Tab」写法，二级页面不再顶掉底部栏

**「我的」页重做（§三 / §四）：**
- 由单一长表单改为分组列表入口页（资料头部 + 分组导航行，52dp 行高、线性图标、右侧 chevron）
- 原 `SettingsScreen` 拆分为 7 个子页：账户与信用卡、预算与汇率、账单导入、外观与语言、备份与同步、安全、关于
- 待确认交易数量以角标提示

**首页改为财务优先（§五）：**
- 顶部主卡以最大字号呈现「本月结余」，MYR / CNY 分列，`tabular-nums` 等宽对齐，移除字号自动压缩
- 新增快捷操作行（记一笔 / 新待办 / 打卡 / 收件箱），等宽不换行
- 新增「最近流水」5 条（虚拟列表），今日计划下移，「即将到期」仅在有内容时渲染
- 窄屏（<360dp）双币种改竖排

**财务页 5 档 → 3 等宽档（§六）：**
- 概览 / 流水 / 预算；账户、信用卡、支出趋势全部收进「概览」
- 概览顺序固定：总资产 → 本月收支 → 预算使用 → 账户 → 支出趋势
- 顶部切换改等宽胶囊 + 滑动指示条，移除 `flexWrap`
- 流水改 `FlatList`，筛选收进底部弹层；账单导入移到右上「更多」菜单，与「我的 → 账单导入」共用同一入口
- 去掉「每个数字各占一张卡片」的碎片化布局

**任务页 → 3 档（§七）：**
- 今天 / 待办 / 习惯；「待买」降级到右上「更多」菜单的底部弹层（数据与功能完整保留）
- 新增统一走底部弹层表单；勾选框 40dp → 48dp；删除 / 完成切换均带撤销 Snackbar
- 列表由 `ScrollView` 改为 `FlatList`

**动效（§八）：**
- 引入 `react-native-reanimated`，新增统一动效组件：按压反馈、列表进入、Tab 指示器、进度条、折叠展开、底部弹层
- 全部动效读取系统「减弱动态效果」开关，关闭后仅保留必要状态变化；无循环 / 弹跳 / 装饰性动画

**视觉规范（§九）：**
- 页边距 16dp、卡片间距 14dp、列表行 52–56dp、输入 52dp、卡片圆角 22dp、弹层顶部圆角 24dp、可点区域 ≥48×48
- 减少卡片数量，改用留白 + 细分隔线建立层级
- 新增 `useBottomContentInset` / `useSubPageBottomInset`，彻底解决内容被浮动底部栏遮挡

**数据兼容：** 无破坏性变更。账户 / 预算 / 交易 / 习惯 / 日记的数据结构与 Supabase 云备份完全兼容，备份恢复的预览 / 确认 / 撤销流程保持不变。

---

## V1.2.4 — 2026-08-29

统一组件库（kit）与多屏幕响应式打磨。

**修复：**
- 修复 StatusBar 在浅色 / 深色 / 跟随系统三种模式下偶发“全白不可读”的问题（依据当前主题动态设置 barStyle）
- 修复 TasksScreen 新建日程表单被 FAB 遮挡的问题

**组件库（src/components/kit.tsx）：**
- 新增 PrimaryButton（支持 fullWidth / loading / disabled）与 ConfirmDialog（统一确认弹窗）
- 新增 Card / ScreenHeader / ListItem / Chip / BottomSheet / IconButton / ActionTile / TextField / SectionHeader 等统一基础组件
- useColumns 响应式断点由 600dp 调整为 360dp：窄屏（<360dp）单列、宽屏双列

**屏幕迁移（仅内部组件替换，交互与信息结构不变）：**
- FinanceScreen / TasksScreen / SettingsScreen 迁移到 kit 组件，视觉风格统一为“内容优先”白卡片 + 弱边框 + 留白

**数据兼容：**
- 无破坏性变更，账户 / 预算 / 交易数据格式不变

---

## V1.2.3 — 2026-08-29

重新设计双币种月度预算卡片：突出“剩余预算”，优化财务分页与小屏幕响应式布局，修复 CNY/MYR 切换器溢出问题。

**新增 / 调整：**
- 月度预算卡片信息层级重排：标题 → 币种切换 → 本月剩余（卡片内最大字号）→ 进度条 → 已使用/百分比 → 总预算与调整入口
- 币种切换器响应式：窄屏（<430dp）标题与切换器上下分行、切换器占满 100% 且 CNY/RM 各 50%；宽屏可同行
- 预算进度条按使用率变色：<80% 主题色、≥80% 警告橙、≥100% 错误红；超过 100% 仅进度条封顶，文字显示真实百分比（如 125%）
- 财务顶部分页改为单行短名：概览 / 流水 / 预算 / 信用卡 / 趋势；英文或大字下自动横向滚动，不换行不压缩
- 月份选择器与预算卡片间距收紧至 16dp，左右箭头统一为 44×44 点击区，中文月份不再补零（2026年8月）
- 未设置预算时显示“本月尚未设置 CNY/MYR 预算”并提供“设置预算 ›”入口

**数据兼容：**
- MYR / CNY 预算仍各自独立保存，整数最小货币单位（sen/fen），不通过汇率混合
- 支付宝普通消费扣 CNY 预算、TNG 普通消费扣 MYR 预算；理财/充值/还款/转账/换汇本金不扣预算；退款冲减对应币种
- 跨币种信用卡：马来西亚消费 RM100 仅扣 MYR 预算，人民币信用卡负债增加 ¥168，支出只计一次

---

## V1.0.0 — 2026-08-28

首个采用统一版本管理规则的基线版本。

**新增：**
- 五模块工作台（今日 / 计划 / 财务 / 记录 / 设置）M3 设计语言重构完成
- 财务：概览 / 流水 / 预算 / 信用卡账期 / 趋势 五个标签
- 计划：待办（逾期 · 今天 · 即将到来 · 已完成）/ 习惯（含 28 天热力图）/ 待买 三视图
- 记录：日记 / 速记 / 收藏
- 设置：外观（系统 / 浅色 / 深色）、汇率、Supabase 加密云备份
- 关于页：显示版本（V1.0.0）、构建编号（Build 10000）、更新日期与「查看更新内容」

**改进：**
- 统一版本来源为 `src/version.ts`，避免多处硬编码漂移
- 建立本 `CHANGELOG.md` 更新记录规范

**修复：**
- （无，基线版本）

**数据兼容：**
- 与历史本地数据及 Supabase 云备份完全兼容，无需迁移
