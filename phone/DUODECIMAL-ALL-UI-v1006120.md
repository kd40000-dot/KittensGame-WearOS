# Duodecimal coverage fix, v1006120

The signed phone APK `Kittens-Phone-1.6.1-Duodecimal-AllUI-v1006120.apk` expands the v1006119 Draft A implementation to **all visible text nodes on the mobile game screen**, rather than only the two `game.getDisplayValue()` formatters.

## Defect fixed

Year/day headers, queue counts, building count labels, and game log messages were rendered by React from direct decimal values, bypassing the patched game display helpers. For example:

- `Year 24` -> `Year 20` (base 12)
- `day 14` -> `day 12` (base 12)
- `Catnip Field (53)` -> `Catnip Field (45)` (base 12)
- `495 days` -> `353 days` (base 12)

The displayed digits above are transliterations: actual Android presentation uses the private-use Draft A cap/body font already embedded in v1006119.

## Implementation

The bundled `assets/public/phone/duodecimal-phone.js` now additionally installs a `MutationObserver` on `document.body`. Each changed text node is examined for whole decimal numeric tokens, with grouping separators and decimals supported. The full numeric token is converted from decimal to base 12, and each resulting digit is mapped to the existing private-use glyph U+E000..U+E00B. New DOM text is processed on the next animation frame. 

This is display-only. No `input`, `textarea`, `select`, `option`, editable content, scripts, code, save data, or underlying arithmetic is modified. Strings already formatted into custom glyphs have no ASCII digits, so they are not converted twice.

## Known limitations

The Android notification chip is system-rendered and remains outside this DOM conversion. This global text observer has not yet been tested on a physical phone across all Kittens Game menus and may require exceptions for unusual UI strings (e.g. version numbers or identifiers). Avoid interpreting text formatting as save-data changes.

Package: `com.nuclearunicorn.kittensgame`, versionCode `1006120`, versionName `1.6.1`. APK archive integrity passed. Signature verification passed v2/v3 with existing signing certificate SHA-256 `cee878525f494d32a8652178f37697e1e34be015f23b14f67c7db77ecefb76d5`. The signed binary is not committed to GitHub.
