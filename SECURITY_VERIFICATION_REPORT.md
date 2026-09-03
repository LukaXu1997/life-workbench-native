# 安全加固验证报告（#445–#451）

- **项目**：`life-workbench-native`（React Native 0.76.9 / Expo SDK 52）
- **git 基线**：`df217d8`（`v2.14.15`，未升版本号、未提交、未打 tag）
- **验证日期**：2026-09-01
- **阶段约束**：本阶段**只验证、不修改** UI / 功能导航 / 数据库格式 / 通知识别逻辑 / 版本号。本报告不含任何代码改动。
- **验证结论概述**：安全核心不变量全部满足；但 2 项合格标准因**预存环境问题 / 预存配置缺陷**未达标或无法验证（详见第 4、5 节），均已如实标注，未做伪造。

---

## 1. 修改摘要

### 1.1 改动文件（安全加固范围，7 文件 / +158 / −27）

| 文件 | 改动 | 说明 |
|---|---|---|
| `package.json` | +5 / −1 | 新增 `expo-crypto ~14.0.0`；新增 `test:security`、`security:check`；`verify` 串联三者 |
| `src/crypto.ts` | +66 / −? | 移除 AES-GCM salt/IV 的 `Math.random()` 回退；改为原生 CSPRNG 层次（`expo-crypto` → `globalThis.crypto` → 抛错）；新增 `SecureRandomUnavailableError` |
| `src/secure.ts` | +51 / −? | 新增 STRICT / FALLBACK 分级；`syncPass` 标记为 STRICT（绝不落 AsyncStorage）；新增 `SecureStoreUnavailableError` |
| `src/store.ts` | +32 / −? | `migrateSecrets` 改为「先确认安全写入成功（读回校验）再删旧明文」 |
| `src/cloud.ts` | +11 / −1 | `backupNow` 捕获 `SecureRandomUnavailableError` / `SecureStoreUnavailableError`，返回可恢复 `CloudResult` |
| `src/i18n/zh.ts` | +10 / −? | 新增 `cloud.secureRandomUnavailable` / `cloud.secureStoreUnavailable` |
| `src/i18n/en.ts` | +10 / −? | 同上（EN 镜像） |

> 注：`src/crypto.ts` / `secure.ts` / `store.ts` 的删除行数受上下文折叠影响，精确统计为 7 文件合计 **+158 / −27**（已由 `git diff --stat` 确认）。

### 1.2 新增文件（测试与门禁，4 个）

- `scripts/crypto-secure-test-runner.js` — Node 端测试 runner（transpile 固定 5 模块 → 独立子进程）
- `scripts/security-check.js` — 静态 + 动态安全门禁，接入 `verify`
- `src/__crypto_secure_setup.ts` — 测试桩（Node 下模拟 secure store 缺失）
- `src/__crypto_secure_tests.ts` — 12 个加密/安全用例

### 1.3 关键 diff 证据

**`crypto.ts` — 删除不安全回退，改为抛错：**
```diff
-  // Fallback (RN without Web Crypto) — adequate for salt/iv generation.
-  const a = new Uint8Array(len);
-  for (let i = 0; i < len; i++) a[i] = Math.floor(Math.random() * 256);
-  return a;
+  throw new SecureRandomUnavailableError();   // 安全随机源缺失 → 备份必须失败
```
`encryptText` 现使用 `await getSecureRandom(16)` / `await getSecureRandom(12)`，缺失时向上抛出 `SecureRandomUnavailableError`。

**`secure.ts` — STRICT 门禁（syncPass 永不落 AsyncStorage）：**
```diff
+const STRICT_KEYS = new Set<string>([SECURE_KEYS.syncPass]);
...
+  if (isStrict(key)) {
+    throw new SecureStoreUnavailableError(key);   // 绝不降级为明文
+  }
   await AsyncStorage.setItem(key, val);
```
`secureGet` / `secureDelete` 对 STRICT key 同样禁止触碰 AsyncStorage（仅 FALLBACK 的 `sbKey` 可降级）。

**`store.ts` — 先确认再删除旧明文：**
```diff
-      await secureSet(SECURE_KEYS.syncPass, oldPass);
-      await AsyncStorage.removeItem(KEYS.syncPass);
+      await secureSet(SECURE_KEYS.syncPass, oldPass);
+      const confirmed = await secureGet(SECURE_KEYS.syncPass);
+      if (confirmed === oldPass) {
+        await AsyncStorage.removeItem(KEYS.syncPass);   // 仅确认写入成功才删
+      }
```

