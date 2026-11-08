import { DurableObject } from "cloudflare:workers";
import { LEASE_MS, canTakeOwnership, nextRevision, liveEnvelope, publicState } from "./session-state.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-device-id,x-device-token"
};

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...headers }
});

async function sha256(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}

function randomPairCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, "0");
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/health") {
      return json({ ok: true, service: "kittens-live-sync", version: 1 });
    }

    const bootstrap = url.pathname.match(/^\/api\/session\/([^/]+)\/bootstrap$/);
    if (bootstrap && request.method === "POST") {
      const id = env.KITTENS_SESSION.idFromName(decodeURIComponent(bootstrap[1]));
      return env.KITTENS_SESSION.get(id).fetch(request);
    }

    const pair = url.pathname.match(/^\/api\/session\/([^/]+)\/pair$/);
    if (pair && request.method === "POST") {
      const id = env.KITTENS_SESSION.idFromName(decodeURIComponent(pair[1]));
      return env.KITTENS_SESSION.get(id).fetch(request);
    }

    const state = url.pathname.match(/^\/api\/session\/([^/]+)\/state$/);
    if (state && request.method === "GET") {
      const id = env.KITTENS_SESSION.idFromName(decodeURIComponent(state[1]));
      return env.KITTENS_SESSION.get(id).fetch(request);
    }

    const ws = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (ws) {
      const id = env.KITTENS_SESSION.idFromName(decodeURIComponent(ws[1]));
      return env.KITTENS_SESSION.get(id).fetch(request);
    }

    const claim = url.pathname.match(/^\/api\/pair\/([^/]+)\/claim$/);
    if (claim && request.method === "POST") {
      const id = env.PAIR_REGISTRY.idFromName("global");
      const forward = new Request(new URL("/claim/" + encodeURIComponent(claim[1]), request.url), request);
      return env.PAIR_REGISTRY.get(id).fetch(forward);
    }

    return json({ ok: false, error: "not-found" }, 404);
  }
};

export class PairRegistry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/register") {
      const body = await readJson(request);
      if (!body.code || !body.sessionId || !body.deviceToken || !body.expiresAt) {
        return json({ ok: false, error: "invalid-pair-registration" }, 400);
      }
      await this.ctx.storage.put("pair:" + body.code, {
        sessionId: body.sessionId,
        deviceToken: body.deviceToken,
        expiresAt: body.expiresAt
      });
      return json({ ok: true });
    }

    const claim = url.pathname.match(/^\/claim\/([^/]+)$/);
    if (request.method === "POST" && claim) {
      const key = "pair:" + claim[1];
      const entry = await this.ctx.storage.get(key);
      if (!entry || Number(entry.expiresAt || 0) < Date.now()) {
        if (entry) await this.ctx.storage.delete(key);
        return json({ ok: false, error: "pair-code-invalid-or-expired" }, 404);
      }
      await this.ctx.storage.delete(key);
      return json({ ok: true, sessionId: entry.sessionId, deviceToken: entry.deviceToken });
    }

    return json({ ok: false, error: "not-found" }, 404);
  }
}

