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
