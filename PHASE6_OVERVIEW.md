# Phase 6 — 单测与集成验证说明 (Unit Tests & Integration Verification)

Status: **Pure-logic tests + tsc + native compile all GREEN. Version bumped to V1.2.0/10200. Release APK rebuild/install/on-device verification pending — shell tool temporarily unavailable at time of writing; re-run when Bash is back.**

## 1. What was done (Phase 6 test layer)

The notification → quick-bookkeeping pipeline (Phases 1–5) was built as **React-Native-free pure
modules** so the logic can be unit-tested under plain Node. Phase 6 consolidates, extends, and
verifies that test layer.

- `scripts/notify-test-runner.js` — transpiles every pure module + every suite via
  `ts.transpileModule` into a project-local `.tmptest/` tree that **preserves relative import
  structure** (so `require('../money')` / `require('./parsers')` resolve). Runs each suite as an
  isolated Node child process. Added npm script `"test:notify"`.
- `src/notify/__phase6_tests.ts` — 28 assertions for `ingestEnvelope` (happy/dup-skip/no-amount-
  skip/CNY-posted→MYR-pending match linking), `redactForLog`/`maskedPreview`/`safeDigest`
  privacy guarantees, and `fingerprintOf` stability.

## 2. Verification results (logic layer)

| Gate | Command | Result |
|------|---------|--------|
| Pure-logic unit tests | `node scripts/notify-test-runner.js` | **136 assertions, 4/4 suites GREEN** (P2=34, P3=37, P5=37, P6=28) |
| TypeScript | `npx tsc --noEmit` | **0 errors** |
| Native Kotlin | `./gradlew compileReleaseKotlin --no-daemon` | **BUILD SUCCESSFUL** (JDK17 + ANDROID_HOME) |

## 3. On-device integration verification (corrected runbook)

> **Important correction vs. earlier draft:** `NotifyListener` only receives *real*
> `StatusBarNotification`s through `NotificationListenerService.onNotificationPosted`. It does
> **not** react to `am broadcast`. And because of the privacy allowlist (`NotifyConfig.isAllowed`
> → `enabled && !paused && pkg ∈ allowlist`), a synthetic `cmd notification post` is delivered
> under the shell/system UID and will **not** pass the gate. So the listener→pending path can
> only be exercised by (a) a **real** notification from an allowlisted payment app, (b) a
> **rooted** device writing a synthetic envelope to the queue file, or (c) driving the **Phase 5
> quick-add entry points** (Tile / Shortcut / Share / in-app "快速记账"), which need no
> notification at all.

### 3.1 Build & install (release, V1.2.0 — run when shell is back)
```bash
cd life-workbench-native/android
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/Users/Luka/Android/Sdk
./gradlew assembleRelease --no-daemon
adb install -r -f app/build/outputs/apk/release/app-release.apk
```

### 3.2 Grant notification listener access
```bash
# read current listeners, then append ours (do NOT clobber existing ones)
adb shell settings get secure enabled_notification_listeners
adb shell settings put secure enabled_notification_listeners \
  "<existing>:com.luka.lifeworkbench/com.luka.lifeworkbench.notify.NotifyListener"
# confirm it is bound/active
adb shell dumpsys notification | grep -i "com.luka.lifewbench\|Notification listeners" -A3
```
In-app: Settings → Notifications → toggle on; enable at least one payment app in the allowlist
(Phase 4). The listener silently ignores everything else (by design — no log on reject).

### 3.3 Inject a synthetic notification (real mechanism)
```bash
# Posts a REAL notification (StatusBarNotification) the listener CAN receive.
# Package will be the shell/system UID, so it will NOT pass the allowlist gate —
# use only to confirm the listener is wired (see 3.4a). To pass the gate, see 3.4b/3.4c.
adb shell cmd notification post -S 0 -t "Payment" "tag_tng" \
  "Touch n Go" "Payment of RM12.50 at Starbucks successful"
```

### 3.4 Three ways to verify the full pending → confirm → cross-currency match

**(a) Listener-wiring smoke test (no allowlist needed).**
After 3.2 + 3.3, `dumpsys notification` shows our listener bound. A non-allowlisted notification
is received by the OS but dropped by `isAllowed` — this confirms the service is live. (No pending
record is created, which is *correct* privacy behavior.)

**(b) Rooted device — write a synthetic envelope (full pipeline, automated).**
```bash
# become root, write an envelope the JS drain will pick up
adb root
adb shell 'echo "{\"pkg\":\"com.tngdigital.wallet\",\"title\":\"Touch n Go\",\"text\":\"Payment of RM12.50 at Starbucks successful\",\"bigText\":\"\",\"postedAt\":'$(date +%s000)'}" > /data/data/com.luka.lifeworkbench/files/notify_queue.jsonl'
# cross-currency: CNY card spend in MYR (awaiting_posting)
adb shell 'echo "{\"pkg\":\"com.tencent.mm\",\"title\":\"WeChat\",\"text\":\"You spent RM100.00 at UNIQLO\",\"bigText\":\"\",\"postedAt\":'$(date +%s000)'}" >> /data/data/com.luka.lifeworkbench/files/notify_queue.jsonl'
```
The JS drain recognizes amount/merchant, creates **pending** records (never the ledger directly).
Open the confirm screen → merchant `Starbucks` / `RM12.50`, or `UNIQLO` / cross-currency
`predictedSettleMinor ≈ ¥168`. Confirm → exactly **one** expense per notification. Inject the
official CNY posting later → original UNIQLO MYR pending links (`status:'matched'`, `matchOfId`)
and confirming the posting **updates the original Txn** — ledger stays at exactly one expense.

**(c) Phase 5 quick-add (no notification, no root — easiest real-device check).**
- Quick Settings tile **快速记账**; or long-press app icon → shortcuts (expense/income/repayment);
  or Share text from another app → pre-fills `QuickAddScreen` (never auto-books). Each requires
  explicit confirm. This exercises the same `saveQuickAdd` → ledger path the notification confirm
  uses.

### 3.5 Expected invariant
A cross-currency RMB-card spend + its CNY posting = **exactly one expense** in the ledger.
Guarded by `reconcilePostingMatch`, asserted by Phase 3 suite #3 (`matchA: exactly one txn`).

## 4. V1.2.0 release (version bump done; build pending shell)

- `android/app/build.gradle`: `versionCode 10100 → 10200`, `versionName "1.1.0" → "1.2.0"`.
- `app.json`: `version "1.0.0" → "1.2.0"`, `android.versionCode 10000 → 10200` (kept in sync).
- Release signing unchanged: keystore `android-release-key.jks`, alias `lifeworkbench`
  (from `gradle.properties` `MYAPP_RELEASE_*`).
- **Build / install / on-device verification results: PENDING (Bash shell tool unavailable at
  time of writing).** Re-run §3.1 + §3.2 + §3.4 once the shell recovers.

## 5. Files changed this phase
- `android/app/build.gradle` — version bump to 1.2.0 / 10200.
- `app.json` — version bump synced.
- `scripts/notify-test-runner.js` (new, Phase 6) — consolidated runner.
- `src/notify/__phase6_tests.ts` (new, Phase 6) — 28 assertions.
- `package.json` — `test:notify` script.

## 6. Follow-ups (optional)
- Wire `npm run test:notify` into CI.
- Add a fake-timer test for `ingestEnvelope` when a second posting arrives before confirm
  (should still resolve to one expense).
- On-device: complete §3.4b/§3.4c runbook execution once the shell is available.
