(function(global){
  'use strict';

  var DEFAULT_ENDPOINT='https://kittens-live-sync.alike-fog.workers.dev';
  var client=null,overlay=null,lastMirrorRender=0;
  var statusEl=null,endpointInput=null,codeInput=null;
  var lastNativeComplicationSnapshot=null;

  function esc(v){return String(v==null?'':v);}

  function normalizedSave(){
    var save=game.save();
    if(!save.game)save.game={};
    save.game.colorScheme='dracula';
    var schemes=Array.isArray(save.game.unlockedSchemes)?save.game.unlockedSchemes.slice():[];
    if(schemes.indexOf('dracula')<0)schemes.unshift('dracula');
    save.game.unlockedSchemes=schemes;
    return save;
  }

  function getSaveText(){
    return game.compressLZData(JSON.stringify(normalizedSave()));
  }

  function applySaveText(text){
    return new Promise(function(resolve,reject){
      try{
        var key='com.nuclearunicorn.kittengame.savedata';
        var backup='com.nuclearunicorn.kittengame.liveSync.backup';
        var previous=LCstorage[key];
        if(previous)LCstorage[backup]=previous;
        game.saveImportText(text,function(error){
          if(error){
            try{if(previous){LCstorage[key]=previous;game.load();game.render();}}catch(e){}
            reject(new Error(String(error)));return;
          }
          try{
            game.opts.enableRedshift=true;
            game.opts.useWorkers=false;
            game.colorScheme='dracula';
            if(!Array.isArray(game.unlockedSchemes))game.unlockedSchemes=[];
            if(game.unlockedSchemes.indexOf('dracula')<0)game.unlockedSchemes.unshift('dracula');
            game.save();game.render();
            try{pushNativeComplicationSnapshot(getResources(),Date.now(),true);}catch(e){}
          }catch(e){}
          resolve();
        });
      }catch(e){reject(e);}
    });
  }

  function getResources(){
    if(!game||!game.resPool)return [];
    return game.resPool.resources
      .filter(function(r){return r.visible||r.craftable||r.unlocked||r.value>0||r.name==='catnip';})
      .map(function(r){
        return {
          name:r.name,
          value:Number(r.value)||0,
          max:Number(r.maxValue)||0,
          rate:game.isPaused?0:((Number(game.getResourcePerTick(r.name,true))||0)*(Number(game.ticksPerSecond)||0))
        };
      });
  }

  function complicationSnapshot(resources,serverTime){
    var now=Date.now();
    var elapsed=Math.max(0,(now-Number(serverTime||now))/1000);
    var out=[];
    for(var i=0;i<(resources||[]).length;i++){
      var incoming=resources[i]||{};
      var local=game&&game.resPool?game.resPool.get(incoming.name):null;
      var rate=Number(incoming.rate)||0;
      var max=Number(incoming.max)||0;
      var value=(Number(incoming.value)||0)+rate*elapsed;
      if(max>0)value=Math.min(max,value);
      out.push({
        name:incoming.name,
        title:(local&&local.title)||incoming.title||incoming.name,
        value:Math.max(0,value),
        max:max,
        rate:rate
      });
    }
    return {at:now,resources:out};
  }

  function nearly(a,b,scaleFactor,min){
    a=Number(a)||0;b=Number(b)||0;
    var scale=Math.max(1,Math.abs(a),Math.abs(b));
    return Math.abs(a-b)<=Math.max(min||0.001,scale*(scaleFactor||1e-5));
  }

  function meaningfulComplicationSnapshot(next){
    var prev=lastNativeComplicationSnapshot;
    if(!prev)return true;
    var old={};
    for(var i=0;i<prev.resources.length;i++)old[prev.resources[i].name]=prev.resources[i];
    if(prev.resources.length!==next.resources.length)return true;
    var dt=Math.max(0,(next.at-prev.at)/1000);
    for(var j=0;j<next.resources.length;j++){
      var n=next.resources[j],p=old[n.name];
      if(!p)return true;
      if(!nearly(n.max,p.max,1e-8,1e-6)||!nearly(n.rate,p.rate,1e-6,1e-7))return true;
      var expected=(Number(p.value)||0)+(Number(p.rate)||0)*dt;
      if(Number(p.max)>0)expected=Math.min(Number(p.max),expected);
      if(!nearly(n.value,expected,1e-5,0.001))return true;
    }
    return false;
  }

  function pushNativeComplicationSnapshot(resources,serverTime,force){
    if(!game||!game.resPool)return;
    var next=complicationSnapshot(resources,serverTime);
    if(!force&&!meaningfulComplicationSnapshot(next))return;
    lastNativeComplicationSnapshot=next;
    fetch('/complication-state',{
      method:'POST',
      body:JSON.stringify({resources:next.resources}),
      keepalive:true,
      cache:'no-store'
    }).catch(function(e){console.warn('Live Sync complication update failed',e);});
  }

  function applyLiveResources(resources,serverTime){
    if(!game||!game.resPool)return;
    var elapsed=Math.max(0,(Date.now()-Number(serverTime||Date.now()))/1000);
    for(var i=0;i<resources.length;i++){
      var incoming=resources[i],r=game.resPool.get(incoming.name);
      if(!r)continue;
      var value=(Number(incoming.value)||0)+(Number(incoming.rate)||0)*elapsed;
      var max=Number(incoming.max)||0;
      if(max>0)value=Math.min(max,value);
      r.value=Math.max(0,value);
    }
    // Feed the same authoritative mirrored values into the native complication
    // store. Passive production is filtered because native complications can
    // project from value+rate; spends, crafts, cap/rate changes update at once.
    pushNativeComplicationSnapshot(resources,serverTime,false);
    if(Date.now()-lastMirrorRender>900){
      lastMirrorRender=Date.now();
      try{game.render();}catch(e){}
    }
  }

  function removeOverlay(){
    if(overlay&&overlay.parentNode)overlay.parentNode.removeChild(overlay);
    overlay=null;
  }

  function showOverlay(message){
    if(!client||!client.getConfig().endpoint){removeOverlay();return;}
    if(!overlay){
      overlay=document.createElement('div');
      overlay.id='wearLiveSyncOverlay';
      overlay.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(40,42,54,.92);display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;color:#f8f8f2;text-align:center;';
      var card=document.createElement('div');
      card.style.cssText='width:100%;max-width:260px;border:1px solid #6272a4;border-radius:12px;padding:14px;background:#282a36;';
      var title=document.createElement('b');title.textContent='Live Sync';
      var p=document.createElement('p');p.id='wearLiveSyncOverlayText';p.style.fontSize='12px';
      var b=document.createElement('button');b.textContent='Take control';b.style.cssText='font-size:13px;padding:9px 12px;';
      b.onclick=function(){if(client)client.claim();};
      card.appendChild(title);card.appendChild(p);card.appendChild(b);overlay.appendChild(card);document.body.appendChild(overlay);
    }
    var p2=document.getElementById('wearLiveSyncOverlayText');if(p2)p2.textContent=message||'The phone owns the live game.';
  }

  function setWritable(writable){
    if(writable)removeOverlay();
    else showOverlay('The phone currently owns the game. Tap Take control to switch to the watch.');
  }

  function setStatus(text){
    if(statusEl)statusEl.textContent=text;
    try{
      var main=document.getElementById('wearStatus');
      if(main&&text&&/control|connected|pair|offline/i.test(text))main.textContent=text;
    }catch(e){}
  }

  function ensureClient(){
    if(client)return client;
    if(!global.KittensLiveSync)throw new Error('Live Sync client is not loaded.');
    client=KittensLiveSync.create({
      deviceId:'watch',
      getSaveText:getSaveText,
      applySaveText:applySaveText,
      getResources:getResources,
      applyLiveResources:applyLiveResources,
      setWritable:setWritable,
      onStatus:function(st){setStatus(st.message||('Live Sync: '+st.role));}
    });
    return client;
  }

  function addButton(parent,label,fn){
    var b=document.createElement('button');
    b.type='button';b.className='wear-button';b.textContent=label;b.onclick=fn;parent.appendChild(b);return b;
  }

  function buildUi(){
    if(document.getElementById('wearLiveSyncPanel'))return;
    var settings=document.getElementById('wearSettings');
    if(!settings)return;

    var panel=document.createElement('div');panel.id='wearLiveSyncPanel';
    panel.style.cssText='border-top:1px solid #44475a;margin-top:10px;padding-top:10px;';
    var h=document.createElement('div');h.className='wear-label';h.textContent='Live Sync';panel.appendChild(h);
    var desc=document.createElement('p');desc.textContent='Real-time phone ↔ watch session. Pair once, then switching devices is automatic.';desc.style.fontSize='11px';panel.appendChild(desc);

    endpointInput=document.createElement('input');
    endpointInput.type='url';endpointInput.placeholder='Worker URL';
    endpointInput.value=(ensureClient().getConfig().endpoint||DEFAULT_ENDPOINT||'');
    endpointInput.style.cssText='width:100%;box-sizing:border-box;margin:5px 0;padding:8px;font-size:11px;';
    panel.appendChild(endpointInput);
    if(DEFAULT_ENDPOINT){endpointInput.style.display='none';}

    codeInput=document.createElement('input');
    codeInput.type='text';codeInput.inputMode='numeric';codeInput.maxLength=6;codeInput.placeholder='6-digit pairing code';
    codeInput.style.cssText='width:100%;box-sizing:border-box;margin:5px 0;padding:8px;font-size:14px;letter-spacing:3px;';
    panel.appendChild(codeInput);

    addButton(panel,'Pair with phone',async function(){
      try{
        var endpoint=String(endpointInput.value||DEFAULT_ENDPOINT||'').trim().replace(/\/+$/,'');
        var code=String(codeInput.value||'').trim();
        setStatus('Live Sync: claiming pairing code…');
        var result=await KittensLiveSync.claimPair({endpoint:endpoint,code:code});
        ensureClient().setConfig({endpoint:endpoint,sessionId:result.sessionId,deviceToken:result.deviceToken});
        setStatus('Live Sync paired. Connecting…');
        client.connect();setTimeout(function(){client.claim();},250);
      }catch(e){setStatus('Live Sync pairing failed: '+e.message);}
    });

    addButton(panel,'Take control on watch',function(){try{ensureClient().claim();}catch(e){setStatus(e.message);}});
    addButton(panel,'Force control (recovery)',function(){
      if(confirm('Force ownership to this watch? Use only if the phone is unavailable; doing this while the phone is actively offline can create divergence.')){
        try{ensureClient().forceClaim();}catch(e){setStatus(e.message);}
      }
    });
    addButton(panel,'Disable Live Sync on watch',function(){
      if(!confirm('Disable Live Sync on this watch?'))return;
      try{ensureClient().clearConfig();removeOverlay();setStatus('Live Sync disabled.');}catch(e){}
    });

    statusEl=document.createElement('p');statusEl.id='wearLiveSyncStatus';statusEl.style.cssText='font-size:11px;white-space:pre-wrap;';
    panel.appendChild(statusEl);
    settings.insertBefore(panel,settings.firstChild);

    var cfg=ensureClient().getConfig();
    if(cfg.endpoint&&cfg.sessionId&&cfg.deviceToken){
      codeInput.style.display='none';
      setStatus('Live Sync configured. Connecting…');
      client.connect();
    }else{
      setStatus('Live Sync not paired yet.');
    }
  }

  function init(){
    if(!global.game||!game.resPool||!document.getElementById('wearSettings'))return false;
    ensureClient();buildUi();
    return true;
  }

  function scheduleCommit(delay){
    try{if(client)client.scheduleCommit(delay==null?180:delay);}catch(e){}
  }

  global.KittensLiveSyncWear={
    init:init,
    scheduleCommit:scheduleCommit,
    getStatus:function(){return client?{role:client.getRole(),config:client.getConfig(),serverState:client.getServerState()}:{role:'offline',config:{}};}
  };

  (function autoInit(){try{if(init())return;}catch(e){}setTimeout(autoInit,250);})();
})(window);
