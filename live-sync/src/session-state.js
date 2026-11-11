export const LEASE_MS = 15000;

export function canTakeOwnership(meta, deviceId, now = Date.now()) {
  if (!meta.ownerDeviceId) return true;
  if (meta.ownerDeviceId === deviceId) return true;
  return Number(meta.leaseUntil || 0) <= now;
}

export function nextRevision(meta, deviceId, saveText, now = Date.now()) {
  return {
    ...meta,
    revision: Number(meta.revision || 0) + 1,
    ownerDeviceId: deviceId,
    leaseUntil: now + LEASE_MS,
    updatedAt: now,
    saveText
  };
}

export function normalizeResources(resources) {
  if (!Array.isArray(resources)) return [];
  return resources
    .filter(r => r && typeof r.name === "string" && r.name)
    .map(r => ({
      name: String(r.name),
      title: r.title == null ? String(r.name) : String(r.title),
      value: Number.isFinite(Number(r.value)) ? Number(r.value) : 0,
      max: Number.isFinite(Number(r.max)) ? Number(r.max) : 0,
      rate: Number.isFinite(Number(r.rate)) ? Number(r.rate) : 0
    }));
}

export function liveEnvelope(meta, resources, now = Date.now()) {
  return {
    type: "live",
    revision: Number(meta.revision || 0),
    ownerDeviceId: meta.ownerDeviceId || null,
    serverTime: now,
    resources: normalizeResources(resources)
  };
}

function nearlyEqual(a, b, relative = 1e-6, absolute = 1e-4) {
  const scale = Math.max(1, Math.abs(Number(a) || 0), Math.abs(Number(b) || 0));
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= Math.max(absolute, scale * relative);
}

function projectedValue(resource, fromTime, toTime) {
  const seconds = Math.max(0, (Number(toTime) - Number(fromTime)) / 1000);
  let value = (Number(resource.value) || 0) + (Number(resource.rate) || 0) * seconds;
  const max = Number(resource.max) || 0;
  if (max > 0) value = Math.min(max, value);
  return Math.max(0, value);
}

// Persist only discontinuities (spends, crafts, cap/rate/resource-set changes).
// Ordinary production is reconstructable from value + rate + serverTime and
// therefore does not require a Durable Object storage write every 500 ms.
export function shouldPersistLive(previous, next) {
  if (!previous || !Array.isArray(previous.resources)) return true;
  if (!next || !Array.isArray(next.resources)) return false;
  if ((previous.ownerDeviceId || null) !== (next.ownerDeviceId || null)) return true;
  if (previous.resources.length !== next.resources.length) return true;

  const old = new Map(previous.resources.map(r => [r.name, r]));
  for (const resource of next.resources) {
    const before = old.get(resource.name);
    if (!before) return true;
    if (!nearlyEqual(before.max, resource.max, 1e-8, 1e-6)) return true;
    if (!nearlyEqual(before.rate, resource.rate, 1e-6, 1e-7)) return true;
    const expected = projectedValue(before, previous.serverTime, next.serverTime);
    if (!nearlyEqual(expected, resource.value, 1e-5, 1e-3)) return true;
  }
  return false;
}

export function publicState(meta) {
  return {
    revision: Number(meta.revision || 0),
    ownerDeviceId: meta.ownerDeviceId || null,
    leaseUntil: Number(meta.leaseUntil || 0),
    updatedAt: Number(meta.updatedAt || 0),
    initialized: !!meta.initialized
  };
}

// A legacy watch release means "app hidden", not "transfer ownership".
// Its final save should be recorded without clearing the canonical owner.
export function retainLegacyWearOwner(deviceId, explicitRelease) {
  return deviceId === "watch" && explicitRelease !== true;
}
