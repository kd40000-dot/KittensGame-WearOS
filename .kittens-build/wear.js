(function(global){
  'use strict';
  const SCHEMA=1;
  const PREFIX='kittens.planA.';
  const clone=v=>JSON.parse(JSON.stringify(v));
  const escPathPart=s=>String(s).replace(/~/g,'~0').replace(/\//g,'~1');
  const unescPathPart=s=>String(s).replace(/~1/g,'/').replace(/~0/g,'~');
  const splitPath=p=>p===''?[]:p.slice(1).split('/').map(unescPathPart);
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function getAt(root,path){
    let cur=root; for(const part of splitPath(path)){ if(cur==null)return undefined; cur=cur[Array.isArray(cur)?Number(part):part]; } return cur;
  }
  function setAt(root,path,value){
    const parts=splitPath(path); if(!parts.length)return value;
    let cur=root;
    for(let i=0;i<parts.length-1;i++){const k=Array.isArray(cur)?Number(parts[i]):parts[i];cur=cur[k];}
    const last=Array.isArray(cur)?Number(parts.at(-1)):parts.at(-1);cur[last]=value;return root;
  }
  function isVolatilePath(path){return path==='/time/timestamp'||path==='/game/colorScheme'||path==='/game/unlockedSchemes'||path.startsWith('/game/unlockedSchemes/');}
  function diff(before,after,path='',ops=[]){
    if(isVolatilePath(path))return ops;
    if(same(before,after))return ops;
    if(typeof before==='number'&&typeof after==='number'&&Number.isFinite(before)&&Number.isFinite(after)){
      ops.push({op:'delta',path,from:before,delta:after-before,to:after});return ops;
    }
    if(Array.isArray(before)&&Array.isArray(after)&&before.length===after.length){
      for(let i=0;i<before.length;i++)diff(before[i],after[i],path+'/'+i,ops);return ops;
    }
    if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
      const keys=new Set([...Object.keys(before),...Object.keys(after)]);
      for(const k of keys){
        if(!(k in before)||!(k in after)){ops.push({op:'set',path:path+'/'+escPathPart(k),from:clone(before[k]),value:clone(after[k])});}
        else diff(before[k],after[k],path+'/'+escPathPart(k),ops);
      }
      return ops;
    }
    ops.push({op:'set',path,from:clone(before),value:clone(after)});return ops;
  }
  function isResourceValuePath(path){return /\/resources\/\d+\/value$/.test(path);}
  function applyOps(base,ops,conflicts,entry){
    let out=base;
    for(const op of ops){
      const current=getAt(out,op.path);
      if(op.op==='delta'){
        if(typeof current!=='number'||!Number.isFinite(current)){conflicts.push({entry,path:op.path,reason:'target-not-number',current,op});continue;}
        const next=current+op.delta;
        if(isResourceValuePath(op.path)&&next<-1e-9){conflicts.push({entry,path:op.path,reason:'resource-would-go-negative',current,next,op});continue;}
        out=setAt(out,op.path,next);
      }else if(op.op==='set'){
        if(!same(current,op.from)&&!same(current,op.value)){conflicts.push({entry,path:op.path,reason:'set-conflict',current,op});continue;}
        out=setAt(out,op.path,clone(op.value));
      }
    }
    return out;
  }
  function merge(common,branches){
    const entries=[].concat(...branches.map(b=>(b.entries||[]).map(e=>({...e,deviceId:e.deviceId||b.deviceId}))));
    entries.sort((a,b)=>(a.time-b.time)||String(a.deviceId).localeCompare(String(b.deviceId))||(a.seq-b.seq));
    let merged=clone(common);const conflicts=[];
    for(const entry of entries)merged=applyOps(merged,entry.ops||[],conflicts,entry);
    return {ok:conflicts.length===0,merged,conflicts,entriesApplied:entries.length};
  }
  async function digest(text){
    if(global.crypto&&crypto.subtle){
      const bytes=new TextEncoder().encode(text),hash=await crypto.subtle.digest('SHA-256',bytes);
      return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
    }
    let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return 'fnv1a-'+(h>>>0).toString(16);
  }
  function key(device,suffix){return PREFIX+device+'.'+suffix;}
  function read(device,suffix,fallback){try{const v=localStorage.getItem(key(device,suffix));return v?JSON.parse(v):fallback;}catch(e){return fallback;}}
  function write(device,suffix,value){localStorage.setItem(key(device,suffix),JSON.stringify(value));}
  function create(opts){
    const deviceId=opts.deviceId;
    const getSave=opts.getSave;
    const onEntry=opts.onEntry;
    let seq=Number(read(deviceId,'seq',0))||0,armed=false,before=null;
    async function checkpoint(save){
      const s=clone(save||getSave()),text=JSON.stringify(s);
      const cp={schema:SCHEMA,deviceId,time:Date.now(),sha256:await digest(text),save:s};
      write(deviceId,'checkpoint',cp);return cp;
    }
    function journal(){return read(deviceId,'journal',[]);}
    function clearJournal(){write(deviceId,'journal',[]);}
    function discardThrough(seq){
      seq=Number(seq)||0;
      const kept=journal().filter(e=>(Number(e.seq)||0)>seq);
      write(deviceId,'journal',kept);
      return kept.length;
    }
    async function record(label,b,a){
      const ops=diff(b,a);if(!ops.length)return null;
      const entry={schema:SCHEMA,deviceId,seq:++seq,time:Date.now(),label:label||'interaction',ops};
      const j=journal();j.push(entry);if(j.length>1000)j.splice(0,j.length-1000);
      write(deviceId,'seq',seq);write(deviceId,'journal',j);
      if(onEntry){try{Promise.resolve(onEntry(entry)).catch(function(e){console.warn('Plan A onEntry failed',e);});}catch(e){console.warn('Plan A onEntry failed',e);}}
      return entry;
    }
    function arm(label){
      if(armed)return;armed=true;before=clone(getSave());
      const finish=async()=>{try{const after=clone(getSave());await record(label,before,after);}finally{armed=false;before=null;}};
      if(typeof queueMicrotask==='function')queueMicrotask(finish);else Promise.resolve().then(finish);
    }
    function runAction(label,fn,ctx,args){
      const beforeState=clone(getSave());
      let result;
      try{result=fn.apply(ctx||null,args||[]);}
      finally{
        try{record(label,beforeState,clone(getSave()));}
        catch(e){console.warn('Plan A action record failed',e);}
      }
      return result;
    }
    function attach(){
      document.addEventListener('click',e=>{
        const t=e.target&&e.target.closest?e.target.closest('button,a,.btn,.button'):null;
        arm(t?(t.textContent||t.id||t.className||'click').trim().slice(0,120):'click');
      },true);
      document.addEventListener('change',e=>arm('change:'+(e.target&&e.target.name||e.target&&e.target.id||'control')),true);
    }
    return {schema:SCHEMA,deviceId,attach,checkpoint,journal,clearJournal,discardThrough,record,runAction,diff,merge,getCheckpoint:()=>read(deviceId,'checkpoint',null)};
  }
  global.KittensPlanA={SCHEMA,create,diff,merge};
})(window);


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


