(function(global){
  'use strict';

  const clone=v=>JSON.parse(JSON.stringify(v));

  function branchChanged(branch){
    return !!(branch && Array.isArray(branch.entries) && branch.entries.length);
  }

  function validateBranch(branch, canonical){
    if(!branch) return {ok:true};
    if(branch.baseRevision !== canonical.revision){
      return {ok:false,reason:'base-revision-mismatch',deviceId:branch.deviceId,expected:canonical.revision,actual:branch.baseRevision};
    }
    return {ok:true};
  }

  function snapshotTime(branch){
    return Number(branch && branch.snapshot && branch.snapshot.capturedAt)
      || Number(branch && branch.snapshotCapturedAt)
      || 0;
  }

  function reconcile(canonical, branches){
    if(!canonical || !canonical.save || canonical.revision == null) throw new Error('Canonical checkpoint is incomplete.');
    const active=(branches||[]).filter(branchChanged);
    if(active.length===0) return {ok:true,type:'no-op',canonical,mergedSave:clone(canonical.save),applied:[]};

    const current=active.filter(b=>b.baseRevision===canonical.revision);
    const stale=active.filter(b=>b.baseRevision!==canonical.revision);

    // A current-revision snapshot may carry passive progress. A stale snapshot is
    // never used as the carrier because the canonical save already contains changes
    // committed after that branch's common ancestor. Stale branches contribute
    // their explicit action journal only.
    const snapshotBranches=current.filter(b=>b.snapshot&&b.snapshot.save);
    let base=clone(canonical.save),carrier=null;
    if(snapshotBranches.length){
      carrier=snapshotBranches.slice().sort((a,b)=>{
        const timeDiff=snapshotTime(b)-snapshotTime(a);
        return timeDiff||String(a.deviceId).localeCompare(String(b.deviceId));
      })[0];
      base=clone(carrier.snapshot.save);
    }

    const replay=active
      .filter(b=>b!==carrier)
      .map(b=>({deviceId:b.deviceId,entries:b.entries}));

    if(!replay.length){
      return {
        ok:true,type:carrier?'fast-forward-snapshot':'fast-forward',
        canonical,mergedSave:base,carrierDeviceId:carrier&&carrier.deviceId,
        staleDevices:stale.map(b=>b.deviceId),
        applied:active.map(b=>({deviceId:b.deviceId,count:b.entries.length}))
      };
    }

    const result=global.KittensPlanA.merge(base,replay);
    if(!result.ok){
      return {
        ok:false,type:'merge-conflict',canonical,conflicts:result.conflicts,
        carrierDeviceId:carrier&&carrier.deviceId,
        staleDevices:stale.map(b=>b.deviceId),
        applied:active.map(b=>({deviceId:b.deviceId,count:b.entries.length}))
      };
    }
    return {
      ok:true,type:stale.length?'merged-stale':'merged',
      canonical,mergedSave:result.merged,
      carrierDeviceId:carrier&&carrier.deviceId,
      staleDevices:stale.map(b=>b.deviceId),
      applied:active.map(b=>({deviceId:b.deviceId,count:b.entries.length}))
    };
  }

  function makeRevision(previous, mergedSave, deviceHeads, sha256, now){
    const time=now||Date.now();
    const short=(sha256||'pending').slice(0,16);
    return {
      schema:1,
      revision:String(time)+'-'+short,
      parentRevision:previous&&previous.revision||null,
      createdAt:time,
      sha256:sha256||null,
      save:mergedSave,
      mergedFrom:(deviceHeads||[]).map(h=>({
        deviceId:h.deviceId,
        baseRevision:h.baseRevision,
        lastSeq:h.lastSeq||0,
        batchIds:h.batchIds||[],
        snapshotPath:h.snapshotPath||null,
        snapshotCapturedAt:h.snapshotCapturedAt||null
      }))
    };
  }

  global.KittensPlanAOrchestrator={reconcile,makeRevision,validateBranch};
})(window);
