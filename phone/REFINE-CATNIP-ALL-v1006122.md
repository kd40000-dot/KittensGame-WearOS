# Phone: Refine catnip — All (v1006122)

The installed phone APK based on Kittens Game 1.6.1 (Dracula + Vietnamese + Plan A/Live Sync + Draft A duodecimal) now includes an **All** control beside **Refine catnip** on the Bonfire tab. The regular Refine catnip action is unchanged.

## Files patched in `assets/public`

1. `js/buildings.js`, next to `refineCatnip`: add `game.bld.refineCatnipAll()`. Calculate `cost = advancedRefinement.researched ? 50 : 100`; `count = Math.floor(catnip.value/cost)`. If count is zero, show `craft.msg.notEnoughCatnip`. Otherwise spend `count*cost` catnip via `resPool.addResEvent`, grant `count*(1+game.getResCraftRatio("wood"))` wood via `resPool.addResEvent`, and create one undo entry with `metaId:"wood"`, `resGainedAmt`, `resSpent:[{name:"catnip",val:count*cost}]`, mirroring `RefineCatnipButtonController.handleX100Click`. Return the number of batches.
2. `mobile/jsx/tabs/buildings.jsx.js`: add `refineAll:true` to the existing `WSimpleButton` with `key:"refineCatnip"`.
3. `mobile/jsx/widgets/widgets.jsx.js`: only when `this.props.refineAll`, render a second 54x40px **All** anchor inside the same button row, positioned to the right with Dracula colors. Its click handler prevents navigation/bubbling, calls `game.bld.refineCatnipAll()`, and animates/updates if the return value is positive. The original button is padded so the buttons do not overlap.

Use `/mnt/data/kittens_refine_work/patch.py` only as a transient build reference; it is not part of the committed repo. Repeat the above modifications in any fresh decoded APK. Increment `apktool.yml` to 1006122, build with apktool, zipalign, sign with the *existing* private PKCS12 signing key (not committed), and verify v2/v3 signatures.

## Verified behavior

- 19,999 catnip, normal refinement: 199 batches, 199 wood (before bonuses), 99 catnip left.
- 19,999 catnip, Advanced Refinement: 399 batches, 399 wood, 49 catnip left.
- 49 catnip, Advanced Refinement: no action.
- One batch with a 25% wood bonus yields 1.25 wood.
- 10,050 catnip, normal refinement, 40% bonus: 100 batches, 140 wood, 50 catnip left.

All positive cases produce one undo event, with the correct catnip expense. This is a display/game action only; normal save format and duodecimal display remain unchanged.

Signed APK `Kittens-Phone-1.6.1-Refine-All-v1006122.apk` SHA-256:
`d5a3f27eeada32aad312d159e2ef4beee7df5ecad03c66cf2c069aaf710e4319`

Signing certificate SHA-256: `cee878525f494d32a8652178f37697e1e34be015f23b14f67c7db77ecefb76d5`.

Archive integrity, JavaScript syntax and v2/v3 APK signing all verified. Physical-device UI and input handling have not been tested.