(function(global){
  'use strict';
  function b64Utf8(text){
    const bytes=new TextEncoder().encode(text);let bin='';
    for(const b of bytes)bin+=String.fromCharCode(b);
    return btoa(bin);
  }
  function fromB64Utf8(text){
    const bin=atob(text.replace(/\n/g,'')),bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function create(opts){
    const owner=opts.owner,repo=opts.repo,branch=opts.branch||'main',request=opts.request;
    if(!owner||!repo||!request)throw new Error('GitHub mailbox requires owner, repo, and request().');
    const repoPath='/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo);
    const apiPath=p=>repoPath+'/contents/'+p.split('/').map(encodeURIComponent).join('/');
    async function verifyPrivate(){
      const r=await request({method:'GET',path:repoPath});
      if(r.status<200||r.status>=300)throw new Error('GitHub repository check failed ('+r.status+').');
      const x=typeof r.body==='string'?JSON.parse(r.body):r.body;
      if(!(x.private===true||x.visibility==='private'))throw new Error('Refusing to upload Kittens saves: '+owner+'/'+repo+' is not private.');
      return {ok:true,private:true,fullName:x.full_name||owner+'/'+repo};
    }
    async function read(path){
      const r=await request({method:'GET',path:apiPath(path)+'?ref='+encodeURIComponent(branch)});
      if(r.status===404)return null;
      if(r.status<200||r.status>=300)throw new Error('GitHub read failed ('+r.status+'): '+String(r.body||''));
      const x=typeof r.body==='string'?JSON.parse(r.body):r.body;
      return {sha:x.sha,text:fromB64Utf8(x.content),json:JSON.parse(fromB64Utf8(x.content))};
    }
    async function write(path,value,message,sha){
      const body={message:message||('Update '+path),content:b64Utf8(JSON.stringify(value)),branch};
      if(sha)body.sha=sha;
      const r=await request({method:'PUT',path:apiPath(path),json:body});
      if(r.status===409||r.status===422)return {conflict:true,status:r.status,body:r.body};
      if(r.status<200||r.status>=300)throw new Error('GitHub write failed ('+r.status+'): '+String(r.body||''));
      const x=typeof r.body==='string'?JSON.parse(r.body):r.body;
      return {conflict:false,contentSha:x.content&&x.content.sha,commitSha:x.commit&&x.commit.sha};
    }
    async function appendBatch(device,batch){
      const id=(batch.id||((batch.time||Date.now())+'-'+device+'-'+Math.random().toString(16).slice(2)));
      const path='devices/'+device+'/events/'+id+'.json';
      const w=await write(path,batch,'Append '+device+' sync events '+id);
      if(w.conflict)throw new Error('Unexpected append-only event collision for '+id);
      return {id,path,...w};
    }
    async function appendSnapshot(device,snapshot){
      const id=snapshot.id||((snapshot.capturedAt||Date.now())+'-'+device+'-'+Math.random().toString(16).slice(2));
      const path='devices/'+device+'/snapshots/'+id+'.json';
      const w=await write(path,snapshot,'Append '+device+' branch snapshot '+id);
      if(w.conflict)throw new Error('Unexpected append-only snapshot collision for '+id);
      return {id,path,...w};
    }
    async function readSnapshot(path){return read(path);}
    async function readDeviceHead(device){return read('devices/'+device+'/head.json');}
    async function updateDeviceHead(device,head,expectedSha){
      const path='devices/'+device+'/head.json';
      if(expectedSha!==undefined)return write(path,head,'Advance '+device+' sync head',expectedSha||undefined);
      const current=await read(path);
      return write(path,head,'Advance '+device+' sync head',current&&current.sha);
    }
    async function readBatch(path){return read(path);}
    async function readCanonical(){return read('canonical/head.json');}
    async function readRevision(path){return read(path);}
    async function writeRevision(revision){
      const path='canonical/revisions/'+revision.revision+'.json';
      const out=await write(path,revision,'Create canonical Kittens revision '+revision.revision);
      if(out.conflict)throw new Error('Canonical revision id collision: '+revision.revision);
      return {path,...out};
    }
    async function updateCanonical(head,expectedSha){
      return write('canonical/head.json',head,'Advance canonical Kittens revision',expectedSha);
    }
    async function readConflict(){return read('conflicts/current.json');}
    async function updateConflict(conflict,expectedSha){
      return write('conflicts/current.json',conflict,'Update Kittens merge conflict',expectedSha);
    }
    return {owner,repo,branch,verifyPrivate,read,write,appendBatch,appendSnapshot,readSnapshot,readDeviceHead,updateDeviceHead,readBatch,readCanonical,readRevision,writeRevision,updateCanonical,readConflict,updateConflict};
  }
  global.KittensGitHubMailbox={create};
})(window);


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

      // Read the remote device head *before* creating immutable batch/snapshot files.
      // This prevents an acknowledged local branch from creating an orphan upload
      // every poll merely because GitHub has already advanced its head.
      const current=await mailbox.readDeviceHead(deviceId);
      const currentHead=current&&current.json;
      const remoteAck=Number(currentHead&&currentHead.acknowledgedSeq)||0;
      if(remoteAck){
        planA.discardThrough(remoteAck);
        state.lastPublishedSeq=Math.max(Number(state.lastPublishedSeq)||0,remoteAck);
      }

      const all=planA.journal();
      const entries=all.filter(e=>(Number(e.seq)||0)>(Number(state.lastPublishedSeq)||0));
      if(!entries.length){
        saveState(state);
        return {ok:true,type:'no-op',published:0,acknowledgedSeq:remoteAck};
      }

      const first=entries[0].seq,last=entries.at(-1).seq;

      // If GitHub already references this sequence range, recover local state
      // instead of uploading it again after an app restart/network race.
      if(currentHead&&(currentHead.pendingBatches||[]).length &&
         currentHead.baseRevision===state.baseRevision &&
         (Number(currentHead.lastSeq)||0)>=last){
        state.lastPublishedSeq=Math.max(Number(state.lastPublishedSeq)||0,Number(currentHead.lastSeq)||0);
        saveState(state);
        return {ok:true,type:'already-published',published:0,lastSeq:currentHead.lastSeq};
      }

      // A different-base pending branch means another local publication is still
      // unresolved. Do not overwrite that head; reconciliation/polling will retry.
      if(currentHead&&(currentHead.pendingBatches||[]).length &&
         currentHead.baseRevision!==state.baseRevision){
        return {ok:false,type:'device-head-busy',current:currentHead,retry:true};
      }

      const capturedAt=Date.now();
      const publicationId=deviceId+'-'+first+'-'+last+'-'+capturedAt;
      const snapshotSave=JSON.parse(JSON.stringify(getSave()));
      const snapshotHash=await sha256(JSON.stringify(snapshotSave));
      const batch={
        schema:1,id:publicationId,deviceId,baseRevision:state.baseRevision,
        createdAt:capturedAt,firstSeq:first,lastSeq:last,entries
      };
      const snapshot={
        schema:1,id:publicationId,deviceId,baseRevision:state.baseRevision,
        capturedAt,lastSeq:last,sha256:snapshotHash,save:snapshotSave
      };

      const appended=await mailbox.appendBatch(deviceId,batch);
      const snapped=await mailbox.appendSnapshot(deviceId,snapshot);

      // It is valid for an idle/acknowledged remote head to point at a newer
      // canonical revision while these unpublished actions were made on an older
      // local revision. Writing the old base here preserves the true ancestry;
      // the orchestrator will perform a stale-branch merge safely.
      const pending=[...new Set([...(currentHead&&currentHead.pendingBatches||[]),appended.path])];
      const next={
        schema:1,deviceId,baseRevision:state.baseRevision,lastSeq:last,
        acknowledgedSeq:remoteAck,pendingBatches:pending,
        snapshotPath:snapped.path,snapshotCapturedAt:capturedAt,snapshotSha256:snapshotHash,
        updatedAt:Date.now()
      };
      const updated=await mailbox.updateDeviceHead(deviceId,next,current&&current.sha);
      if(updated.conflict)return {ok:false,type:'device-head-race',batchPath:appended.path,snapshotPath:snapped.path,retry:true};

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

    function summarizeConflict(result,loaded,canonical){
      const byDevice={};
      for(const b of loaded.branches){
        byDevice[b.deviceId]={
          deviceId:b.deviceId,
          baseRevision:b.baseRevision,
          lastSeq:b.lastSeq,
          batchIds:b.batchIds||[],
          snapshotPath:b.snapshotPath||null,
          snapshotCapturedAt:b.snapshotCapturedAt||0
        };
      }
      const id=canonical.revision.revision+'-p'+(byDevice.phone&&byDevice.phone.lastSeq||0)+'-w'+(byDevice.watch&&byDevice.watch.lastSeq||0);
      return {
        schema:1,state:'active',id,
        canonicalRevision:canonical.revision.revision,
        canonicalRevisionPath:canonical.path,
        detectedAt:Date.now(),detectedBy:deviceId,
        branches:byDevice,
        conflicts:(result.conflicts||[]).map(c=>({
          deviceId:c.entry&&c.entry.deviceId||null,
          seq:c.entry&&c.entry.seq||null,
          label:c.entry&&c.entry.label||'action',
          reason:c.reason||'conflict',
          path:c.path||null
        }))
      };
    }

    async function publishConflict(result,loaded,canonical){
      const next=summarizeConflict(result,loaded,canonical);
      const current=await mailbox.readConflict();
      if(current&&current.json&&current.json.state==='active'&&current.json.id===next.id)return current.json;
      const written=await mailbox.updateConflict(next,current&&current.sha);
      if(written.conflict)return (await mailbox.readConflict()).json;
      return next;
    }

    async function getActiveConflict(){
      await ensurePrivate();
      const c=await mailbox.readConflict();
      return c&&c.json&&c.json.state==='active'?c.json:null;
    }

    async function reconcileCloud(){
      await ensurePrivate();
      const canonical=await readCanonicalRevision();
      if(!canonical)return {ok:false,type:'needs-bootstrap'};

      const loaded=await loadBranches(canonical.revision);
      const result=global.KittensPlanAOrchestrator.reconcile(canonical.revision,loaded.branches);
      if(!result.ok){
        if(result.type==='merge-conflict'){
          result.cloudConflict=await publishConflict(result,loaded,canonical);
        }
        return result;
      }
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

    async function resolveConflict(choice){
      await ensurePrivate();
      if(!['phone','watch','canonical'].includes(choice))throw new Error('Unknown conflict resolution choice: '+choice);

      const conflictRead=await mailbox.readConflict();
      if(!conflictRead||!conflictRead.json||conflictRead.json.state!=='active')return {ok:false,type:'no-active-conflict'};
      const conflict=conflictRead.json;
      const canonical=await readCanonicalRevision();
      if(!canonical)return {ok:false,type:'needs-bootstrap'};
      if(conflict.canonicalRevision!==canonical.revision.revision){
        const resolved={...conflict,state:'superseded',resolvedAt:Date.now(),resolution:'canonical-advanced',resolutionRevision:canonical.revision.revision};
        await mailbox.updateConflict(resolved,conflictRead.sha);
        return {ok:false,type:'conflict-superseded',canonical:canonical.revision.revision};
      }

      let chosenSave=JSON.parse(JSON.stringify(canonical.revision.save));
      if(choice!=='canonical'){
        const info=conflict.branches&&conflict.branches[choice];
        if(!info||!info.snapshotPath)throw new Error('The '+choice+' conflict branch has no recoverable snapshot.');
        const snapshot=await mailbox.readSnapshot(info.snapshotPath);
        if(!snapshot||!snapshot.json||!snapshot.json.save)throw new Error('The '+choice+' conflict snapshot is missing.');
        chosenSave=JSON.parse(JSON.stringify(snapshot.json.save));
      }

      const hash=await sha256(JSON.stringify(chosenSave));
      const revision=global.KittensPlanAOrchestrator.makeRevision(
        canonical.revision,chosenSave,
        DEVICES.map(id=>{
          const b=conflict.branches&&conflict.branches[id];
          return b?{deviceId:id,baseRevision:b.baseRevision,lastSeq:b.lastSeq,batchIds:b.batchIds||[],snapshotPath:b.snapshotPath||null}:null;
        }).filter(Boolean),
        hash,Date.now()
      );
      revision.conflictResolution={conflictId:conflict.id,choice,resolvedBy:deviceId};

      const written=await mailbox.writeRevision(revision);
      const nextHead={
        schema:1,revision:revision.revision,revisionPath:written.path,sha256:hash,
        parentRevision:canonical.revision.revision,updatedAt:Date.now(),
        conflictResolution:{id:conflict.id,choice,resolvedBy:deviceId}
      };
      const advanced=await mailbox.updateCanonical(nextHead,canonical.head.sha);
      if(advanced.conflict)return {ok:false,type:'canonical-race',retry:true};

      const ack=[];
      for(const id of DEVICES){
        const h=await mailbox.readDeviceHead(id);
        if(!h||!h.json)continue;
        const lastSeq=Number(h.json.lastSeq)||0;
        const next={
          schema:1,deviceId:id,baseRevision:revision.revision,lastSeq,
          acknowledgedSeq:lastSeq,pendingBatches:[],
          snapshotPath:null,snapshotCapturedAt:null,snapshotSha256:null,updatedAt:Date.now()
        };
        const u=await mailbox.updateDeviceHead(id,next,h.sha);
        ack.push({deviceId:id,ok:!u.conflict});
      }

      const resolved={...conflict,state:'resolved',resolvedAt:Date.now(),resolution:choice,resolvedBy:deviceId,resolutionRevision:revision.revision};
      const cleared=await mailbox.updateConflict(resolved,conflictRead.sha);
      return {ok:!cleared.conflict,type:'resolved',choice,revision,canonicalHead:nextHead,ack};
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

      const deviceHead=await mailbox.readDeviceHead(deviceId);
      const remoteHead=deviceHead&&deviceHead.json;
      const remoteAck=Number(remoteHead&&remoteHead.acknowledgedSeq)||0;
      if(remoteAck){
        planA.discardThrough(remoteAck);
        state.lastPublishedSeq=Math.max(Number(state.lastPublishedSeq)||0,remoteAck);
      }

      if(state.lastAppliedRevision===canonical.revision.revision){
        saveState(state);
        return {ok:true,type:'already-current',revision:canonical.revision};
      }

      const localPending=planA.journal().filter(e=>(Number(e.seq)||0)>(Number(state.lastPublishedSeq)||0));
      if(localPending.length){
        saveState(state);
        return {ok:false,type:'local-unpublished-actions',count:localPending.length};
      }

      if(applySave)await applySave(canonical.revision.save);
      planA.discardThrough(state.lastPublishedSeq);
      await planA.checkpoint(canonical.revision.save);

      // Keep the device head aligned with the canonical revision when it has no
      // unresolved branch. This makes passive polling deterministic.
      if(!remoteHead||!(remoteHead.pendingBatches||[]).length){
        const next={
          schema:1,deviceId,baseRevision:canonical.revision.revision,
          lastSeq:Math.max(Number(remoteHead&&remoteHead.lastSeq)||0,Number(state.lastPublishedSeq)||0),
          acknowledgedSeq:Math.max(remoteAck,Number(state.lastPublishedSeq)||0),
          pendingBatches:[],snapshotPath:null,snapshotCapturedAt:null,snapshotSha256:null,
          updatedAt:Date.now()
        };
        const up=await mailbox.updateDeviceHead(deviceId,next,deviceHead&&deviceHead.sha);
        if(up.conflict)return {ok:false,type:'device-head-race',retry:true};
      }

      state.baseRevision=canonical.revision.revision;
      state.lastAppliedRevision=canonical.revision.revision;
      saveState(state);
      return {ok:true,type:'applied',revision:canonical.revision};
    }

    return {bootstrapFromLocal,adoptCanonical,publishLocal,reconcileCloud,pullCanonical,readCanonicalRevision,getActiveConflict,resolveConflict,loadState};
  }

  global.KittensPlanACloud={create};
})(window);


