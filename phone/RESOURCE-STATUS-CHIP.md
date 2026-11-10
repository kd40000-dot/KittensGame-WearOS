# Android status-bar resource tracker

Phone build feature added after Live Sync complication work.

## Behavior

- Options -> **Status bar resource** lets the user select any currently unlocked/visible Kittens resource, or Off.
- The selected resource is sampled from the real Kittens `resPool` while the app is active.
- Android runs `ResourceTrackerService` as a foreground special-use service so the tracker survives when the WebView/activity is backgrounded.
- The service updates once per second using the last exact value plus the current per-second rate, clamped to the resource cap.
- Android 16/API 36 requests promoted ongoing / Live Update treatment and sets `shortCriticalText` to the abbreviated resource amount, allowing a Liftosaur-like status-bar chip.
- Normal accent: Dracula purple `#BD93F9`.
- At cap: Dracula green `#50FA7B`.
- Tapping the notification opens Kittens Game.
- Options contains a **Live Update settings** link.
- The tracker resumes after process restart/package replacement where Android permits the foreground-service start.

## Native source

- `phone/resource-tracker-native/src/com/nuclearunicorn/kittensgame/ResourceTrackerPlugin.java`
- `phone/resource-tracker-native/src/com/nuclearunicorn/kittensgame/ResourceTrackerService.java`
- `phone/resource-tracker-native/src/com/nuclearunicorn/kittensgame/ResourceTrackerBootReceiver.java`
- `phone/resource-tracker-phone.js`
- `.github/workflows/build-phone-resource-tracker-native.yml`

The native patch is compiled as a separate DEX and registered through `assets/capacitor.plugins.json`.

## Android manifest additions

- `android.permission.POST_PROMOTED_NOTIFICATIONS`
- `android.permission.FOREGROUND_SERVICE_SPECIAL_USE`
- foreground service type `specialUse` with the resource-tracker subtype.

## Physical caveat

Android/OEM System UI controls whether a promotable ongoing notification is actually promoted to the status-bar chip and exactly how its accent color is rendered. The app requests promotion and supplies the short critical text, but the user can disable Live Updates for the app.

When the Kittens WebView is backgrounded, the native service projects from the most recently supplied value/rate. If the true Kittens production rate changes while the WebView is suspended (for example due to a game-state transition not known natively), the display can diverge until the app resumes and supplies a fresh exact snapshot.

## APK integration and diagnostic checklist

The native tracker DEX build and the phone JavaScript asset export are **not** a complete installable phone APK.
The actual customized Android 1.6.1 phone APK must be repacked with all of the following together:

1. `phone/resource-tracker-phone.js` loaded in the game's WebView.
2. `ResourceTrackerPlugin`, `ResourceTrackerService`, and `ResourceTrackerBootReceiver` compiled into an installed APK DEX (not only a CI artifact).
3. `assets/capacitor.plugins.json` containing a `classpath` entry for `com.nuclearunicorn.kittensgame.ResourceTrackerPlugin`; ensure the Capacitor bridge actually loads it.
4. The service and boot receiver declarations, foreground-service permission/type, and `POST_PROMOTED_NOTIFICATIONS` in the APK's merged Android manifest.
5. Notifications allowed for the app and resource-tracker channel; Live Updates enabled where supported.

If Options reports **"Promotion status: Could not read native status"**, it does **not** demonstrate that Live Updates were denied: the JavaScript status call itself failed. The tracker runtime now reports `errorMessage`, `bridgePresent`, `pluginPresent`, and `statusMethodPresent` to distinguish:

- `bridgePresent=false`: native Capacitor bridge unavailable in the running WebView.
- `pluginPresent=false`: tracker DEX/Capacitor registration absent from the installed APK.
- `statusMethodPresent=false`: installed native plugin predates the `status()` method.
- All present, but `error=true`: inspect `errorMessage` and Android logcat for the thrown native error.
- Native `status()` works but `activeFound=false`: investigate foreground-service startup/notification permissions.
- `activeFound=true` but `activePromoted=false`: inspect `canPostPromoted`, `lastPromotable`, channel importance, and system Live Update settings.

The settings UI must show `errorMessage` instead of always collapsing failures to "Could not read native status". Do not display a selected resource as successfully enabled unless the native `start()` call resolves. Keep the existing phone package identity and signing key when producing a new APK; otherwise Android will reject an in-place upgrade.

## Native launch-page regression fixed (v1006111)

The v1006110 APK displayed `Promotion status: Tracker JavaScript is missing.` despite containing `assets/public/phone/resource-tracker-phone.js`. Root cause: the native Capacitor shell loads `assets/public/index.html`, but the APK reconstruction had injected the phone scripts only in `assets/public/index-mobile.html`. Both pages load `mobile/jsx/popups/options.jsx.js`, so the option row was visible while the tracker global was undefined.

Fix: inject the full phone script bundle in **both** `index.html` and `index-mobile.html`. Use `phone/patch-resource-tracker-entry.py` when repacking future phone APKs. Verify that the signed APK contains both script tags and native registration. The recovered v1006111 APK is signed with the existing custom phone certificate; Android Live Update promotion itself still requires physical-device testing.

## Direct native bridge and background production (v1006112)

Physical report from v1006111: the Options popup was able to find the tracker JavaScript but displayed `Native KittensResourceTracker method "status" is unavailable`. The APK's `classes3.dex` does contain the native `status` method, and `assets/capacitor.plugins.json` registers the plugin. This isolates the failure to the generated JavaScript `Capacitor.Plugins` proxy exposing an incomplete method set, rather than a missing Java class.

The tracker now uses `Capacitor.nativePromise('KittensResourceTracker', method, payload)`, which is supported by the Android shell's `assets/native-bridge.js` and sends calls directly to Android's registered plugin. A simulated bridge test verified the direct `status`, `start`, `update` and `stop` round trips with no `Capacitor.Plugins` methods available.

The snapshot calculation also no longer uses `game.isPaused` to force production to zero: the mobile app sets that flag on ordinary Activity backgrounding, yet resource production continues as part of the game's offline mechanics. In the background the foreground service extrapolates from the last exact value/rate; changes on the watch or other game-state transitions will not be reflected exactly until the phone receives and processes an updated state. Android retains control of whether the otherwise ongoing notification is promoted into a status-bar Live Update chip.

This implementation was statically checked in the repacked, signed v1006112 APK with both HTML entry points, the native tracker DEX and Capacitor plugin registration present. Physical-device notification promotion still needs verification.
