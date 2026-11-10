(function(global){
  'use strict';

  var KEY='com.nuclearunicorn.kittengame.resourceTracker.name';
  var timer=0;
  var lastSignature='';

  // Capacitor's generated Plugins registry can omit methods in APKs patched
  // after the Android project was originally built. nativePromise dispatches
  // directly to the native plugin (by class/method name), bypassing that proxy.
  function nativeReady(){
    return !!(global.Capacitor&&typeof global.Capacitor.nativePromise==='function');
  }

  function selected(){
    try{return localStorage.getItem(KEY)||'';}catch(e){return '';}
  }

  function saveSelected(name){
    try{
      if(name)localStorage.setItem(KEY,name);
      else localStorage.removeItem(KEY);
    }catch(e){}
  }

  function snapshot(name){
    if(!global.game||!game.resPool||!name)return null;
    var r=game.resPool.get(name);
    if(!r)return null;
    var rate=0;
    try{
      // game.isPaused becomes true on ordinary Android Activity backgrounding.
      // Offline production continues while the WebView sleeps, so retain rate.
      rate=(Number(game.getResourcePerTick(r.name,true))||0)*(Number(game.ticksPerSecond)||0);
    }catch(e){}
    return {
      name:r.name,
      title:r.title||r.name,
      value:Number(r.value)||0,
      max:Number(r.maxValue)||0,
      rate:Number(rate)||0
    };
  }

  function requestNotificationPermission(done){
    try{
      var p=global.cordova&&cordova.plugins&&cordova.plugins.notification&&cordova.plugins.notification.local;
      if(!p){done(true);return;}
      p.hasPermission(function(granted){
        if(granted){done(true);return;}
        if(p.requestPermission){
          p.requestPermission(function(ok){done(ok!==false);});
        }else if(p.registerPermission){
          p.registerPermission(function(ok){done(ok!==false);});
        }else{
          done(true);
        }
      });
    }catch(e){done(true);}
  }

  function call(method,args){
    if(!nativeReady()){
      return Promise.reject(new Error('Capacitor Android bridge is unavailable; cannot '+method+' resource tracker.'));
    }
    try{
      return Promise.resolve(global.Capacitor.nativePromise('KittensResourceTracker',method,args||{}));
    }catch(e){return Promise.reject(e);}
  }

  function start(name){
    name=String(name||'');
    if(!name)return stop();
    var data=snapshot(name);
    if(!data)return Promise.reject(new Error('Resource is not available yet.'));
    return new Promise(function(resolve,reject){
      requestNotificationPermission(function(granted){
        if(!granted){reject(new Error('Notification permission was not granted.'));return;}
        call('start',data).then(function(){
          saveSelected(name);
          lastSignature='';
          sync(true);
          resolve();
        }).catch(reject);
      });
    });
  }

  function stop(){
    saveSelected('');
    lastSignature='';
    return call('stop',{}).catch(function(){});
  }

  function sync(force){
    var name=selected();
    if(!name)return;
    var data=snapshot(name);
    if(!data)return;
    var sig=[
      data.name,
      Math.round(data.value*1000000)/1000000,
      Math.round(data.max*1000000)/1000000,
      Math.round(data.rate*1000000)/1000000
    ].join('|');
    if(!force&&sig===lastSignature)return;
    lastSignature=sig;
    call('update',data).catch(function(err){console.warn('Kittens resource tracker update failed:',err&&err.message||String(err));});
  }

  function items(){
    var out=[{value:'',label:'Off'}];
    if(!global.game||!game.resPool||!game.resPool.resources)return out;
    var seen={};
    var resources=game.resPool.resources.slice(0);
    resources.sort(function(a,b){
      var aa=String(a.title||a.name||'').toLowerCase();
      var bb=String(b.title||b.name||'').toLowerCase();
      return aa<bb?-1:aa>bb?1:0;
    });
    for(var i=0;i<resources.length;i++){
      var r=resources[i];
      if(!r||!r.name||seen[r.name])continue;
      if(!(r.visible||r.craftable||r.unlocked||Number(r.value)>0||Number(r.maxValue)>0||r.name==='catnip'))continue;
      seen[r.name]=true;
      out.push({value:r.name,label:r.title||r.name});
    }
    var current=selected();
    if(current&&!seen[current]){
      var rr=game.resPool.get(current);
      if(rr)out.push({value:current,label:rr.title||rr.name});
    }
    return out;
  }

  function status(){
    return call('status',{}).then(function(result){
      var out=result||{};
      out.error=false;
      out.bridgePresent=nativeReady();
      out.pluginPresent=true;
      return out;
    }).catch(function(err){
      var message=err&&err.message?err.message:String(err||'Unknown native bridge error');
      console.warn('Kittens resource tracker native status failed:',message);
      return {
        enabled:false,
        error:true,
        errorMessage:message,
        bridgePresent:nativeReady(),
        pluginPresent:null,
        statusMethodPresent:null
      };
    });
  }

  function openSettings(){
    return call('openLiveUpdateSettings',{}).catch(function(){});
  }

  function init(){
    if(timer)return;
    timer=setInterval(function(){sync(false);},1000);
    document.addEventListener('visibilitychange',function(){
      if(document.hidden)sync(true);
      else setTimeout(function(){sync(true);},250);
    });
    window.addEventListener('pageshow',function(){setTimeout(function(){sync(true);},300);});
    setTimeout(function(){
      var name=selected();
      if(name&&snapshot(name)){
        call('start',snapshot(name)).catch(function(err){console.warn('Kittens resource tracker restore failed:',err&&err.message||String(err));});
      }
    },1200);
  }

  global.KittensResourceTracker={
    init:init,
    getSelected:selected,
    setSelected:start,
    stop:stop,
    sync:sync,
    items:items,
    status:status,
    openSettings:openSettings
  };

  (function autoInit(){
    try{
      if(global.game&&game.resPool&&nativeReady()){init();return;}
    }catch(e){}
    setTimeout(autoInit,250);
  })();
})(window);