(function(){
 'use strict';
 const KEY='com.nuclearunicorn.kittengame.savedata';
 let ready=false, suspended=false, lastTabList='', page='play', lastComplicationSync=0, transferPoll=0, planASync=null, planAMailbox=null, planACloud=null, planACloudTimer=0, planACloudBusy=false, planAPollTimer=0;
 const $id=id=>document.getElementById(id);
 function node(tag,attrs,text){let n=document.createElement(tag);Object.assign(n,attrs||{});if(text!==undefined)n.textContent=text;return n;}
 function button(text,fn,parent){let b=node('button',{type:'button',className:'wear-button'},text);b.onclick=fn;parent.appendChild(b);return b;}
 function status(text){$id('wearStatus').textContent=text;}
 function detail(html){$id('wearDetailBody').innerHTML=html;$id('wearDetail').hidden=false;$id('wearDetail').scrollTop=0;}
 function go(next){page=next;document.body.dataset.page=next;['wearResources','wearSettings'].forEach(id=>$id(id).hidden=true);$id('wearQuick').hidden=next!=='play';$id('wearTabs').hidden=next!=='play';if(next==='resources')$id('wearResources').hidden=false;if(next==='settings')$id('wearSettings').hidden=false;document.querySelectorAll('.wear-nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===next));window.scrollTo(0,0);update();}
 const header=node('header',{id:'wearHeader'});header.append(node('strong',{},'Kittens'),node('span',{id:'wearSeason'},'Your village, on your wrist'));
 const nav=node('nav',{className:'wear-nav','ariaLabel':'Game sections'});
 [['play','Play'],['resources','Resources'],['log','Log'],['settings','Settings']].forEach(([p,label])=>{let b=button(label,()=>go(p),nav);b.dataset.page=p;});document.body.prepend(header);
 const quick=node('div',{id:'wearQuick'});quick.innerHTML='<label>CATNIP</label><b id="wearNip">0</b><span id="wearNipRate"></span>';header.after(quick);
 const tabs=node('select',{id:'wearTabs','ariaLabel':'Game category'});quick.after(tabs);tabs.onchange=()=>{game.ui.activeTabId=tabs.value;game.render();};
 const resources=node('section',{id:'wearResources',hidden:true});tabs.after(resources);
 const settings=node('section',{id:'wearSettings',hidden:true});resources.after(settings);
 settings.append(node('div',{className:'wear-label'},'Your game'));
 function wearEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function normalizeDraculaSave(save){
  if(!save||typeof save!=='object')return save;
  if(!save.game)save.game={};
  save.game.colorScheme='dracula';
  const schemes=Array.isArray(save.game.unlockedSchemes)?save.game.unlockedSchemes.slice():[];
  if(!schemes.includes('dracula'))schemes.unshift('dracula');
  save.game.unlockedSchemes=schemes;
  return save;
 }
 function getDraculaSave(){return normalizeDraculaSave(game.save());}
 function forceDraculaLocal(){
  if(!window.game)return;
  game.colorScheme='dracula';
  if(!Array.isArray(game.unlockedSchemes))game.unlockedSchemes=[];
  if(!game.unlockedSchemes.includes('dracula'))game.unlockedSchemes.unshift('dracula');
  if(game.ui){
   if(Array.isArray(game.ui.allSchemes)&&!game.ui.allSchemes.includes('dracula'))game.ui.allSchemes.unshift('dracula');
   if(Array.isArray(game.ui.defaultSchemes)&&!game.ui.defaultSchemes.includes('dracula'))game.ui.defaultSchemes.unshift('dracula');
   try{game.ui.updateOptions();}catch(e){console.warn('Could not refresh Dracula options',e);}
  }
  const opt=document.querySelector('#schemeToggle option[value="dracula"]');
  if(opt)opt.textContent='Dracula';
  document.body.classList.add('scheme_dracula');
 }
 async function waitNative(url){for(;;){await new Promise(r=>setTimeout(r,500));const q=await fetch(url,{cache:'no-store'});let x;try{x=await q.json();}catch(e){throw new Error('Native operation returned invalid JSON: '+e.message);}if(x.state!=='waiting')return x;}}
 function opError(title,x){detail('<h2>'+wearEsc(title)+'</h2><p><b>Operation:</b> '+wearEsc(x.operation||'unknown')+'</p><p><b>Error type:</b> '+wearEsc(x.type||'unknown')+'</p><p><b>Message:</b> '+wearEsc(x.message||'No message')+'</p>'+(x.cause?'<p><b>Cause:</b> '+wearEsc(x.cause)+'</p>':'')+(x.detail?'<p><b>Details:</b> '+wearEsc(x.detail)+'</p>':''));}
 function showExportBox(text){
  const box=node('div');box.append(node('h2',{},'Export save'));
  box.append(node('p',{id:'wearExportStatus'},'Preparing Android clipboard…'));
  const area=node('textarea',{id:'wearExportText',readOnly:true,rows:10,value:text});
  area.style.width='100%';area.style.minHeight='180px';area.style.fontSize='11px';area.style.boxSizing='border-box';
  area.onclick=()=>{area.focus();area.select();};
  box.append(area);
  button('Copy again',async()=>{try{const r=await fetch('/clipboard-copy',{method:'POST',body:JSON.stringify({text:area.value})});const x=await r.json();if(x.state==='success'){status('Save copied to clipboard');$id('wearExportStatus').textContent='Copied to Android clipboard · '+x.characters+' characters';}else opError('Clipboard copy failed',x);}catch(e){opError('Clipboard copy failed',{operation:'clipboard-copy',type:e.name,message:e.message,detail:'Long-press the export box and copy manually.'});}},box);
  box.append(node('p',{},'Fallback: tap the text box to select it, then use Copy. This is the same compressed save string used by the web version.'));
  $id('wearDetailBody').replaceChildren(box);$id('wearDetail').hidden=false;$id('wearDetail').scrollTop=0;
 }
 function showImportBox(){
  const box=node('div');box.append(node('h2',{},'Import save'),node('p',{},'Paste a Kittens Game export string or save JSON below.'));
  const area=node('textarea',{id:'wearImportText',rows:10,placeholder:'Paste save here…'});
  area.style.width='100%';area.style.minHeight='180px';area.style.fontSize='11px';area.style.boxSizing='border-box';box.append(area);
  button('Paste clipboard',async()=>{try{const r=await fetch('/clipboard-read',{cache:'no-store'});const x=await r.json();if(x.state==='success'){area.value=x.text;status('Pasted '+x.characters+' characters');area.focus();}else opError('Clipboard paste failed',x);}catch(e){opError('Clipboard paste failed',{operation:'clipboard-read',type:e.name,message:e.message,detail:'Long-press the import box and paste manually.'});}},box);
  button('Import pasted save',async()=>{const text=area.value.trim();if(!text){opError('Import failed',{operation:'import',type:'EmptyInput',message:'The import box is empty.',detail:'Paste a Kittens Game export string or save JSON first.'});return;}try{if(!confirm('Replace your current village with this pasted save?'))return;await save(true);await importSave(text);detail('<h2>Import complete</h2><p>The pasted save was validated and loaded successfully.</p><p><b>Characters:</b> '+wearEsc(text.length)+'</p>');}catch(e){opError('Import failed',{operation:'import',type:e.name||'ImportError',message:e.message||String(e),detail:'The pasted text was not accepted as a valid Kittens Game save. Your previous village was retained when validation failed.'});}},box);
  button('Clear',()=>{area.value='';area.focus();},box);
  $id('wearDetailBody').replaceChildren(box);$id('wearDetail').hidden=false;$id('wearDetail').scrollTop=0;setTimeout(()=>area.focus(),100);
 }
 function stopTransferPoll(){if(transferPoll){clearInterval(transferPoll);transferPoll=0;}}
 async function showTransferSave(){
  stopTransferPoll();
  try{
   const exportText=game.compressLZData(JSON.stringify(game.save()));
   const response=await fetch('/transfer/start',{method:'POST',body:JSON.stringify({exportText})});
   const x=await response.json();
   if(!response.ok||x.state!=='success'){opError('Transfer could not start',x);return;}
   const box=node('div');
   box.append(node('h2',{},'Transfer save'));
   box.append(node('p',{},'On your phone, open Kittens Game → Export → Watch Sync. Scan this QR code or use the temporary address below. Both devices must be on the same Wi-Fi, or connect the watch to the phone hotspot.'));
   const qr=node('img',{src:'/transfer/qr?'+Date.now(),alt:'QR code containing transfer address'});
   qr.style.width='180px';qr.style.height='180px';qr.style.display='block';qr.style.margin='8px auto';qr.style.background='#fff';qr.style.borderRadius='8px';
   box.append(qr);
   const url=node('textarea',{readOnly:true,rows:3,value:x.url});
   url.style.width='100%';url.style.boxSizing='border-box';url.style.fontSize='12px';
   url.onclick=()=>{url.focus();url.select();};
   box.append(url);
   const state=node('p',{id:'wearTransferState'},'Waiting for phone…');
   box.append(state);
   const apply=button('Apply received phone save',async()=>{
    try{
     apply.disabled=true;
     const r=await fetch('/transfer/import-text',{cache:'no-store'});
     const incoming=await r.json();
     if(incoming.state!=='success')throw new Error('No received save is waiting.');
     if(!confirm('Replace your current village with the save received from the phone?')){apply.disabled=false;return;}
     state.textContent='Creating safety backup…';
     await save(true);
     state.textContent='Importing received save…';
     await importSave(incoming.text);
     await fetch('/transfer/clear-import',{method:'POST'});
     state.textContent='Phone save imported successfully.';
     apply.hidden=true;
     status('Imported save from phone');
    }catch(e){
     apply.disabled=false;
     opError('Received import failed',{operation:'LAN import',type:e.name||'ImportError',message:e.message||String(e),detail:'The incoming save was not applied if validation/import failed.'});
    }
   },box);
   apply.hidden=true;
   button('Stop transfer',async()=>{
    stopTransferPoll();
    try{await fetch('/transfer/stop',{method:'POST'});}catch(e){}
    state.textContent='Transfer stopped.';
    apply.hidden=true;
   },box);
   $id('wearDetailBody').replaceChildren(box);$id('wearDetail').hidden=false;$id('wearDetail').scrollTop=0;
   const poll=async()=>{
    const el=$id('wearTransferState');
    if(!el){stopTransferPoll();return;}
    try{
     const sr=await fetch('/transfer/status',{cache:'no-store'}), st=await sr.json();
     if(!st.active){el.textContent='Transfer session ended or expired.';apply.hidden=true;stopTransferPoll();return;}
     const mins=Math.floor(st.remainingSeconds/60),secs=st.remainingSeconds%60;
     if(st.pending){
      el.textContent='Phone save received · '+st.pendingCharacters+' characters · '+mins+':'+String(secs).padStart(2,'0')+' remaining';
      apply.hidden=false;
     }else{
      el.textContent='Waiting for phone · '+mins+':'+String(secs).padStart(2,'0')+' remaining';
      apply.hidden=true;
     }
    }catch(e){el.textContent='Transfer status error: '+e.message;}
   };
   await poll();
   transferPoll=setInterval(poll,1000);
  }catch(e){
   opError('Transfer failed',{operation:'transfer-start',type:e.name||'TransferError',message:e.message||String(e),detail:'The 1.1.5 game runtime was left unchanged.'});
  }
 }
 button('Save now',async()=>{await save(true);},settings);
 button('Export save',async()=>{try{const text=game.compressLZData(JSON.stringify(game.save()));showExportBox(text);const response=await fetch('/export',{method:'POST',body:JSON.stringify({exportText:text})});let x;try{x=await response.json();}catch(e){x={state:'error',operation:'clipboard-copy',type:e.name,message:e.message,detail:'The export string is still visible below for manual copying.'};}const msg=$id('wearExportStatus');if(x.state==='success'){msg.textContent='Copied to Android clipboard · '+x.characters+' characters';status('Save copied to clipboard');}else{msg.textContent='Automatic clipboard copy failed. Long-press the box and copy manually.';msg.dataset.error=JSON.stringify(x);}}catch(e){opError('Export failed',{operation:'export',type:e.name,message:e.message,detail:'The game could not generate an export string.'});}},settings);
 button('Import save',()=>showImportBox(),settings);
 button('Transfer save',()=>showTransferSave(),settings);
 button('Plan A cloud sync',()=>showPlanACloud(),settings);
 button('Building filters',()=>{const list=node('div');list.append(node('h2',{},'Building filters'));game.bld.getBuildingGroups(true).forEach(group=>button(group.title,()=>{game.bldTab.activeGroup=group.name;game.render();$id('wearDetail').hidden=true;go('play');},list));$id('wearDetailBody').replaceChildren(list);$id('wearDetail').hidden=false;},settings);
 button('Game options',()=>{$('#optionsDiv').show();game.ui.updateOptions();},settings);
 button('Pause / resume',()=>{game.togglePause();status(game.isPaused?'Game paused':'Game running');syncComplication(true);},settings);
 button('Complication setup',async()=>{try{const r=await fetch('/open-complication-settings',{method:'POST'});if(!r.ok)throw Error();}catch(e){status('Could not open complication setup');}},settings);
 button('Reset / prestige',()=>game.reset(),settings);
 settings.append(node('p',{},'Swipe up to scroll. Tap Details for costs and effects. Transfer save uses a temporary LAN session only; normal 1.1.5 saving and gameplay are unchanged. Your game saves every 10 seconds and when you leave. Offline progress follows the original game rules.'));
 button('About & credits',()=>detail('<h2>Kittens Wear 1.1.5</h2><p>Personal offline adaptation for Wear OS. Original game by bloodrizer and contributors.</p><p>Based on Kittens Game '+version+'. Bundles Mozilla GeckoView (MPL 2.0).</p><p>Original game: kittensgame.com/web/</p><p>Source: github.com/nuclear-unicorn/kittensgame</p><p>Game code retains its WET PAWS LICENSE; this build is for personal use.</p><p>Engine sources: archive.mozilla.org/pub/firefox/releases/140.0.4/source/</p><p>All original acknowledgements:</p>'+$id('creditsDiv').innerHTML),settings);
 const state=node('p',{id:'wearStatus'},'Starting your forest…');document.body.append(state);
 const menu=node('section',{id:'wearMenu',hidden:true});menu.append(node('h2',{},'Your village'),nav);button('Back to game',()=>menu.hidden=true,menu);document.body.append(menu);nav.addEventListener('click',()=>menu.hidden=true);const top=button('Menu',()=>{menu.hidden=false;menu.scrollTop=0;},document.body);top.id='wearHome';
 const sheet=node('section',{id:'wearDetail',hidden:true});sheet.append(node('div',{id:'wearDetailBody'}));button('Close',()=>sheet.hidden=true,sheet);document.body.append(sheet);
 function fmt(x){return game.getDisplayValueExt(x);}
 function update(){if(!ready)return;
  const cat=game.resPool.get('catnip');$id('wearNip').textContent=fmt(cat.value);$id('wearNipRate').textContent=' / '+fmt(cat.maxValue);
  $id('wearSeason').textContent='Year '+game.calendar.year+' · '+game.calendar.getCurSeason().title+(game.isPaused?' · Paused':'');
  let visible=game.tabs.filter(t=>t.visible);let list=visible.map(t=>t.tabId+':'+t.tabName).join('|');
  if(list!==lastTabList){tabs.replaceChildren(...visible.map(t=>node('option',{value:t.tabId},t.tabName.replace(/<[^>]+>/g,''))));lastTabList=list;}
  tabs.value=game.ui.activeTabId;tabs.style.display=visible.length>1 && page==='play'?'block':'none';
  if(page==='resources'){
   resources.replaceChildren();
   game.resPool.resources.filter(r=>(r.visible || r.craftable) && (r.unlocked || r.value>0 || r.name==='catnip' || (r.name==='kittens' && r.maxValue>0))).forEach(r=>{
    let card=node('div',{className:'resource-card'}),line=node('div',{className:'resource-line'});line.append(node('span',{},r.title||r.name),node('b',{},fmt(r.value)));card.append(line);
    let rate=game.getResourcePerTick(r.name,true)*game.ticksPerSecond;card.append(node('small',{},(r.maxValue?'Capacity '+fmt(r.maxValue)+' · ':'')+(rate>=0?'+':'')+fmt(rate)+'/s'));
    if(r.maxValue>0){let meter=node('div',{className:'resource-meter'}),fill=node('i');fill.style.width=Math.min(100,r.value/r.maxValue*100)+'%';meter.append(fill);card.append(meter);}resources.append(card);
   });
  }
 }
 async function save(manual){if(!ready || game.currentSaveIsBroken){if(manual)opError('Save failed',{operation:'save',type:'GameStateError',message:'The game is not ready to save or reports the current save as broken.',detail:'No new save file was created.'});return;}try{let data=game.save();const endpoint=manual?'/save-manual':'/backup';const r=await fetch(endpoint,{method:'POST',body:JSON.stringify(data),keepalive:true});let x;try{x=await r.json();}catch(e){throw new Error('Save service returned invalid JSON: '+e.message);}if(!r.ok||x.state==='error'){if(manual)opError('Save failed',x);return;}if(manual){let msg='<h2>Save complete</h2><p><b>'+wearEsc(x.fileName||'KittensGame save')+'</b></p><p>Location: <b>'+wearEsc(x.location||'internal storage')+'</b></p><p>Internal recovery copy: <b>'+(x.internal?'OK':'FAILED')+'</b><br>Visible timestamped copy: <b>'+(x.visible?'OK':'FAILED')+'</b></p>';if(x.detail)msg+='<p><b>Warnings:</b> '+wearEsc(x.detail)+'</p>';detail(msg);}}catch(e){if(manual)opError('Save failed',{operation:'save',type:e.name,message:e.message,detail:'The request to the native save service failed.'});}}
 async function importSave(text,quiet){
  text=text.trim();let parsed=JSON.parse(text.startsWith('{')?text:game.decompressLZData(text));if(!parsed || !Array.isArray(parsed.resources) || !parsed.game)throw Error('Not a Kittens Game save');parsed=normalizeDraculaSave(parsed);text=game.compressLZData(JSON.stringify(parsed));const previous=LCstorage[KEY];
  return new Promise((resolve,reject)=>game.saveImportText(text,error=>{if(error){LCstorage[KEY]=previous;game.load();forceDraculaLocal();game.render();reject(error);}else{game.opts.enableRedshift=true;game.opts.useWorkers=false;forceDraculaLocal();if(quiet)save(false);else save(true);go('play');resolve();}}));
 }

 async function wearGithubRequest(req){
  const r=await fetch('/github/request',{method:'POST',body:JSON.stringify(req),cache:'no-store'});
  const x=await r.json();
  if(x.state==='error')throw new Error(x.message||x.detail||'Native GitHub request failed');
  return {status:x.status,body:x.body};
 }
 async function initPlanACloud(){
  if(!planASync&&window.KittensPlanA){
   planASync=KittensPlanA.create({deviceId:'watch',getSave:()=>getDraculaSave(),onEntry:()=>schedulePlanACloud()});
   if(!planASync.getCheckpoint())await planASync.checkpoint(game.save());
  }
  if(planACloud)return true;
  const r=await fetch('/github/config-status',{cache:'no-store'}),cfg=await r.json();
  if(cfg.state!=='success'||!cfg.configured)return false;
  planAMailbox=KittensGitHubMailbox.create({owner:'kd40000-dot',repo:'KittensGame-Sync',branch:'main',request:wearGithubRequest});
  planACloud=KittensPlanACloud.create({
   deviceId:'watch',planA:planASync,mailbox:planAMailbox,getSave:()=>getDraculaSave(),
   applySave:saveObj=>importSave(game.compressLZData(JSON.stringify(normalizeDraculaSave(saveObj))),true)
  });
  return true;
 }
 function startPlanAPolling(){
  if(planAPollTimer)return;
  planAPollTimer=setInterval(()=>{if(ready)planACloudSync(false).catch(()=>{});},10000);
 }
 function schedulePlanACloud(delay){
  clearTimeout(planACloudTimer);
  planACloudTimer=setTimeout(()=>{planACloudSync(false).catch(e=>console.warn('Plan A auto sync failed',e));},delay==null?900:delay);
 }
 async function planACloudSync(showUi){
  if(planACloudBusy)return {ok:true,type:'busy'};
  planACloudBusy=true;
  try{
   if(!await initPlanACloud()){
    const x={ok:false,type:'not-configured',message:'GitHub sync has not been provisioned from the phone yet.'};
    if(showUi)opError('Plan A sync unavailable',{operation:'github-sync',type:'NotConfigured',message:x.message,detail:'Open Watch Sync on the phone and provision this watch during an active Transfer save session.'});
    return x;
   }
   const existingConflict=await planACloud.getActiveConflict();
   if(existingConflict){
    status('Plan A conflict · resolve on phone');
    if(showUi)showPlanAConflict(existingConflict);
    return {ok:false,type:'merge-conflict',cloudConflict:existingConflict};
   }
   if(showUi)status('Plan A: publishing watch actions…');
   const pub=await planACloud.publishLocal();
   if(pub.type==='needs-bootstrap'){
    const x={ok:false,type:'needs-bootstrap',message:'Initialize the canonical Plan A save from the phone first.'};
    if(showUi)opError('Plan A needs initialization',{operation:'github-sync',type:'NeedsBootstrap',message:x.message,detail:'Use Initialize canonical from this phone in the phone app.'});
    return x;
   }
   if(pub.type==='needs-adoption'){
    const x={ok:false,type:'needs-adoption',message:'This watch must adopt the canonical phone baseline before it can publish actions.'};
    if(showUi)opError('Plan A needs first-time adoption',{operation:'github-sync',type:'NeedsAdoption',message:x.message,detail:'Open Plan A + GitHub on the watch and choose Adopt canonical baseline.'});
    return x;
   }
   if(pub&&pub.ok===false){
    if(pub.retry){schedulePlanACloud(700);return pub;}
    throw new Error('Watch publication failed: '+pub.type);
   }
   const rec=await planACloud.reconcileCloud();
   if(!rec.ok){
    if(rec.type==='merge-conflict'){
     status('Plan A conflict · no save replaced');
     if(showUi)showPlanAConflict(rec);
     return rec;
    }
    if(rec.retry){schedulePlanACloud(1200);return rec;}
    throw new Error('Reconciliation failed: '+rec.type);
   }
   const pull=await planACloud.pullCanonical();
   if(pull&&pull.ok===false){
    if(pull.type==='local-unpublished-actions'){
     status('Plan A: newer watch actions queued');
     schedulePlanACloud(500);
     return {ok:false,type:pull.type,publish:pub,reconcile:rec,pull:pull};
    }
    if(pull.retry){schedulePlanACloud(700);return {ok:false,type:pull.type,publish:pub,reconcile:rec,pull:pull};}
    throw new Error('Canonical pull failed: '+pull.type);
   }
   status('Plan A synced · '+(rec.type||pull.type));
   if(showUi)detail('<h2>Plan A synced</h2><p><b>Result:</b> '+wearEsc(rec.type)+'</p><p><b>Local journal:</b> '+wearEsc(planASync.journal().length)+' pending actions</p>');
   return {ok:true,type:rec.type,publish:pub,reconcile:rec,pull:pull};
  }catch(e){
   status('Plan A sync failed');
   if(showUi)opError('Plan A sync failed',{operation:'github-sync',type:e.name||'SyncError',message:e.message||String(e),detail:'Your current watch save was retained when sync failed.'});
   throw e;
  }finally{planACloudBusy=false;}
 }
 async function adoptPlanACanonical(){
  if(!await initPlanACloud())throw new Error('GitHub sync has not been provisioned from the phone yet.');
  if(!confirm('Replace this watch village with the existing canonical Plan A save? The current watch save will be replaced after validation.'))return {ok:false,type:'cancelled'};
  status('Plan A: adopting canonical baseline…');
  const r=await planACloud.adoptCanonical();
  if(!r.ok)throw new Error('Canonical adoption failed: '+r.type);
  status('Plan A baseline adopted');
  detail('<h2>Plan A baseline adopted</h2><p>This watch now shares the same common revision as the phone. Automatic action sync is enabled.</p>');
  return r;
 }

 function showPlanAConflict(rec){
  const box=node('div');box.append(node('h2',{},'Plan A merge conflict'));
  box.append(node('p',{},'Both devices changed while apart and the changes cannot be combined safely. No save has been replaced.'));
  (rec.conflicts||[]).slice(0,20).forEach(c=>{
   const device=(c.entry&&c.entry.deviceId)||c.deviceId||'device';
   const label=(c.entry&&c.entry.label)||c.label||'action';
   box.append(node('p',{},device+' · '+label+' · '+(c.reason||'conflict')+(c.path?' · '+c.path:'')));
  });
  box.append(node('p',{},'The conflict is stored in GitHub. Open the phone app; a resolution popup should appear within about 10 seconds with Keep Phone, Keep Watch, and Keep Current Canonical choices.'));
  $id('wearDetailBody').replaceChildren(box);$id('wearDetail').hidden=false;$id('wearDetail').scrollTop=0;
 }
 async function showPlanACloud(){
  const box=node('div');box.append(node('h2',{},'Plan A + GitHub'));
  const cfgResp=await fetch('/github/config-status',{cache:'no-store'}),cfg=await cfgResp.json();
  const j=planASync?planASync.journal():[];
  box.append(node('p',{},cfg.configured?'GitHub: '+cfg.owner+'/'+cfg.repo:'GitHub: not provisioned'));
  box.append(node('p',{},'Local journal: '+j.length+' actions'));
  const state=planACloud?planACloud.loadState():{};
  box.append(node('p',{},state.baseRevision?'Common revision: '+String(state.baseRevision).slice(0,18)+'…':'Common revision: not adopted yet'));
  if(cfg.configured&&!state.baseRevision)button('Adopt canonical baseline',async()=>{try{await adoptPlanACanonical();}catch(e){opError('Plan A adoption failed',{operation:'github-adopt',type:e.name||'AdoptionError',message:e.message||String(e),detail:'The current watch save was retained if adoption failed.'});}},box);
  button('Sync now',async()=>{await planACloudSync(true);},box);
  box.append(node('p',{},'Automatic sync runs shortly after recorded actions once GitHub is configured. LAN Transfer save remains available as the recovery path.'));
  $id('wearDetailBody').replaceChildren(box);$id('wearDetail').hidden=false;$id('wearDetail').scrollTop=0;
 }

 function installDetails(){
  com.nuclearunicorn.game.ui.ContentRowRenderer.prototype.initRenderer=function(content){this.content=content;this.twoRows=false;};

  // Journal the actual Kittens Game button transaction synchronously. This is
  // more reliable on Wear/Gecko than inferring game actions from DOM touch/click
  // propagation, and captures the state immediately before/after buyItem().
  const buttonProto=com.nuclearunicorn.game.ui.Button.prototype;
  if(!buttonProto._planAOriginalOnClick){
   buttonProto._planAOriginalOnClick=buttonProto.onClick;
   buttonProto.onClick=function(event){
    const original=buttonProto._planAOriginalOnClick;
    let result;
    if(!planASync)result=original.call(this,event);
    else{
     const label=(this.model&&this.model.name)||(this.opts&&this.opts.name)||'Kittens action';
     result=planASync.runAction(String(label).replace(/<[^>]+>/g,''),original,this,[event]);
    }
    // Push post-transaction resource values immediately so complication slots
    // reflect spends/crafts/builds without waiting for the periodic snapshot.
    Promise.resolve().then(()=>syncComplication(true)).catch(()=>{});
    return result;
   };
  }
  const attach=UIUtils.attachTooltip;
  UIUtils.attachTooltip=function(g,container,top,left,provider){container._wearTip=()=>provider.call(g);return provider;};
  const original=com.nuclearunicorn.game.ui.Button.prototype.render;
  com.nuclearunicorn.game.ui.Button.prototype.render=function(parent){original.call(this,parent);const self=this;
   const info=node('button',{type:'button',className:'wear-info'},'Details');
   info.onclick=function(e){e.preventDefault();e.stopPropagation();let html;
    if(self.domNode._wearTip)html=self.domNode._wearTip();
    else{const m=self.controller.fetchModel(self.opts);let box=node('div');box.append(node('h2',{},m.name),node('p',{},m.description||''));(m.prices||[]).forEach(p=>box.append(node('p',{},(gTitle(p.name))+': '+fmt(p.val))));html=box.innerHTML;}
    detail(html);
   };this.domNode.append(info);
  };
 }
 function gTitle(name){let r=game.resPool.get(name);return r?r.title||name:name;}
 async function syncComplication(force){
  if(!ready)return;const now=Date.now();if(!force && now-lastComplicationSync<5000)return;lastComplicationSync=now;
  try{
   const list=game.resPool.resources.filter(r=>(r.visible||r.craftable||r.unlocked||r.value>0||r.name==='catnip')).map(r=>({
    name:r.name,title:r.title||r.name,value:Number(r.value)||0,max:Number(r.maxValue)||0,
    rate:game.isPaused?0:(Number(game.getResourcePerTick(r.name,true))*Number(game.ticksPerSecond)||0)
   }));
   await fetch('/complication-state',{method:'POST',body:JSON.stringify({resources:list}),keepalive:true});
  }catch(e){console.warn('Complication sync failed',e);}
 }
 const originalInit=window.initGame;
 window.initGame=async function(){
  try{
   if(!LCstorage[KEY]){try{const r=await fetch('/restore'),backup=await r.json();if(backup&&backup.saveVersion)LCstorage[KEY]=JSON.stringify(backup);}catch(e){}}
   classes.game.Server.prototype.refresh=function(){};classes.game.Server.prototype.fetchBcoinPrice=function(){return $.Deferred().resolve().promise();};installDetails();originalInit();
   if(!window.game||!game.resPool)throw Error('Game engine did not initialize');
   forceDraculaLocal();
   ready=true;game.opts.disableTelemetry=true;game.opts.enableRedshift=true;game.opts.useWorkers=false;game.autosaveFrequency=50;
   try{await initPlanACloud();startPlanAPolling();}catch(e){console.warn('Plan A initialization failed',e);startPlanAPolling();}
   status('Offline · saved on this watch');go('play');
   syncComplication(true);
   setInterval(()=>{if(!document.hidden){update();syncComplication(false);}},1000);
   setInterval(()=>{if(!document.hidden)save(false);},10000);
  }catch(e){status('Startup failed: '+e.message);console.error(e);}
 };
 document.addEventListener('visibilitychange',()=>{
  if(!ready)return;
  if(document.hidden){syncComplication(true);save(false);clearInterval(game._mainTimer);game._mainTimer=null;suspended=true;}
  else if(suspended){suspended=false;if(!game.isPaused)game.time.calculateRedshift();game.start();update();syncComplication(true);}
 });
 window.addEventListener('pagehide',()=>{if(ready)game.save();});
 document.body.dataset.page='play';
})();
