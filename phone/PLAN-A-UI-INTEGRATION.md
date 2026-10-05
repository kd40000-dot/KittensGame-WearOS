# Phone Plan A UI integration

## Important: do not monkey-patch `WExportPopup` after `React.createClass()`

The first physical Plan A phone APK bundled `phone/plan-a-ui.js` after the existing
`WExportPopup = React.createClass({...})` definition. Although the Plan A code was
present inside `assets/public/mobile/jsx/popups/export.jsx.js`, the old React
`createClass` implementation keeps internal/autobound method references. Replacing
methods on `WExportPopup.prototype` afterward did not reliably affect the actual
Export popup instance.

Observed physical-device result:

- existing **Watch Sync** controls were visible;
- **Plan A + GitHub** controls were absent.

## Required packaging method

Plan A must be integrated directly into the `WExportPopup` class specification
before the APK is signed:

1. Extend `getInitialState()` with:
   - `planAToken`
   - `planAStatus`
   - `planABusy`
2. Extend `componentDidMount()` to initialize `KittensPlanAPhone` and subscribe to
   `kittens-plan-a-status`.
3. Add `componentWillUnmount()` cleanup.
4. Render the **Plan A + GitHub** section directly in the Export popup after
   **Watch Sync** and before **Text Export**.
5. Define the Plan A handlers directly on the `React.createClass` spec:
   - `_planATokenChange`
   - `_planASaveToken`
   - `_planAInitialize`
   - `_planAAdopt`
   - `_planAProvisionWatch`
   - `_planASyncNow`
6. Do not append the old runtime prototype-patching `plan-a-ui.js` IIFE.

The corrected physical-test APK uses this direct integration and retains the same
persistent signing certificate as the Dracula/Vietnamese build.

Corrected APK SHA-256:

`a0c26c295e880f148a085aedaaa6f701251ebf9ada846dec9edb8d75a6e95b85`
