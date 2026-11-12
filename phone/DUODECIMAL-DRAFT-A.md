# Draft A duodecimal display in Kittens Game phone (v1006119)

The manually repacked, signed phone APK `Kittens-Phone-1.6.1-Duodecimal-DraftA-v1006119.apk` is based on `v1006118` and signed with the existing Dracula/Vietnamese signing identity.

- All calls to the game instance's `getDisplayValue` and `getDisplayValueExt` now produce **base-12** numeric presentations, with the original resource/crafting arithmetic and saves untouched.
- `K`, `M`, `G`, ... refer to powers of **12³**, not decimal thousands.
- Uses the exact Draft A modular glyph geometries from `kd40000-dot/math-workout-duodecimal` `app/src/main/java/com/duodecimal/workout/Numerals.java`.
- The glyphs are packaged as `assets/public/phone/duo-draft-a.ttf` with custom Unicode private-use code points U+E000..U+E00B and are painted via a scoped @font-face in `assets/public/phone/duodecimal-phone.js`. Digits: body=digit%4, cap=digit%3, with body 3 based on the regular-weight U+218B outline.
- Both `assets/public/index.html` and `assets/public/index-mobile.html` load `phone/duodecimal-phone.js` after the tracker JavaScript.
- Version code 1006119, minimum 24, target 36.
- Native Android resource chip has NOT yet been converted. Android's system-drawn short-critical text cannot simply use an app-local private-use font; additional native implementation is needed.
- Raw numeric counters not routed through the game's display-formatting methods are also not converted in this first pass.
- Verified APK v2/v3 signing (certificate SHA256 `cee878525f494d32a8652178f37697e1e34be015f23b14f67c7db77ecefb76d5`), zip integrity, NodeJS syntax and sample base-12 conversions.

## Rebuild note
Repacking the original customized APK requires preserving its private keystore outside GitHub. Do not commit or distribute signing keys. Generate the display font from the same shapes as the workout app's `Numerals.java`, then add the two phone assets and script tags and increment `apktool.yml` versionCode.
