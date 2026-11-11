import test from "node:test";
import assert from "node:assert/strict";
import { LEASE_MS, canTakeOwnership, nextRevision, liveEnvelope, shouldPersistLive, retainLegacyWearOwner } from "../src/session-state.js";

test("same device can renew ownership", () => {
  assert.equal(canTakeOwnership({ ownerDeviceId: "watch", leaseUntil: 999999 }, "watch", 10), true);
});

test("other device cannot steal a live lease", () => {
  assert.equal(canTakeOwnership({ ownerDeviceId: "watch", leaseUntil: 1000 }, "phone", 500), false);
});

test("other device can take an expired lease", () => {
  assert.equal(canTakeOwnership({ ownerDeviceId: "watch", leaseUntil: 1000 }, "phone", 1001), true);
});

test("commit increments revision and renews lease", () => {
  const next = nextRevision({ revision: 7 }, "phone", "SAVE", 100);
  assert.equal(next.revision, 8);
  assert.equal(next.ownerDeviceId, "phone");
  assert.equal(next.saveText, "SAVE");
  assert.equal(next.leaseUntil, 100 + LEASE_MS);
});

test("live snapshots do not change canonical revision", () => {
  const env = liveEnvelope({ revision: 9, ownerDeviceId: "watch" }, [{ name: "catnip", value: 42 }], 123);
  assert.equal(env.revision, 9);
  assert.equal(env.ownerDeviceId, "watch");
  assert.equal(env.resources[0].value, 42);
});


test("passive production does not require persisted live-state writes", () => {
  const before = liveEnvelope(
    { revision: 9, ownerDeviceId: "phone" },
    [{ name: "catnip", title: "Catnip", value: 100, max: 1000, rate: 2 }],
    1000
  );
  const projected = liveEnvelope(
    { revision: 9, ownerDeviceId: "phone" },
    [{ name: "catnip", title: "Catnip", value: 102, max: 1000, rate: 2 }],
    2000
  );
  assert.equal(shouldPersistLive(before, projected), false);
});

test("spends and rate/cap changes persist immediately", () => {
  const before = liveEnvelope(
    { revision: 9, ownerDeviceId: "phone" },
    [{ name: "catnip", value: 100, max: 1000, rate: 2 }],
    1000
  );
  const spent = liveEnvelope(
    { revision: 9, ownerDeviceId: "phone" },
    [{ name: "catnip", value: 50, max: 1000, rate: 2 }],
    2000
  );
  const rate = liveEnvelope(
    { revision: 9, ownerDeviceId: "phone" },
    [{ name: "catnip", value: 102, max: 1000, rate: 3 }],
    2000
  );
  const cap = liveEnvelope(
    { revision: 9, ownerDeviceId: "phone" },
    [{ name: "catnip", value: 102, max: 1200, rate: 2 }],
    2000
  );
  assert.equal(shouldPersistLive(before, spent), true);
  assert.equal(shouldPersistLive(before, rate), true);
  assert.equal(shouldPersistLive(before, cap), true);
});

test("backgrounding legacy watch retains ownership; explicit release does not", () => {
  assert.equal(retainLegacyWearOwner("watch", undefined), true);
  assert.equal(retainLegacyWearOwner("watch", false), true);
  assert.equal(retainLegacyWearOwner("watch", true), false);
  assert.equal(retainLegacyWearOwner("phone", undefined), false);
});
