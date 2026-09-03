// 产品化更新记录数据源（面向普通用户，中英文双语静态文案）。
//
// 设计约定：
//  · 版本号 / 发布日期 / 功能范围严格沿用历史发布事实，不删历史、不虚构功能。
//  · 文案为「预先写好的静态双语内容」，运行时按当前语言取用，不做机器翻译。
//  · 语言切换时 useI18n().resolved 变化会触发重新渲染，已打开的页面即时更新，无需重启。
//  · 不含开发术语（commit / schema / versionCode / Gradle / ProGuard / 迁移脚本 /
//    内部模块名 / 代码文件名），不暴露安全实现细节、密钥、签名、内部路径与调试信息。
//  · 本文件保持零 import，便于校验脚本直接转译加载。

export type ChangelogLang = 'zh' | 'en';

export type ChangelogCopy = {
  /** 一句话版本摘要 */
  title: string;
  /** 2–5 条用户可感知的更新项 */
  items: string[];
};

export type ChangelogEntry = {
  /** 形如 "V3.0.3" */
  version: string;
  /** 形如 "2026-09-03" */
  date: string;
  zh: ChangelogCopy;
  en: ChangelogCopy;
};

// 由新到旧排列（页面直接按数组顺序渲染，最新在最前）。
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'V3.0.4',
    date: '2026-09-03',
    zh: {
      title: '更新内容展示优化',
      items: [
        '新增「更新内容」页面，用清晰的产品化语言展示每个版本的更新说明。',
        '支持中英文切换，切换语言后更新内容即时更新，无需重启应用。',
        '更新记录按版本倒序排列，层级清晰，并适配深色模式与小屏。',
      ],
    },
    en: {
      title: 'What’s new, redesigned',
      items: [
        'Added a dedicated “What’s new” page that presents each version’s changes in clear, plain language.',
        'Now bilingual: switching the app language updates the release notes instantly, with no restart needed.',
        'Release notes are shown newest-first with a clear hierarchy, and adapt to dark mode and small screens.',
      ],
    },
  },
  {
    version: 'V3.0.3',
    date: '2026-09-03',
    zh: {
      title: '账单导入与来源识别优化',
      items: [
        '新增马币电子钱包账单导入，支持直接导入 Touch ’n Go、Grab、Shopee、Lazada 等导出的对账单文件。',
        '导入时自动识别日期、金额、商户与类型，并匹配到对应账户；匹配不到会先提示你确认。',
        '导入流程改为「预览 → 确认 → 入账」，确认前不会写入任何账目。',
        '优化通知识别的来源列表，同一个 App 不再重复出现，账单来源标注更准确。',
      ],
    },
    en: {
      title: 'Statement imports and source detection',
      items: [
        'Added statement imports for Malaysian e-wallets, supporting exports from Touch ’n Go, Grab, Shopee, Lazada and more.',
        'Dates, amounts, merchants and types are detected automatically and matched to the right account — you will be asked to confirm when a match is not found.',
        'Imports now follow a preview → confirm → add flow, so nothing is recorded until you approve it.',
        'Improved the list of recognised source apps so the same app no longer appears twice.',
      ],
    },
  },
  {
    version: 'V3.0.2',
    date: '2026-09-03',
    zh: {
      title: '稳定性维护更新',
      items: [
        '提升数据保护与使用稳定性。',
        '本次为发布维护更新，功能内容与上一版一致。',
      ],
    },
    en: {
      title: 'Stability maintenance',
      items: [
        'Improved data protection and overall stability.',
        'A maintenance release — features are the same as the previous version.',
      ],
    },
  },
  {
    version: 'V3.0.1',
    date: '2026-09-03',
    zh: {
      title: '数据安全与稳定性提升',
      items: [
        '提升数据保护与使用稳定性，备份与云同步更可靠。',
        '修复若干已知问题，日常使用更顺畅。',
      ],
    },
    en: {
      title: 'Security and stability',
      items: [
        'Improved data protection and stability, making backup and cloud sync more reliable.',
        'Fixed several known issues for smoother everyday use.',
      ],
    },
  },
  {
    version: 'V2.14.16',
    date: '2026-09-03',
    zh: {
      title: '数据安全与稳定性提升',
      items: [
        '提升数据保护强度，备份与云同步遇到问题时不再静默失败，而是给出明确提示。',
        '优化云同步的错误处理，遇到可恢复的问题会说明原因，方便你重试。',
        '修复账单来源识别的个别错误，部分钱包的交易现在能正确标注来源。',
        '提升整体稳定性，减少偶发异常。',
      ],
    },
    en: {
      title: 'Security and stability',
      items: [
        'Strengthened data protection — backup and cloud sync now surface problems clearly instead of failing silently.',
        'Improved cloud sync error handling, explaining recoverable problems so you can retry.',
        'Fixed a few source-detection mistakes so transactions from some wallets are labelled correctly.',
        'Improved overall stability and reduced occasional errors.',
      ],
    },
  },
  {
    version: 'V2.14.15',
    date: '2026-09-03',
    zh: {
      title: '中英文文案完善',
      items: [
        '全面补齐英文界面文案，切换到英文后不再有遗漏未翻译的内容。',
        '统一日期、备份、云同步与对账单提示的措辞，中英文表达一致。',
        '优化首次使用引导中的默认账户命名，两种语言下都更自然。',
      ],
    },
    en: {
      title: 'Language polish',
      items: [
        'Completed the English translation — no untranslated text is left behind when you switch to English.',
        'Unified the wording of date, backup, cloud sync and statement messages across both languages.',
        'Improved the default account name used during first-time setup in both languages.',
      ],
    },
  },
  {
    version: 'V2.14.14',
    date: '2026-09-03',
    zh: {
      title: '界面细节打磨',
      items: [
        '优化「待确认交易」列表的显示，卡片圆角与页面留白和全站保持一致。',
        '修复列表分隔线重复显示的问题，界面更干净。',
      ],
    },
    en: {
      title: 'Visual refinements',
      items: [
        'Refined the pending transactions list so card corners and spacing match the rest of the app.',
        'Fixed doubled separator lines in the list for a cleaner look.',
      ],
    },
  },
  {
    version: 'V2.14.13',
    date: '2026-09-03',
    zh: {
      title: '运行效率优化',
      items: [
        '提升应用运行效率与稳定性。',
        '本次为维护更新，功能与界面无变化。',
      ],
    },
    en: {
      title: 'Performance maintenance',
      items: [
        'Improved performance and stability.',
        'A maintenance update — no changes to features or screens.',
      ],
    },
  },
  {
    version: 'V2.14.12',
    date: '2026-09-03',
    zh: {
      title: '视觉一致性打磨',
      items: [
        '优化待办多选时底部操作栏的外观，去掉多余描边，阴影更柔和。',
        '视觉层次与全站其他浮层保持一致。',
      ],
    },
    en: {
      title: 'Visual consistency',
      items: [
        'Refined the batch action bar when selecting tasks — removed the extra outline and softened the shadow.',
        'Its depth now matches other floating panels throughout the app.',
      ],
    },
  },
  {
    version: 'V2.14.11',
    date: '2026-09-03',
    zh: {
      title: '数字排版优化',
      items: [
        '统一金额数字的字重，首页与财务页的数字层级更整齐。',
        '金额不再喧宾夺主，重点信息更突出。',
      ],
    },
    en: {
      title: 'Number typography',
      items: [
        'Unified the weight of amount figures so numbers across Home and Finance line up consistently.',
        'Amounts no longer overpower the content, keeping the emphasis where it belongs.',
      ],
    },
  },
  {
    version: 'V2.14.10',
    date: '2026-09-03',
    zh: {
      title: '大数字排版优化',
      items: [
        '优化大额数字的字距，与周围标题的观感更协调。',
        '首页结余、财务净资产等大数字显示更紧凑清晰。',
      ],
    },
    en: {
      title: 'Large number spacing',
      items: [
        'Tightened the spacing of large amount figures so they sit better alongside headings.',
        'Big numbers such as your monthly balance and net worth now look cleaner and more compact.',
      ],
    },
  },
  {
    version: 'V2.14.9',
    date: '2026-09-03',
    zh: {
      title: '数字层级修正',
      items: [
        '调整部分金额数字的字重，修正「次要数字比主要数字更粗」的问题。',
        '首页与财务页的数字层级现在完全一致。',
      ],
    },
    en: {
      title: 'Number hierarchy fix',
      items: [
        'Adjusted the weight of some amount figures, fixing cases where secondary numbers looked heavier than the main one.',
        'Number hierarchy is now consistent across Home and Finance.',
      ],
    },
  },
  {
    version: 'V2.14.8',
    date: '2026-09-03',
    zh: {
      title: '跨页视觉统一',
      items: [
        '财务页「净资产」大数字的字重与首页保持一致，跨页观感统一。',
        '大数字更轻量克制，阅读负担更低。',
      ],
    },
    en: {
      title: 'Cross-page consistency',
      items: [
        'Matched the weight of the net worth figure on Finance with the balance on Home, so both pages feel the same.',
        'Large numbers now look lighter and easier to read.',
      ],
    },
  },
  {
    version: 'V2.14.7',
    date: '2026-09-03',
    zh: {
      title: '首页与排版打磨',
      items: [
        '优化各级标题的字距，全站标题更紧凑克制。',
        '首页本月结余大数字的字重收敛，信息层级更清晰。',
        '首页快捷入口改为无边框的图标网格，留白更充足。',
      ],
    },
    en: {
      title: 'Typography and Home polish',
      items: [
        'Tightened letter spacing on headings at every level for a more compact, refined look.',
        'Softened the weight of the monthly balance on Home to clarify the hierarchy.',
        'Home shortcuts are now a borderless icon grid with more breathing room.',
      ],
    },
  },
  {
    version: 'V2.14.6',
    date: '2026-09-02',
    zh: {
      title: '设置页与问候语优化',
      items: [
        '「数据与安全」页面更简洁，移除不再需要的设备检测信息。',
        '优化首页问候语，现在会读取你在「我的」页设置的用户名，改名后即时更新。',
        '优化识别来源 App 列表，重复的选项已移除。',
      ],
    },
    en: {
      title: 'Settings and greeting polish',
      items: [
        'Simplified the Data & Security page by removing device details you no longer need.',
        'The greeting on Home now uses the name you set under Me, and updates as soon as you change it.',
        'Cleaned up the list of recognised source apps by removing duplicates.',
      ],
    },
  },
  {
    version: 'V2.14.5',
    date: '2026-09-02',
    zh: {
      title: '付款识别范围扩展',
      items: [
        '新增支持识别拼多多的付款成功页，付款后可快速记一笔。',
        '优化金额识别，人民币金额也能正确读取。',
      ],
    },
    en: {
      title: 'Wider payment detection',
      items: [
        'Added support for recognising Pinduoduo payment success screens, so you can log spending right after paying.',
        'Improved amount detection to correctly read Chinese yuan amounts.',
      ],
    },
  },
  {
    version: 'V2.14.4',
    date: '2026-09-02',
    zh: {
      title: '电子钱包覆盖扩展',
      items: [
        '「电子钱包付款实时捕获」现在覆盖 Touch ’n Go、Grab、Shopee、Lazada 等主流钱包。',
        '修正部分钱包的识别来源，此前个别钱包无法被正确识别。',
        '设置页的开关名称与说明文案已同步更新。',
      ],
    },
    en: {
      title: 'Broader e-wallet coverage',
      items: [
        'Real-time e-wallet payment capture now covers major wallets including Touch ’n Go, Grab, Shopee and Lazada.',
        'Fixed source detection for some wallets that previously were not recognised.',
        'Updated the setting label and description to match.',
      ],
    },
  },
  {
    version: 'V2.14.3',
    date: '2026-09-02',
    zh: {
      title: '付款识别修复',
      items: [
        '修复 Touch ’n Go 付款成功页无法被识别的问题，付款后可正常快速记账。',
        '优化识别来源的准确性。',
      ],
    },
    en: {
      title: 'Payment detection fix',
      items: [
        'Fixed an issue where Touch ’n Go payment screens were not recognised, so payments can be logged right after they succeed.',
        'Improved the accuracy of source detection.',
      ],
    },
  },
  {
    version: 'V2.14.2',
    date: '2026-09-02',
    zh: {
      title: '识别稳定性优化',
      items: [
        '优化付款成功页的读取稳定性，部分应用内网页形式的付款页现在也能正确识别。',
        '提升识别过程的可靠性，减少偶发漏读。',
      ],
    },
    en: {
      title: 'Detection reliability',
      items: [
        'Improved the reliability of reading payment screens, including checkout pages shown inside an app browser.',
        'Reduced occasional missed captures.',
      ],
    },
  },
  {
    version: 'V2.14.1',
    date: '2026-09-02',
    zh: {
      title: '权限状态修复',
      items: [
        '修复已在系统中开启权限、应用内仍提示「需要授权」的问题。',
        '精简应用申请的系统权限，只保留必要项。',
      ],
    },
    en: {
      title: 'Permission status fix',
      items: [
        'Fixed an issue where the app still asked for permission even after you enabled it in system settings.',
        'Trimmed the system permissions the app requests, keeping only what is necessary.',
      ],
    },
  },
  {
    version: 'V2.14.0',
    date: '2026-09-02',
    zh: {
      title: '付款实时捕获',
      items: [
        '新增「电子钱包付款实时捕获」，在支持的钱包付款成功后即可快速记一笔。',
        '识别到的交易会先进入「待确认」列表，确认后才正式入账，不会自动记账。',
        '新增通过分享付款截图来识别的方式，作为读屏之外的补充。',
        '只在你勾选的 App 上生效，仅读取界面文字，不截图、不读取剪贴板、不上传。',
        '设置页新增独立开关与授权状态提示，可一键前往系统设置开启。',
      ],
    },
    en: {
      title: 'Real-time payment capture',
      items: [
        'Added real-time e-wallet payment capture, so you can log a transaction right after a supported wallet payment succeeds.',
        'Detected transactions go to the Pending list and are only recorded after you confirm — nothing is added automatically.',
        'You can also share a payment screenshot for recognition, as a fallback to on-screen detection.',
        'It only works for the apps you select, reads on-screen text only, and never takes screenshots or uploads anything.',
        'Added a dedicated switch showing permission status, with a shortcut to system settings.',
      ],
    },
  },
  {
    version: 'V2.13.4',
    date: '2026-09-02',
    zh: {
      title: '提醒与待办编辑',
      items: [
        '修复待办提醒不响铃的问题，提醒现在会像闹钟一样正常发声。',
        '新增编辑待办：点击待办行即可修改内容、时间与提醒，保存后原地更新。',
        '优化交互，勾选、删除等操作不会再误触进入编辑。',
      ],
    },
    en: {
      title: 'Reminders and task editing',
      items: [
        'Fixed task reminders not playing a sound — they now ring like an alarm.',
        'Added task editing: tap a task to change its details, time or reminder, and it updates in place.',
        'Refined interactions so completing or deleting a task will not accidentally open the editor.',
      ],
    },
  },
  {
    version: 'V2.13.3',
    date: '2026-09-02',
    zh: {
      title: '提醒通知优化',
      items: [
        '优化提醒通知内容，标题直接显示待办名称，一眼看清是哪一条。',
        '通知正文显示任务时间与提前量，距离开始还有多久一目了然。',
      ],
    },
    en: {
      title: 'Clearer reminder notifications',
      items: [
        'Improved reminder notifications — the title now shows the task name so you can tell at a glance what it is for.',
        'The body shows the task time and how far in advance you are being reminded.',
      ],
    },
  },
  {
    version: 'V2.13.2',
    date: '2026-09-02',
    zh: {
      title: '提醒准时性修复',
      items: [
        '修复部分新系统机型上提醒到点不弹出的问题。',
        '优化提醒的触发精度，到点提醒更准时。',
      ],
    },
    en: {
      title: 'On-time reminder fix',
      items: [
        'Fixed reminders not appearing on time on some newer devices.',
        'Improved reminder timing accuracy so alerts arrive exactly when scheduled.',
      ],
    },
  },
  {
    version: 'V2.13.1',
    date: '2026-09-02',
    zh: {
      title: '表单体验优化',
      items: [
        '待办表单的「提醒提前量」改为单行选择，点按后展开选项，表单更紧凑。',
        '样式与日期、时间字段统一。',
      ],
    },
    en: {
      title: 'Form polish',
      items: [
        'The reminder lead-time picker is now a single-line field that expands inline, making the form more compact.',
        'Its style now matches the date and time fields.',
      ],
    },
  },
  {
    version: 'V2.13.0',
    date: '2026-09-02',
    zh: {
      title: '提醒能力升级',
      items: [
        '待办提醒新增提前量选项：准时、15 分钟前、30 分钟前、1 小时前、1 天前等。',
        '重复待办会根据新的日期自动顺延提醒，无需重新设置。',
        '没有设置时间的待办开启提醒时，默认按早上 9:00 提醒。',
        '习惯新增「每天几点提醒」，可随时设置、修改或关闭。',
        '待办与习惯提醒使用独立通知类别，可在系统中分别管理；完成或删除后自动取消。',
      ],
    },
    en: {
      title: 'Reminder upgrade',
      items: [
        'Task reminders now support lead times — on time, 15 minutes before, 30 minutes before, 1 hour before, 1 day before and more.',
        'Repeating tasks carry their reminder forward automatically, so you do not need to set it again.',
        'Tasks without a time default to 9:00 in the morning when you turn on a reminder.',
        'Habits gained a daily reminder time you can set, change or turn off at any point.',
        'Task and habit reminders use separate notification categories you can manage individually, and are cancelled automatically once completed or deleted.',
      ],
    },
  },
  {
    version: 'V2.11.0',
    date: '2026-08-30',
    zh: {
      title: '待办批量操作',
      items: [
        '待办新增多选模式，可一次勾选多条任务。',
        '支持批量完成、批量删除与批量添加标签，操作后均可撤销。',
        '新增全选 / 取消全选，处理大量任务更省事。',
      ],
    },
    en: {
      title: 'Batch task actions',
      items: [
        'Added a multi-select mode so you can pick several tasks at once.',
        'Complete, delete or tag tasks in bulk, with undo available after each action.',
        'Added select all and deselect all for faster cleanup.',
      ],
    },
  },
  {
    version: 'V2.10.0',
    date: '2026-08-30',
    zh: {
      title: '待办标签与筛选',
      items: [
        '待办支持标签，可按项目或场景给任务归类。',
        '新增标签筛选条，点按标签即可只看这一类任务。',
        '任务行直接显示标签，一眼看清归类。',
        '搜索与标签筛选可同时使用。',
      ],
    },
    en: {
      title: 'Task tags and filtering',
      items: [
        'Tasks now support tags, so you can group them by project or context.',
        'Added a tag filter bar — tap a tag to show only those tasks.',
        'Tags appear directly on each task row for quick recognition.',
        'Search and tag filters can be combined.',
      ],
    },
  },
  {
    version: 'V2.9.0',
    date: '2026-08-30',
    zh: {
      title: '待办搜索与排序',
      items: [
        '待办与日历新增搜索，按标题和备注实时筛选。',
        '新增排序方式：优先级、截止日期、创建时间、标题。',
        '搜索无结果时给出明确提示，而不是空白页面。',
      ],
    },
    en: {
      title: 'Task search and sorting',
      items: [
        'Added search across the to-do and calendar views, filtering by title and notes as you type.',
        'Added sorting by priority, due date, creation time or title.',
        'A clear message now appears when nothing matches your search, instead of a blank page.',
      ],
    },
  },
  {
    version: 'V2.8.0',
    date: '2026-08-30',
    zh: {
      title: '重复待办',
      items: [
        '待办支持重复，可设为每天、每周、每月或每年。',
        '完成重复待办后自动生成下一笔，无需手动新建。',
        '重复待办显示频率标识，自动生成的那一笔可单独撤销。',
      ],
    },
    en: {
      title: 'Repeating tasks',
      items: [
        'Tasks can now repeat daily, weekly, monthly or yearly.',
        'Completing a repeating task creates the next one automatically — no need to re-create it.',
        'Repeating tasks show a frequency badge, and a newly generated one can be undone on its own.',
      ],
    },
  },
  {
    version: 'V2.7.0',
    date: '2026-08-30',
    zh: {
      title: '待办子任务',
      items: [
        '待办支持子任务，可以把一个大任务拆成多个小步骤。',
        '任务行显示子任务完成进度，点按可展开查看。',
        '展开后可逐条勾选、添加或删除子任务。',
        '子任务不会自动改变主任务的完成状态，避免误标完成。',
      ],
    },
    en: {
      title: 'Task subtasks',
      items: [
        'Tasks support subtasks, so you can break a big task into smaller steps.',
        'Each task row shows subtask progress and can be expanded to see them.',
        'You can check off, add or remove subtasks inline.',
        'Subtasks do not automatically change the parent task status, so nothing gets marked complete by mistake.',
      ],
    },
  },
  {
    version: 'V2.6.5',
    date: '2026-09-02',
    zh: {
      title: '深色模式优化',
      items: [
        '修复深色模式下启动瞬间的白屏闪烁，启动过程更顺滑。',
        '优化深色模式下的桌面图标背景与状态栏显示。',
      ],
    },
    en: {
      title: 'Dark mode polish',
      items: [
        'Fixed the white flash when launching the app in dark mode.',
        'Improved the app icon background and status bar appearance in dark mode.',
      ],
    },
  },
  {
    version: 'V2.6.4',
    date: '2026-08-30',
    zh: {
      title: '日记页视觉统一',
      items: [
        '日记页的完成勾选样式与其他页面统一。',
        '日记条目卡片的内边距、圆角与间距和全站卡片一致。',
      ],
    },
    en: {
      title: 'Journal visual consistency',
      items: [
        'Unified the completion checkbox in the journal with the rest of the app.',
        'Journal cards now share the same padding, corner radius and spacing as cards elsewhere.',
      ],
    },
  },
  {
    version: 'V2.6.3',
    date: '2026-08-30',
    zh: {
      title: '勾选样式统一',
      items: [
        '首页「今日计划」的勾选样式与计划页统一，尺寸与手感一致。',
        '跨页面完成一项操作时的体验更加一致。',
      ],
    },
    en: {
      title: 'Checkbox consistency',
      items: [
        'The checkbox in today’s plan on Home now matches the one on the Plan tab in both size and feel.',
        'Checking things off feels the same across screens.',
      ],
    },
  },
  {
    version: 'V2.6.2',
    date: '2026-08-30',
    zh: {
      title: '财务概览打磨',
      items: [
        '财务概览新增统一的洞察行，储蓄率、环比上月、日均可用等指标排列更整齐。',
        '配色更克制，只有需要提醒注意的数字才使用醒目颜色。',
        '卡片内间距与分隔线留白更协调。',
      ],
    },
    en: {
      title: 'Finance overview polish',
      items: [
        'Added a consistent insight row in the finance overview, aligning savings rate, month-over-month change and daily budget.',
        'A more restrained palette — only figures that need attention use attention-grabbing colours.',
        'Improved spacing and divider padding inside cards.',
      ],
    },
  },
  {
    version: 'V2.6.1',
    date: '2026-08-30',
    zh: {
      title: '计划页结构优化',
      items: [
        '计划页精简为日历 / 待办 / 待买 / 习惯四档，并默认停留在日历。',
        '选中「今天」时，日历下方同时显示当日待办与今日习惯。',
        '列表行样式统一，信息一眼扫得完。',
      ],
    },
    en: {
      title: 'Plan tab restructure',
      items: [
        'The Plan tab is now organised as Calendar, To-do, Shopping and Habits, opening on Calendar by default.',
        'When today is selected, the day’s tasks and habits appear together below the calendar.',
        'List rows share one consistent layout that is easy to scan.',
      ],
    },
  },
  {
    version: 'V2.6.0',
    date: '2026-08-30',
    zh: {
      title: '日历月视图',
      items: [
        '计划页新增日历月视图，一屏看清整月安排。',
        '有任务的日期显示圆点，今天高亮，选中日期一目了然。',
        '支持切换上 / 下月，点选任意日期即可查看当天任务。',
      ],
    },
    en: {
      title: 'Month calendar view',
      items: [
        'Added a month view calendar to the Plan tab, so you can see the whole month at a glance.',
        'Days with tasks show a dot and today is highlighted, making the selected date easy to spot.',
        'Move between months and tap any date to see that day’s tasks.',
      ],
    },
  },
  {
    version: 'V2.5.0',
    date: '2026-09-02',
    zh: {
      title: '财务洞察增强',
      items: [
        '本月收支新增「储蓄率」，一眼看清这个月存下了多少。',
        '新增「环比上月」，直观对比本月与上月结余的变化。',
        '预算新增「日均可用」，显示剩余天数与每天可花金额。',
        '支出趋势前五分类显示占比百分比。',
      ],
    },
    en: {
      title: 'Richer finance insights',
      items: [
        'Added a savings rate to this month’s income and expenses, so you can see how much you kept.',
        'Added a month-over-month comparison for a quick look at how your balance changed.',
        'Added a daily available amount to the budget, showing days left and how much you can spend per day.',
        'The top five spending categories now show their percentage share.',
      ],
    },
  },
  {
    version: 'V2.4.1',
    date: '2026-09-02',
    zh: {
      title: '夜间模式修复',
      items: [
        '新增「定时」外观模式：晚上 7 点到早上 7 点自动切换深色。',
        '新安装的用户默认使用「定时」，无需手动设置。',
        '修复选择浅色却显示深色的问题。',
      ],
    },
    en: {
      title: 'Dark mode fix',
      items: [
        'Added a scheduled appearance mode that switches to dark automatically from 7 in the evening to 7 in the morning.',
        'New installs use the scheduled mode by default — no setup needed.',
        'Fixed an issue where choosing light could still show the dark theme.',
      ],
    },
  },
  {
    version: 'V2.4.0',
    date: '2026-09-01',
    zh: {
      title: '应用锁与隐私保护',
      items: [
        '新增「进入 App 时验证」，开启后打开应用需验证面容或指纹。',
        '新增「回到 App 时重新验证」，离开超过设定时间后返回需再次验证。',
        '新增自动锁定时间选项：立即 / 30 秒 / 1 分钟 / 5 分钟。',
        '新增「隐藏最近任务画面」，避免应用内容出现在系统任务缩略图或截图中。',
        '生物识别失败时可用设备密码作为备用方式；同时修复深色模式下的启动白闪。',
      ],
    },
    en: {
      title: 'App lock and privacy',
      items: [
        'Added verification when opening the app, requiring face or fingerprint once enabled.',
        'Added re-verification when returning to the app after being away longer than the set time.',
        'Added auto-lock timing options: immediately, 30 seconds, 1 minute or 5 minutes.',
        'Added hiding content from the recent apps screen, so it does not appear in the system app switcher or screenshots.',
        'Device passcode works as a fallback if biometrics fail, and the white flash on launch in dark mode is fixed.',
      ],
    },
  },
  {
    version: 'V2.3.4',
    date: '2026-09-01',
    zh: {
      title: '应用锁修复',
      items: [
        '修复应用锁在部分设备上无法开启的问题，面容与指纹验证可正常使用。',
        '优化设备能力检测，提示信息更准确，不再一律显示「不可用」。',
      ],
    },
    en: {
      title: 'App lock fix',
      items: [
        'Fixed an issue that prevented app lock from working on some devices — face and fingerprint verification now work properly.',
        'Improved device capability checks so messages are accurate instead of always saying unavailable.',
      ],
    },
  },
  {
    version: 'V2.3.3',
    date: '2026-09-01',
    zh: {
      title: '生物识别体验优化',
      items: [
        '修复生物识别一律提示「未设置」的问题，现在按实际情况给出对应说明。',
        '验证失败时按具体原因提示，例如已取消、验证失败或暂时锁定。',
        '优化验证方式，面容、指纹与设备密码均可使用。',
        '设置页新增设备能力说明，不记录任何生物识别信息。',
      ],
    },
    en: {
      title: 'Biometric improvements',
      items: [
        'Fixed biometrics always reporting not set up — messages now reflect the real situation.',
        'Failures now explain the specific reason, such as cancelled, failed, or temporarily locked.',
        'Verification supports face, fingerprint and device passcode.',
        'Added a device capability summary in settings that stores no biometric data.',
      ],
    },
  },
  {
    version: 'V2.3.2',
    date: '2026-09-01',
    zh: {
      title: '应用锁',
      items: [
        '新增「应用锁」开关，开启后打开应用、或离开超过 30 秒后返回时需验证面容或指纹。',
        '锁定页设计简洁，进入即自动唤起验证。',
        '设备未录入任何生物识别时，开关会自动置灰并给出提示。',
      ],
    },
    en: {
      title: 'App lock',
      items: [
        'Added an app lock switch — once enabled, face or fingerprint is required when opening the app or returning after 30 seconds away.',
        'The lock screen is minimal and triggers verification automatically.',
        'The switch is disabled with an explanation if no biometrics are set up on the device.',
      ],
    },
  },
  {
    version: 'V2.3.1',
    date: '2026-09-01',
    zh: {
      title: '待买清单多币种',
      items: [
        '待买清单支持切换币种（马币 / 人民币），默认马币。',
        '输入价格时符号随币种显示，列表中各物品按自己的币种展示。',
        '合计按币种分别统计，不做汇率换算。',
      ],
    },
    en: {
      title: 'Multi-currency shopping list',
      items: [
        'The shopping list supports currency switching (Malaysian ringgit / Chinese yuan), defaulting to ringgit.',
        'The price field shows the matching currency symbol, and items display in their own currency.',
        'Totals are grouped by currency with no exchange-rate conversion.',
      ],
    },
  },
  {
    version: 'V2.3.0',
    date: '2026-09-01',
    zh: {
      title: '首次使用体验',
      items: [
        '新增首次使用引导，帮你建立账户并录入期初余额，净资产从一开始就算得准。',
        '还没有账目时，财务页显示「记一笔」引导卡片，不再出现让人困惑的负数。',
        '快速记账的「固定」支持每月 / 每周 / 每年重复，到期自动生成下一笔。',
      ],
    },
    en: {
      title: 'First-time experience',
      items: [
        'Added a first-time setup guide that helps you create accounts and enter opening balances, so net worth is right from the start.',
        'When there are no records yet, the finance page shows a guided add-a-transaction card instead of a confusing negative number.',
        'Fixed expenses in quick entry can repeat monthly, weekly or yearly, with the next one generated automatically when due.',
      ],
    },
  },
  {
    version: 'V2.2.0',
    date: '2026-09-01',
    zh: {
      title: '余额录入与隐私',
      items: [
        '财务页每个账户现在可点击展开，直接录入当前真实余额。',
        '采用对账式记账，保存后余额精确等于你输入的数字，后续流水继续累加。',
        '配合「隐藏余额」开关，开启后所有金额显示为圆点，录入时仍显示真实数字。',
      ],
    },
    en: {
      title: 'Balance entry and privacy',
      items: [
        'Every account on the Finance page can now be expanded to enter its current balance directly.',
        'Balances are reconciled on save, so the figure matches exactly what you enter and later transactions keep building on it.',
        'Works with the hide balances switch — amounts show as dots, while entering still reveals the real numbers.',
      ],
    },
  },
  {
    version: 'V2.1.3',
    date: '2026-09-01',
    zh: {
      title: '界面视觉升级',
      items: [
        '全新沉浸式界面：状态栏与手势导航栏改为透明，内容延伸到屏幕边缘。',
        '新增页面切换动效，二级页淡入淡出、快速记账从底部滑入，并遵循系统「减弱动态效果」设置。',
        '全站金额数字显示统一，长数字自适应缩放不再被截断，字号字重一致。',
      ],
    },
    en: {
      title: 'Interface upgrade',
      items: [
        'A new immersive interface: the status and gesture bars are transparent, with content extending edge to edge.',
        'Added page transitions — sub-pages fade in and out and quick entry slides up from the bottom, all respecting the system reduce motion setting.',
        'Amounts are rendered consistently app-wide, scaling to fit instead of being cut off, with uniform size and weight.',
      ],
    },
  },
  {
    version: 'V2.1.2',
    date: '2026-09-01',
    zh: {
      title: '底部导航调整',
      items: [
        '底部导航栏恢复为浮动胶囊样式。',
        '记账分类预设、自定义分类修复与深色模式修复均已保留。',
      ],
    },
    en: {
      title: 'Bottom navigation revert',
      items: [
        'The bottom navigation bar is back to its floating pill style.',
        'Category presets, the custom category fix and the dark mode fix are all retained.',
      ],
    },
  },
  {
    version: 'V2.1.1',
    date: '2026-09-01',
    zh: {
      title: '记账分类预设',
      items: [
        '记账、通知确认与编辑交易的分类输入改为预设标签，点选即可填入。',
        '支出预设：餐饮 / 交通 / 购物 / 居家 / 娱乐 / 医疗 / 其他；收入预设：工资 / 奖金 / 投资 / 其他。',
        '保留「自定义」入口，可录入任意分类。',
        '修复自定义分类无法输入的问题。',
      ],
    },
    en: {
      title: 'Category presets',
      items: [
        'Category entry in manual, notification confirmation and edit screens now uses preset chips — just tap to fill.',
        'Expense presets include food, transport, shopping, home, entertainment, medical and other; income presets include salary, bonus, investment and other.',
        'A custom option remains available for any category you like.',
        'Fixed an issue where the custom category field would not accept input.',
      ],
    },
  },
  {
    version: 'V2.0.2',
    date: '2026-09-01',
    zh: {
      title: '深色模式修复',
      items: [
        '修复深色模式下部分卡片层次显示相反的问题，内嵌卡片现在正确呈现凹陷效果。',
        '优化深色模式下的徽章、选中态与记账类型配色。',
      ],
    },
    en: {
      title: 'Dark mode fix',
      items: [
        'Fixed cards in dark mode appearing raised instead of recessed.',
        'Refined badge, selection and transaction type colours for dark mode.',
      ],
    },
  },
  {
    version: 'V2.0.1',
    date: '2026-08-30',
    zh: {
      title: '视觉细节打磨',
      items: [
        '待办优先级徽章改为柔和底色，与首页风格一致。',
        '计划页与财务页的选中态样式统一。',
        '「我的」页分组间距统一，头像遮罩更协调。',
        '快速记账的类型按语义着色，保存与取消按钮收进底部卡片。',
      ],
    },
    en: {
      title: 'Visual polish',
      items: [
        'Task priority badges now use softer background colours, matching Home.',
        'Selection styles on the Plan and Finance tabs are now consistent.',
        'Group spacing on the Me tab is uniform and the avatar overlay is more balanced.',
        'Quick entry types are colour-coded by meaning, with save and cancel moved into the bottom card.',
      ],
    },
  },
  {
    version: 'V2.0.0',
    date: '2026-08-30',
    zh: {
      title: '信息架构大改版',
      items: [
        '导航重构为「今日 / 计划 / 财务 / 我的」四个主页面，各自独立层级，安卓返回键更符合直觉。',
        '「我的」页改为分组入口，原设置页拆分为多个独立页面；速记、账单导入、待确认交易等改为二级页面。',
        '首页改为财务优先：顶部直接显示本月结余，并新增快捷操作与最近流水。',
        '财务页精简为「概览 / 流水 / 预算」三档，账户、信用卡与支出趋势收进概览。',
        '任务页精简为「今天 / 待办 / 习惯」，可点区域更大，删除与完成均可撤销。',
      ],
    },
    en: {
      title: 'Navigation redesign',
      items: [
        'Navigation is rebuilt around four main tabs — Today, Plan, Finance and Me — each with its own stack and a more predictable back button.',
        'The Me tab is now a grouped hub, settings are split into separate pages, and journal, statement import and pending transactions became sub-pages.',
        'Home leads with finances: your monthly balance sits at the top, joined by quick actions and recent transactions.',
        'Finance is reduced to three tabs — Overview, Transactions and Budget — with accounts, cards and spending trends folded into Overview.',
        'Tasks are reduced to Today, To-do and Habits, with larger tap targets and undo for both completion and deletion.',
      ],
    },
  },
  {
    version: 'V1.2.4',
    date: '2026-08-29',
    zh: {
      title: '组件统一与缺陷修复',
      items: [
        '新增统一组件库，各页面视觉风格一致。',
        '修复状态栏在浅色 / 深色模式下偶发全白不可读的问题。',
        '修复新建待办表单被悬浮按钮遮挡的问题。',
        '优化窄屏布局：小于 360dp 的屏幕改为单列显示。',
      ],
    },
    en: {
      title: 'Shared components and fixes',
      items: [
        'Added a shared component library for a consistent look across screens.',
        'Fixed the status bar occasionally turning all white and unreadable in light or dark mode.',
        'Fixed the new task form being covered by the floating button.',
        'Improved narrow-screen layout: screens under 360dp now use a single column.',
      ],
    },
  },
  {
    version: 'V1.2.3',
    date: '2026-08-29',
    zh: {
      title: '预算卡片改版',
      items: [
        '重新设计月度预算卡片，突出「本月剩余」，信息层级更清楚。',
        '预算进度条按使用率变色，超出预算时仍显示真实百分比。',
        '修复双币种切换器在部分屏幕上溢出的问题。',
        '未设置预算时显示引导入口，可一键前往设置。',
      ],
    },
    en: {
      title: 'Budget card redesign',
      items: [
        'Redesigned the monthly budget card, making the remaining amount the focus.',
        'The budget bar changes colour by usage, and still shows the true percentage when over budget.',
        'Fixed the currency switcher overflowing on some screens.',
        'When no budget is set, a shortcut guides you to set one.',
      ],
    },
  },
  {
    version: 'V1.0.0',
    date: '2026-08-28',
    zh: {
      title: '首个正式版本',
      items: [
        '首个正式版本上线，包含今日、计划、财务、记录、设置五大模块。',
        '财务支持概览、流水、预算、信用卡账期与趋势；计划支持待办、习惯与待买。',
        '支持浅色、深色与跟随系统三种外观，并支持双币种与汇率。',
        '支持加密云备份，数据可安全保存与恢复。',
      ],
    },
    en: {
      title: 'First release',
      items: [
        'The first official release, with five modules: Today, Plan, Finance, Journal and Settings.',
        'Finance covers overview, transactions, budget, card billing cycles and trends; Plan covers to-dos, habits and shopping.',
        'Supports light, dark and system appearance, plus dual currency and exchange rates.',
        'Encrypted cloud backup keeps your data safe and restorable.',
      ],
    },
  },
];

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** 把 "2026-09-03" 格式化为本地化的日期显示文案。 */
export function formatChangelogDate(iso: string, lang: ChangelogLang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (lang === 'en') return `${MONTHS_EN[month - 1]} ${day}, ${year}`;
  return `${year}年${month}月${day}日`;
}

/** 按语言取某个版本的文案。 */
export function changelogCopy(entry: ChangelogEntry, lang: ChangelogLang): ChangelogCopy {
  return lang === 'en' ? entry.en : entry.zh;
}
