import test from "node:test";
import assert from "node:assert/strict";
import { LEASE_MS, canTakeOwnership, nextRevision, liveEnvelope } from "../src/session-state.js";

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