export class KittensSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async meta() {
    return (await this.ctx.storage.get("meta")) || {
      initialized: false,
      revision: 0,
      ownerDeviceId: null,
      leaseUntil: 0,
      updatedAt: 0,
      saveText: null
    };
  }

  async putMeta(meta) {
    await this.ctx.storage.put("meta", meta);
  }

  async validateDevice(deviceId, token) {
    if (!deviceId || !token) return false;
    const stored = await this.ctx.storage.get("token:" + deviceId);
    return !!stored && stored === await sha256(token);
  }

  async issueDeviceToken(deviceId) {
    const token = randomToken();
    await this.ctx.storage.put("token:" + deviceId, await sha256(token));
    return token;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const meta = await this.meta();

    if (request.method === "POST" && url.pathname.endsWith("/bootstrap")) {
      const body = await readJson(request);
      const sessionId = decodeURIComponent(url.pathname.split("/")[3] || "");
      const adminSecret = bearer(request) || body.adminSecret || "";
      if (!adminSecret || !body.saveText) return json({ ok: false, error: "missing-secret-or-save" }, 400);

      const adminHash = await sha256(adminSecret);
      const existingAdminHash = await this.ctx.storage.get("adminHash");
      if (existingAdminHash && existingAdminHash !== adminHash) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      if (!existingAdminHash) await this.ctx.storage.put("adminHash", adminHash);
      const deviceId = body.deviceId || "phone";
      let deviceToken = body.deviceToken || "";
      if (!(await this.validateDevice(deviceId, deviceToken))) {
        deviceToken = await this.issueDeviceToken(deviceId);
      }

      let next = meta;
      if (!meta.initialized) {
        next = {
          initialized: true,
          revision: 1,
          ownerDeviceId: deviceId,
          leaseUntil: Date.now() + LEASE_MS,
          updatedAt: Date.now(),
          saveText: body.saveText
        };
        await this.putMeta(next);
      }

      return json({ ok: true, sessionId, deviceId, deviceToken, state: publicState(next) });
    }

    if (request.method === "POST" && url.pathname.endsWith("/pair")) {
      const body = await readJson(request);
      const sessionId = decodeURIComponent(url.pathname.split("/")[3] || "");
      const deviceId = body.deviceId || "phone";
      const token = body.deviceToken || "";
      if (!(await this.validateDevice(deviceId, token))) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      const code = randomPairCode();
      const watchToken = await this.issueDeviceToken("watch");
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const registryId = this.env.PAIR_REGISTRY.idFromName("global");
      const registration = await this.env.PAIR_REGISTRY.get(registryId).fetch("https://pair.local/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, sessionId, deviceToken: watchToken, expiresAt })
      });
      if (!registration.ok) return json({ ok: false, error: "pair-registry-failed" }, 500);
      return json({ ok: true, code, expiresAt });
    }

    if (request.method === "GET" && url.pathname.endsWith("/state")) {
      const deviceId = request.headers.get("x-device-id") || "";
      const token = request.headers.get("x-device-token") || "";
      if (!(await this.validateDevice(deviceId, token))) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      return json({ ok: true, state: publicState(meta) });
    }

    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ authed: false, deviceId: null });
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ ok: false, error: "not-found" }, 404);
  }

  socketsFor(deviceId) {
    return this.ctx.getWebSockets().filter(ws => {
      try {
        const a = ws.deserializeAttachment() || {};
        return a.authed && a.deviceId === deviceId;
      } catch { return false; }
    });
  }

  send(ws, value) {
    try { ws.send(JSON.stringify(value)); } catch {}
  }

  broadcast(value, except = null) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment() || {};
      if (a.authed) this.send(ws, value);
    }
  }

  async grant(deviceId, ws, meta, reason = "claim") {
    const next = { ...meta, ownerDeviceId: deviceId, leaseUntil: Date.now() + LEASE_MS, updatedAt: Date.now() };
    await this.putMeta(next);
    this.send(ws, {
      type: "control-granted",
      reason,
      revision: next.revision,
      ownerDeviceId: deviceId,
      leaseUntil: next.leaseUntil,
      saveText: next.saveText
    });
    this.broadcast({ type: "owner-changed", ownerDeviceId: deviceId, revision: next.revision, leaseUntil: next.leaseUntil }, ws);
    return next;
  }

  async webSocketMessage(ws, message) {
    let data;
    try { data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); }
    catch { return this.send(ws, { type: "error", error: "invalid-json" }); }

    let attachment = ws.deserializeAttachment() || { authed: false, deviceId: null };

    if (!attachment.authed) {
      if (data.type !== "auth" || !(await this.validateDevice(data.deviceId, data.deviceToken))) {
        this.send(ws, { type: "auth-failed" });
        try { ws.close(1008, "unauthorized"); } catch {}
        return;
      }
      attachment = { authed: true, deviceId: data.deviceId };
      ws.serializeAttachment(attachment);
      const meta = await this.meta();
      this.send(ws, {
        type: "welcome",
        state: publicState(meta),
        saveText: Number(data.lastRevision || 0) === Number(meta.revision || 0) ? null : meta.saveText
      });
      return;
    }

    const deviceId = attachment.deviceId;
    let meta = await this.meta();

    if (data.type === "claim") {
      if (canTakeOwnership(meta, deviceId)) {
        await this.grant(deviceId, ws, meta, meta.ownerDeviceId === deviceId ? "renew" : "claim");
        return;
      }

      const ownerSockets = this.socketsFor(meta.ownerDeviceId);
      if (!ownerSockets.length) {
        this.send(ws, { type: "owner-offline", ownerDeviceId: meta.ownerDeviceId, leaseUntil: meta.leaseUntil });
        return;
      }

      await this.ctx.storage.put("pendingClaim", { deviceId, requestedAt: Date.now() });
      ownerSockets.forEach(ownerWs => this.send(ownerWs, { type: "handoff-request", requestedBy: deviceId }));
      this.send(ws, { type: "handoff-wait", ownerDeviceId: meta.ownerDeviceId });
      return;
    }

    if (data.type === "handoff-state") {
      if (meta.ownerDeviceId !== deviceId || !data.saveText) return;
      meta = nextRevision(meta, deviceId, data.saveText);
      await this.putMeta(meta);
      const pending = await this.ctx.storage.get("pendingClaim");
      if (!pending || !pending.deviceId) return;
      await this.ctx.storage.delete("pendingClaim");
      const claimant = this.socketsFor(pending.deviceId)[0];
      if (!claimant) return;
      const previousOwner = deviceId;
      meta = await this.grant(pending.deviceId, claimant, meta, "handoff");
      this.socketsFor(previousOwner).forEach(oldWs => this.send(oldWs, {
        type: "control-revoked",
        ownerDeviceId: pending.deviceId,
        revision: meta.revision
      }));
      return;
    }

    if (data.type === "commit") {
      if (meta.ownerDeviceId !== deviceId) {
        this.send(ws, { type: "not-owner", ownerDeviceId: meta.ownerDeviceId });
        return;
      }
      if (!data.saveText) return;
      meta = nextRevision(meta, deviceId, data.saveText);
      await this.putMeta(meta);
      this.send(ws, { type: "commit-ack", revision: meta.revision, leaseUntil: meta.leaseUntil });
      this.broadcast({ type: "remote-commit", revision: meta.revision, ownerDeviceId: deviceId }, ws);
      return;
    }

    if (data.type === "live") {
      if (meta.ownerDeviceId !== deviceId) return;
      meta = { ...meta, leaseUntil: Date.now() + LEASE_MS };
      await this.putMeta(meta);
      this.broadcast(liveEnvelope(meta, data.resources), ws);
      return;
    }

    if (data.type === "heartbeat") {
      if (meta.ownerDeviceId === deviceId) {
        meta = { ...meta, leaseUntil: Date.now() + LEASE_MS };
        await this.putMeta(meta);
        this.send(ws, { type: "heartbeat-ack", leaseUntil: meta.leaseUntil, revision: meta.revision });
      }
      return;
    }

    if (data.type === "release") {
      if (meta.ownerDeviceId === deviceId) {
        if (data.saveText) meta = nextRevision(meta, deviceId, data.saveText);
        meta = { ...meta, ownerDeviceId: null, leaseUntil: 0, updatedAt: Date.now() };
        await this.putMeta(meta);
        this.send(ws, { type: "release-ack", revision: meta.revision });
        this.broadcast({ type: "owner-changed", ownerDeviceId: null, revision: meta.revision }, ws);
      }
      return;
    }

    if (data.type === "force-claim") {
      meta = await this.grant(deviceId, ws, { ...meta, ownerDeviceId: null, leaseUntil: 0 }, "forced");
      return;
    }
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment() || {};
    if (!attachment.authed) return;
    const meta = await this.meta();
    if (meta.ownerDeviceId === attachment.deviceId) {
      // Keep the short lease after disconnect. The other device can take over
      // automatically once it expires, avoiding accidental split-brain.
      await this.putMeta({ ...meta, updatedAt: Date.now() });
    }
  }
}
