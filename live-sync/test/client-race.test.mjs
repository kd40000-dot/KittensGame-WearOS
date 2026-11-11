import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../sync/live-sync-client.js", import.meta.url), "utf8");

function harness(deviceId = "phone") {
  const storage = new Map();
  const sockets = [];
  const timers = new Map();
  let timerSeq = 1;

  class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor(url) {
      this.url = url;
      this.readyState = MockWebSocket.CONNECTING;
      this.sent = [];
      sockets.push(this);
    }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }

  const window = {
    dispatchEvent() {},
    addEventListener() {},
  };
  const document = {
    hidden: true,
    addEventListener() {},
  };
  const context = {
    window,
    document,
    WebSocket: MockWebSocket,
    CustomEvent: class { constructor(type, init) { this.type=type; this.detail=init?.detail; } },
    localStorage: {
      getItem(k) { return storage.has(k) ? storage.get(k) : null; },
      setItem(k,v) { storage.set(k,String(v)); },
      removeItem(k) { storage.delete(k); },
    },
    console,
    URL,
    encodeURIComponent,
    TextEncoder,
    TextDecoder,
    Promise,
    setTimeout(fn, ms) { const id=timerSeq++; timers.set(id,{fn,ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id=timerSeq++; timers.set(id,{fn,ms,interval:true}); return id; },
    clearInterval(id) { timers.delete(id); },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const client = context.window.KittensLiveSync.create({
    deviceId,
    getSaveText: async () => "SAVE",
    applySaveText: async () => {},
    getResources: () => [],
    applyLiveResources() {},
    setWritable() {},
    onStatus() {},
  });
  client.setConfig({
    endpoint:"https://kittens-live-sync.alike-fog.workers.dev",
    sessionId:"test-session",
    deviceToken:"token"
  });
  client.connect();
  const ws=sockets.at(-1);
  ws.readyState=MockWebSocket.OPEN;
  ws.onopen();
  return { context, document, client, ws, sockets, timers };
}

async function deliver(ws, value) {
  ws.onmessage({data:JSON.stringify(value)});
  await new Promise(resolve => setImmediate(resolve));
}

test("owner-changed to this device repairs a stale mirror socket", async () => {
  const h=harness("phone");
  await deliver(h.ws,{type:"welcome",state:{revision:4,ownerDeviceId:"watch",leaseUntil:999999}});
  assert.equal(h.client.getRole(),"mirror");

  h.ws.sent.length=0;
  await deliver(h.ws,{type:"owner-changed",ownerDeviceId:"phone",revision:5,leaseUntil:999999});

  assert.equal(h.client.getRole(),"claiming");
  assert.ok(h.ws.sent.some(m => m.type==="claim"),"current socket must refresh its own grant");
});

test("stale local role refreshes before answering a handoff request", async () => {
  const h=harness("phone");
  await deliver(h.ws,{type:"welcome",state:{revision:4,ownerDeviceId:"watch",leaseUntil:999999}});
  assert.equal(h.client.getRole(),"mirror");

  h.ws.sent.length=0;
  await deliver(h.ws,{type:"handoff-request",requestedBy:"watch"});
  assert.ok(h.ws.sent.some(m => m.type==="claim"),"stale owner socket should request a canonical refresh");
  assert.ok(!h.ws.sent.some(m => m.type==="handoff-state"),"must not flush possibly stale state before refresh");

  h.ws.sent.length=0;
  await deliver(h.ws,{type:"control-granted",revision:5,ownerDeviceId:"phone",leaseUntil:999999,saveText:"CANONICAL"});
  assert.ok(h.ws.sent.some(m => m.type==="handoff-state" && m.saveText==="SAVE"),"handoff should continue after canonical refresh");
});

test("handoff-wait cannot remain stuck forever", async () => {
  const h=harness("phone");
  await deliver(h.ws,{type:"welcome",state:{revision:4,ownerDeviceId:"watch",leaseUntil:999999}});
  h.document.hidden=false;
  h.client.claim();
  h.ws.sent.length=0;
  await deliver(h.ws,{type:"handoff-wait",ownerDeviceId:"watch"});

  assert.equal(h.client.getRole(),"claiming");
  assert.ok([...h.timers.values()].some(t => t.ms===1400),"handoff wait should schedule a retry");
});


test("reset release publishes the exact post-reset save and waits for acknowledgement", async () => {
  const h=harness("phone");
  await deliver(h.ws,{type:"welcome",state:{revision:5,ownerDeviceId:"phone",leaseUntil:999999}});
  assert.equal(h.client.getRole(),"owner");

  h.ws.sent.length=0;
  const released=h.client.releaseSaveText("POST_RESET_SAVE",10000);

  assert.equal(h.client.getRole(),"releasing");
  assert.ok(
    h.ws.sent.some(m => m.type==="release" && m.saveText==="POST_RESET_SAVE"),
    "reset must publish the exact supplied post-reset save"
  );
  assert.ok(
    !h.ws.sent.some(m => m.type==="release" && m.saveText==="SAVE"),
    "reset must not fall back to the old in-memory game save"
  );

  await deliver(h.ws,{type:"release-ack",revision:6});
  const ack=await released;

  assert.equal(ack.revision,6);
  assert.equal(h.client.getLastRevision(),6);
  assert.equal(h.client.getRole(),"mirror");
});

test("visible reconnect automatically requests phone ownership without a click", async () => {
  const h=harness("phone");
  h.document.hidden=true;
  await deliver(h.ws,{type:"welcome",state:{revision:4,ownerDeviceId:"watch",leaseUntil:999999}});
  assert.equal(h.client.getRole(),"mirror");
  h.document.hidden=false;
  // A reconnect must claim even if firstWelcome has already been consumed.
  h.client.disconnect();
  h.client.connect();
  const ws=h.sockets.at(-1);
  ws.readyState=1;
  ws.onopen();
  await deliver(ws,{type:"welcome",state:{revision:4,ownerDeviceId:"watch",leaseUntil:999999}});
  assert.ok([...h.timers.values()].some(t=>t.ms===50), "visible reconnect schedules automatic claim");
});