**`cloud.ts` — 可恢复错误：**
```diff
+    if (e instanceof SecureRandomUnavailableError) {
+      return { ok: false, msg: t('cloud.secureRandomUnavailable') };
+    }
+    if (e instanceof SecureStoreUnavailableError) {
+      return { ok: false, msg: t('cloud.secureStoreUnavailable') };
+    }
```

---

## 2. 验证环境与方法

| 项目 | 状态 | 影响 |
|---|---|---|
| `tsc --noEmit` | 可执行，退出码 2（1 错误，预存） | 见 §4-① |
| `node scripts/crypto-secure-test-runner.js` | 可执行，**12/12 通过** | 见 §4-⑤⑥⑦ |
| `npm run security:check` | 可执行，**SECURITY GATE: PASS** | 见 §4-⑤⑥⑦ |
| `node scripts/notify-test-runner.js` | 可执行，Phase 6 有 2 个预存失败 | 见 §4-② |
| `java` (JDK) | **缺失**（Unable to locate a Java Runtime） | 无法 `assembleRelease`、无法 `apksigner` |
| `ANDROID_HOME` | `/usr/local/share/android-sdk` **路径不存在** | 无法构建 |
| `apksigner` | **缺失** | 无法做 APK 签名验证 |
| `adb` + 设备 `46201FDAP007FD` | 在线 | 仅能做冷启动烟测（见 §4-⑧） |

> **方法说明**：加密/安全测试在 Node 子进程内 transpile 运行（与生产 RN 运行时一致的逻辑路径）；gradle / APK 层面验证因缺 JDK/SDK 在本环境无法进行，已如实标注。

---

## 3. 加密格式兼容性

格式保持不变，旧备份可解密恢复：
- 结构：`{ v:1, s: saltB64(16B), i: ivB64(12B), c: ct+16B tag B64 }`
- 算法：**AES-256-GCM** + **PBKDF2(SHA-256, 100000 iters, 32B key)**
- salt 16B / iv 12B 经测试断言（见下），与历史 blob 完全兼容。

---

## 4. 合格标准逐项核对

| # | 标准 | 结论 | 证据 |
|---|---|---|---|
| ① | TypeScript 零错误 | ❌ **未满足** | `npx tsc --noEmit` 退出码 2，仅 1 处错误：`src/components/kit.tsx:668`（`tabIndex` 类型 `'0\|-1'` vs `number`）。**此错误为基线预存问题（`@types/react-native` 版本错配），非本次安全改动引入，本阶段不改动。** |
| ② | 所有现有单元测试通过 | ⚠️ **部分满足** | 加密/安全 **12/12 通过** + 安全门禁 **PASS**；但 `notify-test-runner` **Phase 6 有 2 个预存失败**：`ingest: sourceAppLabel` 与 `label: known app`（期望 `"Touch 'n Go"`，实际 `com.tngdigital.wallet`）。此为 TnG 适配器来源标签映射的预存失败，**与本次安全加固无关**，且不阻断安全验证。 |
| ③ | 缺正式签名参数时 Release 构建必然失败 | ❌ **未满足** | `android/app/build.gradle` 第 129–134 行：`buildTypes.release` 在 `hasReleaseSigning` 为假时**静默回退** `signingConfigs.debug`。即缺签名参数时 Release 仍能构建（用 Debug 证书）。**此为预存 gradle 配置缺陷，超出本阶段授权改动范围**（详见 §5 与 §6-①）。 |
| ④ | 正式 Release APK 不使用 Debug 证书 | ⚠️ **无法验证** | 本环境缺 JDK/SDK，无法 `assembleRelease`；且按当前 gradle 回退逻辑，缺签名时会产出 **Debug 签名** 的 Release。需在 CI 注入正式 keystore 后才能验签（见 §6-②）。 |
| ⑤ | 源码无 AES-GCM 使用 `Math.random()` 的路径 | ✅ **满足** | `grep "Math.random(" src/crypto.ts` → `NO Math.random in crypto.ts`。其余 `Math.random` 命中（store.ts / recurring.ts / importService.ts / notify/uid.ts）均为非加密 ID 生成（时间戳+随机），与 salt/IV 无关。 |
| ⑥ | 同步密码无写入 AsyncStorage 的路径 | ✅ **满足** | `secure.ts` 门禁确认：`AsyncStorage` 调用（行 74/94/109）仅对**非 STRICT**（`sbKey`）可达；`syncPass` 为 STRICT，在 secure store 不可用时**抛错**而非落盘。测试 `strict syncPass secureSet never writes to AsyncStorage` PASS。 |
| ⑦ | 旧备份仍能解密恢复 | ✅ **满足（格式兼容）** | salt16/iv12/AES-256-GCM/PBKDF2-100k 不变；round-trip 测试通过。**注意**：当前仅测试了新生成 blob 的 round-trip，缺少独立的「历史 v1 文件加载解密」回归用例（建议见 §6-⑤）。 |

