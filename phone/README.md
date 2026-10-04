# Phone build baseline

The phone-side companion is the native Android Kittens Game 1.6.1 APK customized with:

- Dracula theme
- Vietnamese language
- Watch Sync controls in `assets/public/mobile/jsx/popups/export.jsx.js`
- Capacitor native HTTP enabled in `assets/capacitor.config.json`
- Android cleartext LAN traffic explicitly permitted for the local watch transfer path
- persistent custom signing identity

Current known-working phone APK SHA-256:

`fc1b151c50aedc8b862c5bd0779512c8a0d3e8bf68e60727c6491d5441974c6d`

The binary APK is intentionally not committed here. Plan A work should keep the Dracula/Vietnamese payload unchanged and modify only the sync layer.

## Plan A integration point

The same reusable `sync/plan-a-core.js` used by Wear will be injected into the phone web runtime. The phone will use device id `phone`, record before/after save deltas, and use the native Android HTTP path for both LAN and GitHub HTTPS traffic.

GitHub credentials must be stored in Android-protected local storage and must never be embedded in JavaScript assets or committed to this repository.
