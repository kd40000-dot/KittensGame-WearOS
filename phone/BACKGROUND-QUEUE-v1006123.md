# Phone background queue: checkpoint and implementation (v1006123)

## Rollback checkpoint (created before implementation)

GitHub branch: `checkpoint-phone-v1006122-before-background-queue` is a frozen copy of `live-sync-realtime` as of 2026-11-14, before background queue work.

Exact installed baseline APK: `Kittens-Phone-1.6.1-Refine-All-v1006122.apk`, SHA-256 `d5a3f27eeada32aad312d159e2ef4beee7df5ecad03c66cf2c069aaf710e4319`. A byte-identical copy `Kittens-Phone-ROLLBACK-Checkpoint-v1006122.apk` is retained separately. Use a normal in-place install of the later version for forward updates. Rolling back Android version codes requires appropriate downgrade support (Android normally blocks installing a lower versionCode over a higher one); **do not uninstall without exporting a save**.

## Implementation

New phone versionCode 1006123 includes a background queue monitor for a running, currently hidden game WebView.

- `phone/background-queue-phone.js`: extracts the *first* queue entry's current effective prices using `game.time.queue.getQueueElementModel()`. Captures every required resource, current amount, cap, and per-second production estimate. Publishes to `kittensTrackerBridge.setQueueSnapshot(JSON.stringify(snapshot))` each second while foregrounded and once upon backgrounding and Live Sync status updates.
- `ResourceTrackerDirectBridge.java`: remembers the MainActivity weakly and provides a read-only background queue snapshot entry point to JavaScript. On request it locates the existing WebView under that Activity and calls `evaluateJavascript('window.KittensBackgroundQueue.runIfDue("native")')` on its UI thread. No Activity is brought to foreground.
- `ResourceTrackerService.java`: the existing persistent status-bar notification foreground service checks the projected balances for **all** requirements once per second, even if its status chip is showing only one resource. It requests the JavaScript queue pass when projected balances meet the first item's prices; it backs off at least 12s between signals. It does not write game saves or create its own simulation and it retains the existing cat notification icon.
- The JS execution path checks that the game is backgrounded and the phone still owns the session. When Live Sync is configured, it calls the current Cloudflare session `GET /api/session/:id/state` with the configured device token and **fails closed unless the server confirms phone ownership**. It invokes `game.time.calculateRedshift()`, `game.time.queue.update()`, and `game.save()`; then publishes a fresh queue state and invokes `KittensLiveSyncPhone.commitNow()`.
- `assets/public/index.html` and `index-mobile.html` load `phone/background-queue-phone.js`.
- This is compatible with game version 1.6.1 and preserves the custom Dracula/Vietnamese, paired Live Sync, dozenal glyphs, refine-all button, and existing notification.
- Requirement: status bar resource tracking must be enabled so the foreground service is running. If the app is foregrounded, the game's regular update loop handles queue purchases instead.

## Safety and limitations

Android's WebView may be frozen, and the host Activity/WebView may be destroyed while backgrounded even though the foreground service survives. In either case, the monitor **cannot safely execute a hidden purchase**; normal offline queue redshift will catch up on reopening. No guarantee of execution at the exact projected second when Android suspends JavaScript. This is an incremental *in-process* background execution path, not a new headless game engine.

The trigger's constant-rate estimates can differ from actual resources when weather, production, storage, costs or automation change. The original game engine and server-ownership verification are authoritative; the Android service never spends directly.

When Live Sync is configured but Cloudflare cannot be contacted, background purchases intentionally do not proceed. They may catch up when the game opens. This avoids duplicate spending while the watch is owner.

## Tests / build checks

Compiled Android 36 native Java via GitHub Actions `Build Phone Resource Tracker Native Patch`, with latest class DEX artifact produced from the current service + bridge sources. Node VM simulation exercised the display-to-native queue snapshot (including two distinct resources), positive phone ownership, watch ownership denial, mirror denial, standalone mode, and foreground denial. APK rebuilt with apktool, zipaligned, signed with the existing private certificate (SHA-256 `cee878525f494d32a8652178f37697e1e34be015f23b14f67c7db77ecefb76d5`), and verified v2/v3 signature and ZIP integrity. Device-side background JavaScript execution requires physical testing.

v1006123 APK SHA-256 `8fac538bd8b870a0866b23f148d9d118c3c34aeb590299a6229878868ba0b4ea`.

## Fast rollback without uninstalling

An additional APK `Kittens-Phone-ROLLBACK-PreBackgroundQueue-v1006124.apk` contains the pre-feature 1006122 application assets and native DEX byte-for-byte unchanged, except that its Android manifest versionCode is **1006124** so it can install over the background-queue test build (1006123) without Android rejecting a downgrade. Same signing certificate; no uninstall or clearing saved data required. Rollback APK SHA-256: `2598235650b200532c21078776e5e6d12b7746f3d751d8e44e61dd4f90db9281`.

The v1006123 background executor now explicitly calls `KittensResourceTracker.sync(true)` after saving a purchase to update the Android status-bar counter from the actual new resource balance.