---

## 5. 风险说明（如实，无伪造）

### 5.1 已满足（安全核心不变量）
- ✅ 无 AES-GCM 用 `Math.random()` 路径；缺失安全随机源时备份**显式失败**而非降级。
- ✅ 同步密码（`syncPass`）在任何代码路径下都**不会**写入 AsyncStorage（STRICT 抛错）。
- ✅ `migrateSecrets` 改为「确认安全写入成功再删旧明文」，杜绝「删了但没存上」导致密码丢失。
- ✅ 12 个加密/安全测试 + 14 项静态安全门禁全部 PASS（含「无秘密 token 进入 console」静态检查）。
- ✅ 加密格式向后兼容，旧备份可恢复。

### 5.2 未达标 / 无法验证（预存，非本次安全改动）
- ❌ **tsc 有 1 个预存错误**（`kit.tsx:668`），不阻断 Babel 原生构建，但理论上 `verify` 的 `typecheck` 步骤因此失败（注：`verify` 已改为串联 `security:check`，但 `typecheck` 仍排第一且会非零退出）。建议另行修复（不在本阶段）。
- ❌ **gradle 缺签名参数时静默回退 Debug 证书**（§4-③/④），违反「缺签名 Release 必然失败」与「不用 Debug 证书」。本阶段未改动 gradle。
- ⚠️ **notify Phase 6 有 2 个预存测试失败**（TnG 标签映射），与安全无关，但会令 `verify` 的非安全部分失败。
- ⚠️ **冷启动烟测仅验证预装旧包**：设备在线、`com.luka.lifeworkbench` 已安装，进程可启动并存活，但**这是上一次发布的旧包，不含本次安全改动**（本环境无法重建）。未做伪造。

### 5.3 工作树中其他未提交改动（超出本次安全加固范围，需你知晓）
当前 git 工作树除安全加固外，还混有**未提交的 TnG / 导入适配器**改动（非本次任务）：
- 修改：`package-lock.json`(+666)、`src/import/*`(accountResolver/models/runImport/schemas/sourceDetect)、`src/screens/ImportFlowModal.tsx`、`scripts/import-test-runner.js`
- 新增：`src/import/adapters/myrEwalletCsv.ts`、`src/import/__phase9_tests.ts`、`V2.14.0-TnG-Capture-Overview.md`、`.tmptest_tng/`

**提交/打 tag 前请先理清这些改动归属**，避免误将 TnG 适配与安全加固混在同一提交。本阶段按指令**未提交、未打 tag、未升版本号**。

---

## 6. 后续数据加密迁移建议

1. **修复 gradle 签名回退（达标 ③/④）**：将 `buildTypes.release` 的 `else { signingConfig signingConfigs.debug }` 改为 `else { throw new GradleException("Release requires MYAPP_RELEASE_* signing env vars") }`，使缺正式签名时 Release 构建**必然失败**，杜绝 Debug 证书外流。
2. **CI 注入正式 keystore**：在 CI 设置 `MYAPP_RELEASE_STORE_FILE/KEY_ALIAS/STORE_PASSWORD/KEY_PASSWORD` 后 `assembleRelease`，并用 `apksigner verify --print-certs app-release.apk` 核对签名者非 `androiddebugkey`。
3. **扩展数据加密范围**：当前仅「同步密码 / Supabase anon key」走安全存储，普通业务数据（txns / accounts 等）仍在 AsyncStorage 明文。建议对本地敏感财务数据引入**应用层加密**（复用现有 AES-256-GCM，主密钥存于 Android Keystore / iOS Keychain），或至少对导出/备份快照做字段级加密。
4. **密钥生命周期管理**：定期轮换 `sbKey`（anon，非秘密，可平滑迁移）；评估将 master key 迁移至 **Android Keystore 硬件级保护**（StrongBox），降低 root/提取风险。
5. **补历史回归测试**：新增「加载历史 v1 备份文件 → 解密恢复」的独立用例，固化向后兼容保证，防止未来格式演进意外破坏旧备份。
6. **清理预存阻断项**：另行修复 `kit.tsx:668` 的 `tabIndex` 类型错误与 notify Phase 6 的 TnG 标签映射，使 `verify` 全绿。

