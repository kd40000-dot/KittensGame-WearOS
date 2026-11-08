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

export function liveEnvelope(meta, resources, now = Date.now()) {
  return {
    type: "live",
    revision: Number(meta.revision || 0),
    ownerDeviceId: meta.ownerDeviceId || null,
    serverTime: now,
    resources: Array.isArray(resources) ? resources : []
  };
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
