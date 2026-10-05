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

  // Resource production is continuous while the player is offline. A branch may
  // therefore spend the same capped resource multiple times after it refills.
  // Raw action deltas alone make that look like an impossible cumulative spend.
  //
  // Example:
  //   10000 -> 3000  (spend 7000)
  //   passive refill to 10000
  //   10000 -> 3000  (spend 7000 again)
  //
  // The second action's recorded `from` value proves that 7000 regenerated
  // since the previous action left the resource at 3000. Credit only that
  // *between-action* refill to the second resource delta. We deliberately do not
  // credit passive progress before the branch's first recorded action; the
  // canonical/snapshot carrier is responsible for ordinary shared passive time.
  //
  // This keeps genuine cross-device overspends conflicting: two branches that
  // each spend 7000 once from the same 10000 have no between-action refill
  // evidence, so their combined cost remains 14000.
  function creditObservedResourceRefills(entries){
    const lastTo=new Map();
    return (entries||[]).map(entry=>{
      const ops=(entry.ops||[]).map(op=>{
        if(op&&op.op==='delta'&&isResourceValuePath(op.path)&&
           typeof op.from==='number'&&Number.isFinite(op.from)&&
           typeof op.to==='number'&&Number.isFinite(op.to)&&
           typeof op.delta==='number'&&Number.isFinite(op.delta)){
          const previousTo=lastTo.get(op.path);
          let observedRefill=0;
          if(typeof previousTo==='number'&&Number.isFinite(previousTo)&&op.from>previousTo+1e-9){
            observedRefill=op.from-previousTo;
          }
          lastTo.set(op.path,op.to);
          if(observedRefill>0){
            return {...op,rawDelta:op.delta,observedRefill,delta:op.delta+observedRefill};
          }
        }
        if(op&&op.op==='delta'&&isResourceValuePath(op.path)&&
           typeof op.to==='number'&&Number.isFinite(op.to)){
          lastTo.set(op.path,op.to);
        }
        return op;
      });
      return {...entry,ops};
    });
  }

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
    const entries=[].concat(...branches.map(b=>
      creditObservedResourceRefills((b.entries||[]).map(e=>({...e,deviceId:e.deviceId||b.deviceId})))
    ));
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
  global.KittensPlanA={SCHEMA,create,diff,merge,creditObservedResourceRefills};
})(window);
