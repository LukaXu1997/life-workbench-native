import React from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

// Unified icon set for the whole app. We standardize on MaterialCommunityIcons
// (Material Symbols style) so icons stay consistent and no new dependency is needed.
// Emoji is used ONLY for mood selection, never for nav/delete/category/primary actions.
// Typed loosely (name: string) so call sites don't need `as any` everywhere; the
// underlying glyph set is still enforced at authoring time via the ICONS map.
export const Icon: React.ComponentType<{ name: string; size?: number; color?: string }> =
  MaterialCommunityIcons as any;

// Business icon name map — keeps icon strings in one place instead of scattering them.
export const ICONS = {
  today: 'calendar-today',
  plan: 'checkbox-marked-outline',
  finance: 'wallet-outline',
  record: 'notebook-outline',
  settings: 'cog-outline',
  // §一 bottom tab "我的" (replaces the old gear/settings tab icon)
  me: 'account-circle-outline',
  image: 'image-outline',            // 从相册上传头像

  // NOTE: 'arrow-downward' / 'arrow-upward' are MaterialIcons names and do NOT
  // exist in the MaterialCommunityIcons glyphmap — they rendered as blank boxes.
  expense: 'arrow-down',
  income: 'arrow-up',
  recurring: 'sync', // 固定收入/支出
  repayment: 'credit-card-refund', // 还款
  budget: 'wallet',
  tasks: 'checkbox-multiple-outline',
  habit: 'repeat',
  shopping: 'cart-outline',
  inbox: 'inbox',
  journal: 'book-open-outline',
  media: 'bookmark-outline',
  creditCard: 'credit-card-outline',
  chart: 'chart-bar',
  trend: 'trending-up',
  category: 'shape-outline',
  backup: 'cloud-upload-outline',
  restore: 'cloud-download-outline',
  search: 'magnify',
  sort: 'sort',
  tag: 'tag-outline',            // 任务标签 / 批量加标签（V2.11.0）
  selectAll: 'select-all',       // 批量操作全选（V2.11.0）

  add: 'plus',
  check: 'check',
  bell: 'bell-outline',
  pending: 'clipboard-clock-outline',
  delete: 'delete-outline',
  edit: 'pencil-outline',
  chevronRight: 'chevron-right',
  chevronLeft: 'chevron-left',
  chevronDown: 'chevron-down',
  server: 'server-outline',        // 云备份连接配置
  back: 'arrow-left',
  close: 'close',
  clock: 'clock-outline',
  calendar: 'calendar-blank',
  mood: 'emoticon-outline',
  warning: 'alert-outline',
  sync: 'sync',
  key: 'key-variant',
  wifiOff: 'wifi-off',
  eye: 'eye',
  eyeOff: 'eye-off',

  // ——— §三 「我的」分组列表图标（线性风格，统一 22dp）———
  account: 'bank-outline',            // 账户管理
  wallet: 'wallet-outline',           // 默认币种与汇率
  fileImport: 'file-import-outline',  // 账单导入
  automation: 'robot-outline',        // 自动化分组
  flash: 'flash-outline',             // 快速添加设置
  palette: 'palette-outline',         // 外观
  translate: 'translate',             // 语言
  layout: 'view-dashboard-outline',   // 首页布局
  cloud: 'cloud-sync-outline',        // 云备份与恢复
  export: 'export-variant',           // 导出数据
  shield: 'shield-check-outline',     // 隐私与安全
  fingerprint: 'fingerprint',         // 生物识别
  lockClock: 'lock-clock',             // 自动锁定时间
  help: 'help-circle-outline',        // 帮助与反馈
  info: 'information-outline',        // 版本信息 / 关于
  swap: 'swap-horizontal',            // 汇率换算
  filter: 'filter-variant',           // 流水筛选
  menu: 'dots-horizontal',            // 更多菜单
  wizard: 'account-edit-outline',     // 重新开始引导（重设账户期初余额）

  // ——— 记账分类图标 ———
  catFood: 'restaurant',
  catTransport: 'bus',
  catHome: 'home-variant',
  catEntertainment: 'movie',
  catMedical: 'medical-bag',
  catSalary: 'cash',
  catBonus: 'gift',

  // ——— Avatar options for profile customization ———
  avatarStar: 'star-outline',
  avatarHeart: 'heart-outline',
  avatarSun: 'weather-sunny',
  avatarMoon: 'weather-night',
  avatarZap: 'flash',
} as const;

export type IconName = keyof typeof ICONS;
