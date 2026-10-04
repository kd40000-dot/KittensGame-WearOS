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
    for(const branch of active){
      const v=validateBranch(branch,canonical);
      if(!v.ok) return {ok:false,type:'stale-branch',conflicts:[v],canonical};
    }
    if(active.length===0) return {ok:true,type:'no-op',canonical,mergedSave:clone(canonical.save),applied:[]};

    // A branch snapshot contains that device's complete present state, including passive
    // production and all of its own journalled actions. Prefer the newest snapshot as
    // the passive-state carrier, then replay only the other device's actions onto it.
    const snapshotBranches=active.filter(b=>b.snapshot&&b.snapshot.save);
    if(snapshotBranches.length){
      const carrier=snapshotBranches.slice().sort((a,b)=>{
        const timeDiff=snapshotTime(b)-snapshotTime(a);
        return timeDiff||String(a.deviceId).localeCompare(String(b.deviceId));
      })[0];
      const others=active.filter(b=>b!==carrier).map(b=>({deviceId:b.deviceId,entries:b.entries}));
      const base=clone(carrier.snapshot.save);
      if(!others.length){
        return {
          ok:true,type:'fast-forward-snapshot',canonical,mergedSave:base,
          carrierDeviceId:carrier.deviceId,
          applied:active.map(b=>({deviceId:b.deviceId,count:b.entries.length}))
        };
      }
      const result=global.KittensPlanA.merge(base,others);
      if(!result.ok){
        return {
          ok:false,type:'merge-conflict',canonical,conflicts:result.conflicts,
          carrierDeviceId:carrier.deviceId,
          applied:active.map(b=>({deviceId:b.deviceId,count:b.entries.length}))
        };
      }
      return {
        ok:true,type:'merged',canonical,mergedSave:result.merged,
        carrierDeviceId:carrier.deviceId,
        applied:active.map(b=>({deviceId:b.deviceId,count:b.entries.length}))
      };
    }

    // Compatibility fallback for branches published by an older Plan A client.
    const mergeBranches=active.map(b=>({deviceId:b.deviceId,entries:b.entries}));
    const result=global.KittensPlanA.merge(clone(canonical.save),mergeBranches);
    if(!result.ok){
      return {
        ok:false,type:'merge-conflict',canonical,conflicts:result.conflicts,
        applied:active.map(b=>({deviceId:b.deviceId,count:b.entries.length}))
      };
    }
    return {
      ok:true,type:active.length===1?'fast-forward':'merged',
      canonical,mergedSave:result.merged,
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