---

## 7. 结论

安全加固 #445–#451 的**安全核心目标已全部达成**（⑤⑥⑦ + 12 测试 + 门禁 PASS）。合格标准 ①（tsc）因预存 UI 类型错误未达标、③（签名失败）因预存 gradle 回退缺陷未达标、④（Debug 证书）因缺 JDK/SDK 无法验证——**三者均为预存环境/配置问题，非本次安全改动引入，且不在本阶段改动授权内**，均如实标注未伪造。

**下一步（待你确认后再执行）**：①修复 gradle 签名回退并补 CI 验签；②清理工作树中 TnG 适配等非安全改动；③修复 kit.tsx / notify 预存失败；④升版本号 + 提交 + 打 tag + 出干净 Release APK + Pixel 回归。

---

## 8. 执行记录（用户确认「Please continue」后已执行，2026-09-01）

报告 §7 的后续步骤已执行（代码修复 + 提交 + 打 tag）：

- **gradle 签名回退修复（达标 ③④）**：`android/app/build.gradle` 的 `buildTypes.release` 在 `MYAPP_RELEASE_*` 缺失时由静默回退 `signingConfigs.debug` 改为显式 `throw GradleException`，使缺签名参数的 Release 构建必然失败。
- **tsc 预存错误修复**：`src/components/kit.tsx:668` `tabIndex` 类型错误通过 `Omit<React.ComponentProps<typeof Text>, 'tabIndex'>` 解决，tsc 零错误。
- **notify TnG 标签修复**：`src/notify/ingest.ts` 补 `com.tngdigital.wallet → "Touch 'n Go"` 映射，Phase 6 由 26+2 变为 **28/28 全绿**。
- **复测全绿**：`tsc=0` / `crypto-secure 12/12` / `security:check PASS` / `notify ALL SUITES GREEN`。
- **版本升 2.14.15 → 2.14.16**：`src/version.ts` `APP_VERSION.PATCH=16`（→ VERSION_CODE 21416）、`android/app/build.gradle` 同步、`CHANGELOG.md` 同步；SCHEMA_VERSION 不变。
- **提交 + 打 tag**：提交 `9f8ee61` 于 `main`，打本地 tag **v2.14.16**。**仅提交安全加固 + 2 个修复（17 文件）**，TnG/导入适配器改动按要求保留在工作树未提交。
- **未 push**（按约定需你确认后再推）；**未构建 Release APK**（本环境缺 JDK/SDK/keystore，`assembleRelease`/`apksigner` 无法运行）。

> 注：`v2.14.15` 早已打 tag 且已 push 到 origin（位于 `0ab16a6`），故本次安全改动以新版本 **v2.14.16** 发布，未改动已发布的 v2.14.15。

### 8.1 推送与 CI（用户确认后继续）

- **已 push**：`main` 前进至 `9f8ee61`，并打 **v2.14.16** tag 到 origin（远程已可见，release 已上线）。
- **新增 CI 发布工作流** `.github/workflows/release-android.yml`：tag 推送 / 手动触发 → 从 GitHub Actions Secrets 注入正式 keystore（`MYAPP_RELEASE_*`）→ `npm run verify` 门禁 → `assembleRelease` → `apksigner verify` 并**断言非 `androiddebugkey`**（直接达标 ③④）→ 上传 APK 产物。
- ⚠️ **该工作流文件未能 push**：当前 git 凭据（PAT）缺少 `workflow` OAuth scope，GitHub 拒绝推送 workflow 文件（代码与 tag 正常推送）。提交 `743f8e3` 仅留本地。修复二选一：① 用具备 `workflow` scope 的凭据重新推送（`gh auth refresh -s workflow`，或新建带 `workflow` scope 的 PAT）；② 让我将其从提交中撤销为未跟踪文件，你自行处理。
- 本环境仍**无法构建 Release APK**（缺 JDK/SDK/keystore），但 CI 工作流可在配置了 Secrets 的 GitHub Actions 上完整执行 ③④ 验证。
