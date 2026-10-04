# Plan A + GitHub sync

This branch implements the offline-first merge model for the Kittens Game phone and Wear OS builds.

## Core rules

1. The last successful canonical sync is the common ancestor.
2. Each device remains fully playable offline.
3. Every user interaction is observed as a before/after game-save pair.
4. If the save changes, the change is journaled. Numeric changes are stored as deltas; incompatible non-numeric replacements become conflicts.
5. Connected devices may exchange full snapshots over the existing LAN transport for low latency.
6. GitHub is the durable mailbox/history layer when the devices are apart.
7. A divergent phone/watch pair is merged from the common ancestor plus both journals.
8. A merge that would make a resource negative or has incompatible set operations is not silently accepted; the UI asks which branch/action should win.
9. After reconciliation, both devices receive the exact same canonical save and journal history is compacted into a new checkpoint.

## Proposed private sync repository layout

```
canonical/
  head.json
  revisions/<revision-id>.json
devices/
  phone/
    head.json
    events/<batch-id>.json
  watch/
    head.json
    events/<batch-id>.json
```

Event files are append-only and uniquely named, so the phone and watch do not normally edit the same GitHub object. Device head files point to the newest batch. `canonical/head.json` identifies the last agreed revision and its save checksum.

## Merge behavior

If only one device advanced from the common revision, that branch becomes canonical.

If both advanced, the Plan A core replays both journals over the common ancestor. Numeric deltas compose naturally. If applying an action would make a Kittens resource negative, or if two branches changed the same non-numeric path to incompatible values, the merge is marked conflicted.

## Security

The application code lives in the public `KittensGame-WearOS` repository, but actual saves and journals should live in a separate **private** repository. A fine-grained GitHub token must be restricted to that repository and given only Contents read/write permission. It must never be committed to either repository or embedded in an APK.

The phone will store the token in Android-protected local storage. The watch can receive the credential/config through the already-authenticated local LAN pairing flow so the token never needs to be typed on the watch.
