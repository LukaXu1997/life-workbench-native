# 本地构建验证 Runbook（Notion M1+M2）

> 目标：在你自己的 Mac 上构建 APK → 安装到 Pixel（46201FDAP007FD）→ 截图验证 Notion 重设计是否如预期生效。
> 本沙箱无法构建（无 Android platform/build-tools，且 Gradle 子进程被拦截），请在本地终端执行以下步骤。

---

## 0. 前置条件（一次性）
- **JDK 17**：`brew install openjdk@17`（本机已有 `/opt/homebrew/opt/openjdk@17`）
- **Android SDK**：`~/Library/Android/sdk`，需包含：
  - `platforms/android-35`
  - `build-tools/35.0.0`（或 34.0.0，按 compileSdk 而定）
  - `platform-tools`（含 adb）
- 若缺平台，补装：`sdkmanager "platforms;android-35" "build-tools;35.0.0"`
- 设备：Pixel 已通过 USB 连接，`adb devices` 可见 `46201FDAP007FD`

## 1. 设置环境
```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$ANDROID_HOME/platform-tools:$PATH
cd /Users/Luka/WorkBuddy/life-workbench-native
```

## 2. 构建 + 安装（二选一）

### 方式 A（推荐，最简单）：Expo 驱动
```bash
npx expo run:android --device 46201FDAP007FD
```
会自动 prebuild（如需要）→ 编译 debug → 安装 → 启动。debug 与 release 共用 `applicationId=com.luka.lifeworkbench`，会覆盖当前已装的 V2.0.0。

### 方式 B（Gradle 直连，更可控）
```bash
cd android
# 如遇诡异缓存问题先 clean
./gradlew clean
./gradlew assembleDebug      # 产物: app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug       # 直接装到已连接设备
```

## 3. 启动 + 截图
```bash
# 确保目标 Activity 已启动
adb -s 46201FDAP007FD shell am start -n com.luka.lifeworkbench/.MainActivity
# 截屏保存到本地
adb -s 46201FDAP007FD exec-out screencap -p > ~/Desktop/lwb_notion.png
```

## 4. 验证清单（对照 Notion 风格）
| 位置 | 预期（改后正确） | 反例（未生效/旧构建） |
|------|------------------|------------------------|
| Home 四宫格图标（记账/待办/打卡/速记） | **中性深灰** `#37352F`，非绿色 | 仍为品牌绿/青 |
| 余额卡片 | 白底、扁平、无边框无阴影 | 有边框/阴影 |
| 分隔线 | 极细浅灰 hairline（`theme.divider`） | 粗线 / 暗色下不可见 |
| 底部导航栏 | hairline 描边 + 极轻浮起；中央「+」为深灰药丸 | 明显阴影 |
| 输入框 / 文本域 | 极细灰边 `hairlineWidth + divider` | 1px 粗描边 |
| 选中 Chip / 胶囊 | 仅选中态有极细 outline，未选中无边框 | 选中态粗彩色边 |
| 字体 | Inter（几何感、字重一致） | 系统默认字体 |
| 收入/支出色 | 低饱和青 `#1F8A7A` / 红 `#D66A60`（语义色，保留） | 出现品牌绿 |
| 暗色模式 | 分隔线 `divider` 正确可见 | 分隔线消失 |

## 5. 版本号说明
`android/app/build.gradle` 当前 `versionCode 20000 / versionName "2.0.0"`。
- **仅验证**：debug 构建即可，无需改版本号。
- **正式发布**：发布前请在 `src/version.ts` 按 `V主.次.修订` 递增，并对应 bump `versionCode`（主×10000+次×100+补丁）与 `versionName`，再走 release 签名（需 `MYAPP_RELEASE_*` 环境变量）。

## 6. 排错
- `SDK location not found`：确认 `ANDROID_HOME` 指向含 `platforms` 的 SDK。
- `failed to find target android-35`：`sdkmanager "platforms;android-35"`。
- `hermesc` / 编译失败：确认 `android/gradle.properties` 中 `hermesEnabled=true`（已就位）；不要设成 false（JSC 不支持代码内大量 `??`/`?.`）。
- 安装被拒（INSTALL_FAILED_UPDATE_INCOMPATIBLE）：先 `adb uninstall com.luka.lifeworkbench` 再装。
