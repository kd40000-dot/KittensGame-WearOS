(function(global){
  'use strict';

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

  function reconcile(canonical, branches){
    if(!canonical || !canonical.save || canonical.revision == null) throw new Error('Canonical checkpoint is incomplete.');
    const active=(branches||[]).filter(branchChanged);
    for(const branch of active){
      const v=validateBranch(branch,canonical);
      if(!v.ok) return {ok:false,type:'stale-branch',conflicts:[v],canonical};
    }
    if(active.length===0) return {ok:true,type:'no-op',canonical,mergedSave:canonical.save,applied:[]};

    const mergeBranches=active.map(b=>({deviceId:b.deviceId,entries:b.entries}));
    const result=global.KittensPlanA.merge(canonical.save,mergeBranches);
    if(!result.ok){
      return {
        ok:false,
        type:'merge-conflict',
        canonical,
        conflicts:result.conflicts,
        applied:active.map(b=>({deviceId:b.deviceId,count:b.entries.length}))
      };
    }
    return {
      ok:true,
      type:active.length===1?'fast-forward':'merged',
      canonical,
      mergedSave:result.merged,
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
        batchIds:h.batchIds||[]
      }))
    };
  }

  global.KittensPlanAOrchestrator={reconcile,makeRevision,validateBranch};
})(window);
