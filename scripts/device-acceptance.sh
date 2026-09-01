#!/usr/bin/env bash
# 真机验收辅助脚本（life-workbench-native）
#
# 用途：把 §十三 验收里可自动化的部分（安装 / 启动 / 宽度矩阵 / 深浅色 /
#       200% 字体 / 三键导航 / Reduce Motion）变成可重复执行的命令，
#       并保证每次都能把设备设置**精确还原**到你的日常基线。
#
# 用法：
#   bash scripts/device-acceptance.sh baseline        # 打印当前设备设置（改动前先存档）
#   bash scripts/device-acceptance.sh install         # 安装 release APK 并冷启动
#   bash scripts/device-acceptance.sh shot <label>    # 截图到 acceptance-shots/<label>.png
#   bash scripts/device-acceptance.sh width <dp>      # 切换到指定 dp 宽度（320/360/393/412/430...）
#   bash scripts/device-acceptance.sh dark on|off     # 深色 / 浅色
#   bash scripts/device-acceptance.sh font <scale>    # 字体缩放（1.0 / 2.0 ...）
#   bash scripts/device-acceptance.sh nav gesture|3button
#   bash scripts/device-acceptance.sh motion on|off   # Reduce Motion（会自动冷启动 App）
#   bash scripts/device-acceptance.sh restore         # 还原到基线
#
# 注意：Reanimated 的 useReducedMotion 只在模块加载时求值一次，
#       所以切换 Reduce Motion 后必须冷启动 App —— motion 子命令已内置 force-stop。

set -euo pipefail

PKG="com.luka.lifeworkbench"
ACT="$PKG/.MainActivity"
APK="android/app/build/outputs/apk/release/app-release.apk"
SHOTS="acceptance-shots"

# ---- 设备日常基线（2026-08-29 采集自 Pixel 9 Pro / 46201FDAP007FD）----
BASE_DENSITY="${BASE_DENSITY:-586}"     # 约 349.5dp 宽
BASE_FONT="${BASE_FONT:-1.15}"
BASE_NIGHT="${BASE_NIGHT:-no}"
BASE_NAV="${BASE_NAV:-gestural}"
BASE_TRANSITION="${BASE_TRANSITION:-1.0}"

PHYS_W=1280   # 物理宽度 px，用于 dp -> density 换算

need_device() {
  local n
  n="$(adb devices | sed '1d' | grep -c "device$" || true)"
  if [ "$n" -eq 0 ]; then
    echo "❌ 没有检测到已连接设备（adb devices）" >&2
    exit 1
  fi
}

cmd_baseline() {
  need_device
  echo "wm size            : $(adb shell wm size | tr -d '\r')"
  echo "wm density         : $(adb shell wm density | tr -d '\r' | tr '\n' ' ')"
  echo "font_scale         : $(adb shell settings get system font_scale | tr -d '\r')"
  echo "night mode         : $(adb shell cmd uimode night | tr -d '\r')"
  echo "transition scale   : $(adb shell settings get global transition_animation_scale | tr -d '\r')"
  echo "nav overlay        : $(adb shell cmd overlay list | tr -d '\r' | grep -i navbar | tr '\n' ' ')"
  echo "installed version  : $(adb shell dumpsys package $PKG | tr -d '\r' | grep -E 'versionName|versionCode=' | head -2 | tr '\n' ' ')"
}

cmd_install() {
  need_device
  [ -f "$APK" ] || { echo "❌ 找不到 $APK，请先构建" >&2; exit 1; }
  echo "→ 安装 $APK"
  adb install -r "$APK"
  echo "→ 冷启动"
  adb shell am force-stop "$PKG" || true
  adb shell am start -n "$ACT" >/dev/null
  sleep 4
  echo "→ 已安装版本：$(adb shell dumpsys package $PKG | tr -d '\r' | grep -E 'versionName' | head -1 | xargs)"
}

cmd_shot() {
  need_device
  local label="${1:?用法: shot <label>}"
  mkdir -p "$SHOTS"
  adb exec-out screencap -p > "$SHOTS/$label.png"
  echo "📷 $SHOTS/$label.png  ($(du -h "$SHOTS/$label.png" | cut -f1))"
}

cmd_width() {
  need_device
  local dp="${1:?用法: width <dp>}"
  local d=$(( (PHYS_W * 160 + dp / 2) / dp ))
  adb shell wm density "$d"
  sleep 2
  echo "→ density=$d，实际宽度约 $(( PHYS_W * 160 / d ))dp"
}

cmd_dark() {
  need_device
  case "${1:?用法: dark on|off}" in
    on)  adb shell cmd uimode night yes ;;
    off) adb shell cmd uimode night no ;;
    *)   echo "❌ 仅支持 on|off" >&2; exit 1 ;;
  esac
  sleep 2
}

cmd_font() {
  need_device
  adb shell settings put system font_scale "${1:?用法: font <scale>}"
  sleep 2
}

cmd_nav() {
  need_device
  case "${1:?用法: nav gesture|3button}" in
    gesture) adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural ;;
    3button) adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton ;;
    *)       echo "❌ 仅支持 gesture|3button" >&2; exit 1 ;;
  esac
  sleep 2
}

cmd_motion() {
  need_device
  case "${1:?用法: motion on|off}" in
    # on = 开启 Reduce Motion（即关闭系统动画）
    on)  adb shell settings put global transition_animation_scale 0 ;;
    off) adb shell settings put global transition_animation_scale "$BASE_TRANSITION" ;;
    *)   echo "❌ 仅支持 on|off" >&2; exit 1 ;;
  esac
  # Reanimated 在模块加载时缓存该值，必须冷启动
  adb shell am force-stop "$PKG"
  adb shell am start -n "$ACT" >/dev/null
  sleep 4
  echo "→ transition_animation_scale=$(adb shell settings get global transition_animation_scale | tr -d '\r')（已冷启动 App）"
}

cmd_restore() {
  need_device
  echo "→ 还原设备基线"
  adb shell wm density "$BASE_DENSITY"
  adb shell settings put system font_scale "$BASE_FONT"
  adb shell cmd uimode night "$( [ "$BASE_NIGHT" = "yes" ] && echo yes || echo no )"
  adb shell settings put global transition_animation_scale "$BASE_TRANSITION"
  adb shell cmd overlay enable "com.android.internal.systemui.navbar.$BASE_NAV"
  sleep 2
  echo "✅ 已还原：density=$BASE_DENSITY font=$BASE_FONT night=$BASE_NIGHT nav=$BASE_NAV transition=$BASE_TRANSITION"
}

case "${1:-}" in
  baseline) cmd_baseline ;;
  install)  cmd_install ;;
  shot)     shift; cmd_shot "$@" ;;
  width)    shift; cmd_width "$@" ;;
  dark)     shift; cmd_dark "$@" ;;
  font)     shift; cmd_font "$@" ;;
  nav)      shift; cmd_nav "$@" ;;
  motion)   shift; cmd_motion "$@" ;;
  restore)  cmd_restore ;;
  *) sed -n '2,30p' "$0"; exit 1 ;;
esac
