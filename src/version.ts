// Single source of truth for app version (unified version-management scheme).
//
// Version format: V主版本.次版本.修订版本
//   major: large redesign / architecture or nav change / incompatible data change / "next-gen" capability
//   minor: new feature or clear UX iteration (PATCH resets to 0, e.g. V1.2.3 -> V1.3.0)
//   patch: bug fix / small tweak only (no new feature, no structure change)
//
// versionCode = MAJOR * 10000 + MINOR * 100 + PATCH  (must strictly increase on every published build)
// Display uses uppercase V (V1.0.0); Android versionName stays "1.0.0" (no V).

export const APP_VERSION = { MAJOR: 3, MINOR: 1, PATCH: 0 } as const;

export const VERSION_NAME = `${APP_VERSION.MAJOR}.${APP_VERSION.MINOR}.${APP_VERSION.PATCH}`; // "2.13.0"
export const DISPLAY_VERSION = `V${VERSION_NAME}`; // "V2.13.0"
export const VERSION_CODE = APP_VERSION.MAJOR * 10000 + APP_VERSION.MINOR * 100 + APP_VERSION.PATCH; // 21300

// Set on each release.
export const BUILD_DATE = '2026-09-04';

// 更新内容（版本记录）已迁移到 src/changelog.ts —— 面向普通用户的中英文产品化文案。
// 页面：设置 -> 关于 -> 查看更新内容（Changelog 页面）。
// 新增版本时请同步更新 src/changelog.ts 与 CHANGELOG.md。
