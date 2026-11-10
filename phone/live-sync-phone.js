(function(global){
  'use strict';

  var SETUP_KEY='com.nuclearunicorn.kittengame.liveSync.phoneSetup';
  var SAVE_KEY='com.nuclearunicorn.kittengame.savedata';
  var PENDING_RESET_KEY='com.nuclearunicorn.kittengame.liveSync.phone.pendingReset';
  var DEFAULT_ENDPOINT='https://kittens-live-sync.alike-fog.workers.dev';
  var client=null;
  var status={configured:false,role:'offline',message:'Live Sync is not configured.',pairCode:null,pairExpiresAt:0};
  var overlay=null,lastMirrorRender=0;
  var resetPublishing=false;

  function emit(message,extra){
    status.message=message||status.message;
    if(extra)for(var k in extra)status[k]=extra[k];
    try{global.dispatchEvent(new CustomEvent('kittens-live-sync-phone-status',{detail:getStatus()}));}catch(e){}
  }

  function randomHex(bytes){
    var a=new Uint8Array(bytes);crypto.getRandomValues(a);
    var out='';for(var i=0;i<a.length;i++)out+=a[i].toString(16).padStart(2,'0');
    return out;
  }

  function readSetup(){
    try{return JSON.parse(localStorage.getItem(SETUP_KEY)||'{}');}catch(e){return {};}
  }

  function writeSetup(value){
    localStorage.setItem(SETUP_KEY,JSON.stringify(value||{}));
  }

  function getStatus(){
    var out={};for(var k in status)out[k]=status[k];
    if(client){
      out.config=client.getConfig();
      out.role=client.getRole();
      out.serverState=client.getServerState();
      out.configured=!!(out.config.endpoint&&out.config.sessionId&&out.config.deviceToken);
    }
    return out;
  }

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
        if(localStorage.getItem(PENDING_RESET_KEY)){resolve();return;}
        var key=SAVE_KEY;
        var backup='com.nuclearunicorn.kittengame.liveSync.backup';
        var previous=LCstorage[key];
        if(previous)LCstorage[backup]=previous;
        game.saveImportDropboxText(text,function(error){
          if(error){
            try{if(previous){LCstorage[key]=previous;game.load();game.render();}}catch(e){}
            reject(new Error(String(error)));return;
          }
          try{
            game.colorScheme='dracula';
            if(!Array.isArray(game.unlockedSchemes))game.unlockedSchemes=[];
            if(game.unlockedSchemes.indexOf('dracula')<0)game.unlockedSchemes.unshift('dracula');
            game.save();game.render();
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
          title:r.title||r.name,
          value:Number(r.value)||0,
          max:Number(r.maxValue)||0,
          rate:game.isPaused?0:((Number(game.getResourcePerTick(r.name,true))||0)*(Number(game.ticksPerSecond)||0))
        };
      });
  }

  function applyLiveResources(resources,serverTime){
    if(!game||!game.resPool)return;
    var elapsed=Math.max(0,(Date.now()-Number(serverTime||Date.now()))/1000);
    for(var i=0;i<resources.length;i++){
      var incoming=resources[i],r=game.resPool.get(incoming.name);
      if(!r)continue;
      var value=Number(incoming.value)||0;
      var rate=Number(incoming.rate)||0;
      var max=Number(incoming.max)||0;
      value+=rate*elapsed;
      if(max>0)value=Math.min(max,value);
      r.value=Math.max(0,value);
    }
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
      overlay.id='kittensLiveSyncControlOverlay';
      overlay.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(40,42,54,.86);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:sans-serif;color:#f8f8f2;text-align:center;';
      var card=document.createElement('div');
      card.style.cssText='max-width:420px;background:#282a36;border:1px solid #6272a4;border-radius:14px;padding:20px;box-shadow:0 12px 45px rgba(0,0,0,.55);';
      var title=document.createElement('h2');title.textContent='Kittens Live Sync';title.style.marginTop='0';
      var p=document.createElement('p');p.id='kittensLiveSyncOverlayText';
      var b=document.createElement('button');b.textContent='Take control on this phone';b.style.cssText='padding:12px 16px;font-size:16px;';
      b.onclick=function(){if(client)client.claim();};
      card.appendChild(title);card.appendChild(p);card.appendChild(b);overlay.appendChild(card);document.body.appendChild(overlay);
    }
    var text=document.getElementById('kittensLiveSyncOverlayText');if(text)text.textContent=message||'The watch currently owns the live game.';
  }

  function setWritable(writable){
    if(writable)removeOverlay();
    else showOverlay('The other device currently owns the live game. Tap below to hand control to this phone.');
  }

  function pendingResetText(){
    return localStorage.getItem(PENDING_RESET_KEY)||'';
  }

  function publishPendingReset(){
    if(resetPublishing||!client)return;
    var resetText=pendingResetText();
    if(!resetText)return;
    if(client.getRole()!=='owner'){
      emit('Reset prepared · waiting for Live Sync control…');
      client.claim();
      return;
    }

    resetPublishing=true;
    emit('Publishing reset to Live Sync…');
    client.releaseSaveText(resetText,10000).then(function(){
      resetPublishing=false;
      try{LCstorage[SAVE_KEY]=resetText;}catch(e){}
      localStorage.removeItem(PENDING_RESET_KEY);
      emit('Reset synchronized. Reloading…');
      window.location.reload();
    }).catch(function(e){
      resetPublishing=false;
      try{LCstorage[SAVE_KEY]=resetText;}catch(ignore){}
      emit('Reset prepared · retrying Live Sync: '+e.message);
      setTimeout(function(){
        if(!client)return;
        if(client.getRole()==='owner')publishPendingReset();
        else client.claim();
      },900);
    });
  }

  function installResetBridge(){
    if(!global.game||game.__liveSyncResetPatched)return;
    var originalResetAutomatic=game.resetAutomatic;
    if(typeof originalResetAutomatic!=='function'||typeof game._resetInternal!=='function')return;

    game.resetAutomatic=function(){
      var cfg=client&&client.getConfig?client.getConfig():{};
      if(!client||!cfg.endpoint||!cfg.sessionId||!cfg.deviceToken){
        return originalResetAutomatic.apply(this,arguments);
      }

      var self=this;
      this.timer.scheduleEvent(dojo.hitch(this,function(){
        try{
          self._resetInternal();
          self.mobileSaveOnPause=false;
          var resetText=LCstorage[SAVE_KEY];
          if(!resetText)throw new Error('Kittens Game did not produce a post-reset save.');
          localStorage.setItem(PENDING_RESET_KEY,resetText);
          publishPendingReset();
        }catch(e){
          emit('Reset failed before Live Sync publish: '+e.message);
        }
      }));
    };
    game.__liveSyncResetPatched=true;
  }

  function ensureClient(){
    if(client)return client;
    if(!global.KittensLiveSync)throw new Error('Live Sync client module is not loaded.');
    client=KittensLiveSync.create({
      deviceId:'phone',
      getSaveText:getSaveText,
      applySaveText:applySaveText,
      getResources:getResources,
      applyLiveResources:applyLiveResources,
      setWritable:setWritable,
      onStatus:function(st){
        status.role=st.role;status.configured=!!(st.config&&st.config.endpoint);
        emit(st.message||status.message,{role:st.role,serverState:st.serverState});
        if(st.role==='owner'&&pendingResetText())setTimeout(publishPendingReset,0);
      }
    });
    return client;
  }

  function init(){
    if(!global.game||typeof game.save!=='function'||!global.KittensLiveSync)return false;
    ensureClient();
    installResetBridge();
    var cfg=client.getConfig();
    if(cfg.endpoint&&cfg.sessionId&&cfg.deviceToken){
      status.configured=true;
      client.connect();
    }
    return true;
  }

  async function initialize(endpoint){
    ensureClient();
    endpoint=String(endpoint||'').trim().replace(/\/+$/,'');
    if(!endpoint)throw new Error('Enter the deployed Live Sync Worker URL first.');
    var setup=readSetup();
    if(!setup.sessionId)setup.sessionId='kg-'+randomHex(8);
    if(!setup.adminSecret)setup.adminSecret=randomHex(32);
    setup.endpoint=endpoint;
    emit('Creating the live session from this phone…');
    var result=await KittensLiveSync.bootstrap({
      endpoint:endpoint,
      sessionId:setup.sessionId,
      adminSecret:setup.adminSecret,
      deviceId:'phone',
      saveText:getSaveText()
    });
    writeSetup(setup);
    client.setConfig({endpoint:endpoint,sessionId:result.sessionId,deviceToken:result.deviceToken});
    if(result.state&&result.state.revision)client.setLastRevision(result.state.revision);
    status.configured=true;
    client.connect();
    setTimeout(function(){client.claim();},250);
    emit('Live Sync initialized. This phone is the canonical starting state.');
    return result;
  }

  async function createWatchPairCode(){
    ensureClient();
    var cfg=client.getConfig();
    if(!cfg.endpoint||!cfg.sessionId||!cfg.deviceToken)throw new Error('Initialize Live Sync on the phone first.');
    emit('Creating a one-time watch pairing code…');
    var result=await KittensLiveSync.createPairCode({
      endpoint:cfg.endpoint,sessionId:cfg.sessionId,deviceId:'phone',deviceToken:cfg.deviceToken
    });
    status.pairCode=result.code;status.pairExpiresAt=result.expiresAt;
    emit('Watch pairing code: '+result.code,{pairCode:result.code,pairExpiresAt:result.expiresAt});
    return result;
  }

  function takeControl(){ensureClient();return client.claim();}
  function forceControl(){ensureClient();return client.forceClaim();}
  function scheduleCommit(delay){if(client)client.scheduleCommit(delay);}
  function pushLiveNow(){return client?client.pushLiveNow():false;}
  function commitNow(){return client?client.commitNow():Promise.resolve({ok:false,type:'not-ready'});}
  function getEndpoint(){var cfg=client?client.getConfig():{};return cfg.endpoint||readSetup().endpoint||DEFAULT_ENDPOINT||'';}
  function disable(){
    if(client){client.clearConfig();client=null;}
    removeOverlay();status={configured:false,role:'offline',message:'Live Sync disabled; GitHub fallback remains available.',pairCode:null,pairExpiresAt:0};
    emit(status.message);
  }

  global.KittensLiveSyncPhone={
    init:init,initialize:initialize,createWatchPairCode:createWatchPairCode,takeControl:takeControl,
    forceControl:forceControl,scheduleCommit:scheduleCommit,pushLiveNow:pushLiveNow,commitNow:commitNow,getStatus:getStatus,
    getEndpoint:getEndpoint,disable:disable
  };

  (function autoInit(){try{if(init())return;}catch(e){}setTimeout(autoInit,250);})();
})(window);
