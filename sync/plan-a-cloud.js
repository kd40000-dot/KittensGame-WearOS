(function(global){
  'use strict';

  const DEVICES=['phone','watch'];

  async function sha256(text){
    const bytes=new TextEncoder().encode(text);
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  function create(opts){
    const deviceId=opts.deviceId;
    const planA=opts.planA;
    const mailbox=opts.mailbox;
    const getSave=opts.getSave;
    const applySave=opts.applySave;
    const storage=opts.storage||localStorage;
    if(!DEVICES.includes(deviceId))throw new Error('Unknown Plan A device: '+deviceId);
    if(!planA||!mailbox||!getSave)throw new Error('Plan A cloud engine is missing required adapters.');

    const stateKey='kittens.planA.cloud.'+deviceId;
    function loadState(){
      try{return JSON.parse(storage.getItem(stateKey)||'{}');}catch(e){return {};}
    }
    function saveState(s){storage.setItem(stateKey,JSON.stringify(s));return s;}
    function maxSeq(entries){return entries.reduce((m,e)=>Math.max(m,Number(e.seq)||0),0);}

    let privacyChecked=false;
    async function ensurePrivate(){if(!privacyChecked){await mailbox.verifyPrivate();privacyChecked=true;}}

    async function readCanonicalRevision(){
      const head=await mailbox.readCanonical();
      if(!head)return null;
      const path=head.json.revisionPath||('canonical/revisions/'+head.json.revision+'.json');
      const revision=await mailbox.readRevision(path);
      if(!revision)throw new Error('Canonical head points to missing revision '+path);
      return {head,revision:revision.json,path};
    }

    async function bootstrapFromLocal(){
      await ensurePrivate();
      const existing=await readCanonicalRevision();
      if(existing)return {created:false,...existing};

      const save=JSON.parse(JSON.stringify(getSave()));
      const hash=await sha256(JSON.stringify(save));
      const revision=global.KittensPlanAOrchestrator.makeRevision(null,save,[],hash,Date.now());
      const written=await mailbox.writeRevision(revision);
      const head={
        schema:1,
        revision:revision.revision,
        revisionPath:written.path,
        sha256:hash,
        updatedAt:Date.now()
      };
      const advanced=await mailbox.updateCanonical(head,null);
      if(advanced.conflict){
        return {created:false,...await readCanonicalRevision()};
      }

      await mailbox.updateDeviceHead(deviceId,{
        schema:1,deviceId,baseRevision:revision.revision,lastSeq:0,
        pendingBatches:[],updatedAt:Date.now()
      });
      planA.clearJournal();
      await planA.checkpoint(save);
      saveState({baseRevision:revision.revision,lastPublishedSeq:0,lastAppliedRevision:revision.revision});
      return {created:true,head:{json:head,sha:advanced.contentSha},revision,path:written.path};
    }

    async function publishLocal(){
      await ensurePrivate();
      const state=loadState();
      if(!state.baseRevision){
        const canonical=await readCanonicalRevision();
        if(!canonical)return {ok:false,type:'needs-bootstrap'};
        return {ok:false,type:'needs-adoption',canonicalRevision:canonical.revision.revision};
      }

      const all=planA.journal();
      const entries=all.filter(e=>(Number(e.seq)||0)>(Number(state.lastPublishedSeq)||0));
      if(!entries.length)return {ok:true,type:'no-op',published:0};

      const first=entries[0].seq,last=entries.at(-1).seq;
      const capturedAt=Date.now();
      const publicationId=deviceId+'-'+first+'-'+last+'-'+capturedAt;
      const snapshotSave=JSON.parse(JSON.stringify(getSave()));
      const snapshotHash=await sha256(JSON.stringify(snapshotSave));
      const batch={
        schema:1,
        id:publicationId,
        deviceId,
        baseRevision:state.baseRevision,
        createdAt:capturedAt,
        firstSeq:first,lastSeq:last,
        entries
      };
      const snapshot={
        schema:1,
        id:publicationId,
        deviceId,
        baseRevision:state.baseRevision,
        capturedAt,
        lastSeq:last,
        sha256:snapshotHash,
        save:snapshotSave
      };
      const appended=await mailbox.appendBatch(deviceId,batch);
      const snapped=await mailbox.appendSnapshot(deviceId,snapshot);
      const current=await mailbox.readDeviceHead(deviceId);
      const currentHead=current&&current.json;
      if(currentHead&&currentHead.baseRevision!==state.baseRevision){
        return {ok:false,type:'device-head-rebased',current:currentHead,batchPath:appended.path,snapshotPath:snapped.path};
      }
      const pending=[...new Set([...(currentHead&&currentHead.pendingBatches||[]),appended.path])];
      const next={
        schema:1,deviceId,baseRevision:state.baseRevision,
        lastSeq:last,pendingBatches:pending,
        snapshotPath:snapped.path,snapshotCapturedAt:capturedAt,snapshotSha256:snapshotHash,
        updatedAt:Date.now()
      };
      const updated=await mailbox.updateDeviceHead(deviceId,next,current&&current.sha);
      if(updated.conflict)return {ok:false,type:'device-head-race',batchPath:appended.path,snapshotPath:snapped.path};

      state.lastPublishedSeq=last;
      saveState(state);
      return {ok:true,type:'published',published:entries.length,batchPath:appended.path,snapshotPath:snapped.path,lastSeq:last};
    }

    async function loadBranches(canonicalRevision){
      const branches=[];
      const headReads={};
      for(const id of DEVICES){
        const h=await mailbox.readDeviceHead(id);
        headReads[id]=h;
        if(!h||!h.json||!(h.json.pendingBatches||[]).length)continue;
        const entries=[];
        for(const path of h.json.pendingBatches){
          const b=await mailbox.readBatch(path);
          if(!b)throw new Error('Missing event batch '+path);
          entries.push(...(b.json.entries||[]));
        }
        let snapshot=null;
        if(h.json.snapshotPath){
          const s=await mailbox.readSnapshot(h.json.snapshotPath);
          if(!s)throw new Error('Missing device snapshot '+h.json.snapshotPath);
          if(s.json.baseRevision!==h.json.baseRevision)throw new Error('Snapshot base revision does not match device head.');
          snapshot=s.json;
        }
        branches.push({
          deviceId:id,
          baseRevision:h.json.baseRevision,
          lastSeq:h.json.lastSeq||maxSeq(entries),
          batchIds:h.json.pendingBatches.slice(),
          snapshotPath:h.json.snapshotPath||null,
          snapshotCapturedAt:h.json.snapshotCapturedAt||snapshot&&snapshot.capturedAt||0,
          snapshot,
          entries
        });
      }
      return {branches,headReads};
    }

    async function reconcileCloud(){
      await ensurePrivate();
      const canonical=await readCanonicalRevision();
      if(!canonical)return {ok:false,type:'needs-bootstrap'};

      const loaded=await loadBranches(canonical.revision);
      const result=global.KittensPlanAOrchestrator.reconcile(canonical.revision,loaded.branches);
      if(!result.ok)return result;
      if(result.type==='no-op')return {ok:true,type:'no-op',canonical:canonical.revision};

      const mergedSave=result.mergedSave;
      const hash=await sha256(JSON.stringify(mergedSave));
      const revision=global.KittensPlanAOrchestrator.makeRevision(
        canonical.revision,
        mergedSave,
        loaded.branches.map(b=>({
          deviceId:b.deviceId,baseRevision:b.baseRevision,lastSeq:b.lastSeq,batchIds:b.batchIds,
          snapshotPath:b.snapshotPath,snapshotCapturedAt:b.snapshotCapturedAt
        })),
        hash,
        Date.now()
      );
      const written=await mailbox.writeRevision(revision);
      const nextHead={
        schema:1,revision:revision.revision,revisionPath:written.path,
        sha256:hash,parentRevision:canonical.revision.revision,updatedAt:Date.now()
      };
      const advanced=await mailbox.updateCanonical(nextHead,canonical.head.sha);
      if(advanced.conflict)return {ok:false,type:'canonical-race',retry:true};

      const ack=[];
      for(const b of loaded.branches){
        const read=loaded.headReads[b.deviceId];
        const next={
          schema:1,deviceId:b.deviceId,baseRevision:revision.revision,
          lastSeq:b.lastSeq,acknowledgedSeq:b.lastSeq,pendingBatches:[],
          snapshotPath:null,snapshotCapturedAt:null,snapshotSha256:null,updatedAt:Date.now()
        };
        const a=await mailbox.updateDeviceHead(b.deviceId,next,read&&read.sha);
        ack.push({deviceId:b.deviceId,ok:!a.conflict});
      }
      return {ok:true,type:result.type,revision,canonicalHead:nextHead,ack};
    }

    async function adoptCanonical(){
      await ensurePrivate();
      const canonical=await readCanonicalRevision();
      if(!canonical)return {ok:false,type:'needs-bootstrap'};
      if(applySave)await applySave(canonical.revision.save);
      planA.clearJournal();
      await planA.checkpoint(canonical.revision.save);
      const previous=await mailbox.readDeviceHead(deviceId);
      const lastSeq=previous&&previous.json&&previous.json.lastSeq||0;
      const next={
        schema:1,deviceId,baseRevision:canonical.revision.revision,lastSeq,
        acknowledgedSeq:lastSeq,pendingBatches:[],updatedAt:Date.now()
      };
      const updated=await mailbox.updateDeviceHead(deviceId,next,previous&&previous.sha);
      if(updated.conflict)return {ok:false,type:'device-head-race',retry:true};
      saveState({baseRevision:canonical.revision.revision,lastPublishedSeq:0,lastAppliedRevision:canonical.revision.revision});
      return {ok:true,type:'adopted',revision:canonical.revision};
    }

    async function pullCanonical(){
      await ensurePrivate();
      const canonical=await readCanonicalRevision();
      if(!canonical)return {ok:false,type:'needs-bootstrap'};
      const state=loadState();
      if(state.lastAppliedRevision===canonical.revision.revision)return {ok:true,type:'already-current',revision:canonical.revision};

      const localPending=planA.journal().filter(e=>(Number(e.seq)||0)>(Number(state.lastPublishedSeq)||0));
      if(localPending.length)return {ok:false,type:'local-unpublished-actions',count:localPending.length};

      if(applySave)await applySave(canonical.revision.save);
      planA.clearJournal();
      await planA.checkpoint(canonical.revision.save);
      saveState({
        ...state,
        baseRevision:canonical.revision.revision,
        lastAppliedRevision:canonical.revision.revision,
        lastPublishedSeq:0
      });
      return {ok:true,type:'applied',revision:canonical.revision};
    }

    return {bootstrapFromLocal,adoptCanonical,publishLocal,reconcileCloud,pullCanonical,readCanonicalRevision,loadState};
  }

  global.KittensPlanACloud={create};
})(window);
