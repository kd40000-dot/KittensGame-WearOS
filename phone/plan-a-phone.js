(function(global){
  'use strict';

  var TOKEN_KEY='com.nuclearunicorn.kittengame.planA.githubToken';
  var OWNER='kd40000-dot',REPO='KittensGame-Sync',BRANCH='main';
  var planA=null,mailbox=null,cloud=null,syncTimer=0,syncBusy=false,syncAgain=false;
  var status={configured:false,verified:false,busy:false,message:'Plan A is not configured.',lastResult:null};

  function emit(message,extra){
    status.message=message||status.message;
    if(extra){for(var k in extra){if(Object.prototype.hasOwnProperty.call(extra,k)){status[k]=extra[k];}}}
    try{window.dispatchEvent(new CustomEvent('kittens-plan-a-status',{detail:getStatus()}));}catch(e){}
  }
  function getStatus(){
    var out={};for(var k in status){if(Object.prototype.hasOwnProperty.call(status,k)){out[k]=status[k];}}
    out.configured=!!getToken();
    out.localJournal=planA?planA.journal().length:0;
    out.cloudState=cloud?cloud.loadState():{};
    return out;
  }
  function getToken(){return (localStorage.getItem(TOKEN_KEY)||'').trim();}
  function setToken(token){
    token=(token||'').trim();
    if(!token){localStorage.removeItem(TOKEN_KEY);emit('GitHub token cleared.',{verified:false});return;}
    localStorage.setItem(TOKEN_KEY,token);emit('GitHub token stored in this app only.',{verified:false});
  }
  function request(req){
    var token=getToken();
    if(!token)return Promise.reject(new Error('GitHub token is not configured.'));
    var options={
      method:req.method||'GET',
      headers:{
        'Accept':'application/vnd.github+json',
        'Authorization':'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28'
      },
      cache:'no-store'
    };
    if(req.json!==undefined){
      options.headers['Content-Type']='application/json';
      options.body=JSON.stringify(req.json);
    }
    return fetch('https://api.github.com'+req.path,options).then(function(r){
      return r.text().then(function(body){return {status:r.status,body:body};});
    });
  }
  function ensureRuntime(){
    if(planA&&mailbox&&cloud)return;
    if(!global.KittensPlanA||!global.KittensGitHubMailbox||!global.KittensPlanACloud||!global.KittensPlanAOrchestrator){
      throw new Error('Plan A runtime modules are not loaded.');
    }
    planA=KittensPlanA.create({
      deviceId:'phone',
      getSave:function(){return game.save();},
      onEntry:function(){scheduleAutoSync();}
    });
    planA.attach();
    if(!planA.getCheckpoint())planA.checkpoint(game.save());
    mailbox=KittensGitHubMailbox.create({owner:OWNER,repo:REPO,branch:BRANCH,request:request});
    cloud=KittensPlanACloud.create({
      deviceId:'phone',
      planA:planA,
      mailbox:mailbox,
      getSave:function(){return game.save();},
      applySave:function(save){return importSaveObject(save);}
    });
    emit(getToken()?'Plan A ready. Verify GitHub access.':'Plan A ready. Add your GitHub token.',{configured:!!getToken()});
  }
  function importSaveObject(save){
    return new Promise(function(resolve,reject){
      try{
        game.save();
        var key='com.nuclearunicorn.kittengame.savedata';
        var backup='com.nuclearunicorn.kittengame.planA.backup';
        var previous=LCstorage[key];
        if(previous)LCstorage[backup]=previous;
        var text=game.compressLZData(JSON.stringify(save));
        game.saveImportDropboxText(text,function(error){
          if(error){
            try{if(previous){LCstorage[key]=previous;game.load();game.render();}}catch(e){}
            reject(new Error(String(error)));
            return;
          }
          resolve();
        });
      }catch(e){reject(e);}
    });
  }
  function verify(){
    ensureRuntime();
    emit('Checking private GitHub mailbox…',{busy:true});
    return mailbox.verifyPrivate().then(function(info){
      emit('GitHub connected to private '+info.fullName+'.',{busy:false,verified:true,lastResult:info});
      return info;
    }).catch(function(e){
      emit('GitHub check failed: '+e.message,{busy:false,verified:false});
      throw e;
    });
  }
  function bootstrap(){
    ensureRuntime();
    emit('Initializing canonical revision from this phone…',{busy:true});
    return verify().then(function(){return cloud.bootstrapFromLocal();}).then(function(r){
      emit(r.created?'Canonical Plan A baseline created from this phone.':'Canonical Plan A baseline already exists.',{busy:false,lastResult:r});
      return r;
    }).catch(function(e){emit('Plan A initialization failed: '+e.message,{busy:false});throw e;});
  }
  function syncNow(){
    ensureRuntime();
    if(syncBusy){syncAgain=true;return Promise.resolve({ok:true,type:'queued'});}
    syncBusy=true;status.busy=true;emit('Syncing with GitHub…');
    return verify()
      .then(function(){return cloud.publishLocal();})
      .then(function(pub){
        if(pub&&pub.type==='needs-bootstrap')throw new Error('Canonical sync has not been initialized yet.');
        return cloud.reconcileCloud().then(function(rec){return {pub:pub,rec:rec};});
      })
      .then(function(x){
        if(!x.rec.ok){
          if(x.rec.type==='merge-conflict'){
            emit('Plan A found a merge conflict. Your local save was not replaced.',{busy:false,lastResult:x.rec});
            return x.rec;
          }
          if(x.rec.retry)throw new Error('Another device updated the canonical revision at the same time. Retry sync.');
          throw new Error('Cloud reconciliation failed: '+x.rec.type);
        }
        return cloud.pullCanonical().then(function(pull){
          var result={ok:true,type:x.rec.type,publish:x.pub,reconcile:x.rec,pull:pull};
          emit('Plan A synced successfully ('+x.rec.type+').',{busy:false,lastResult:result});
          return result;
        });
      })
      .catch(function(e){emit('Plan A sync failed: '+e.message,{busy:false});throw e;})
      .finally(function(){
        syncBusy=false;status.busy=false;
        if(syncAgain){syncAgain=false;scheduleAutoSync(400);}
      });
  }
  function scheduleAutoSync(delay){
    if(!getToken())return;
    clearTimeout(syncTimer);
    syncTimer=setTimeout(function(){syncNow().catch(function(){});},delay==null?800:delay);
  }
  function normalizeWatchUrl(value){
    value=(value||'').trim();
    if(!value)throw new Error('Enter or scan the current watch Transfer save URL first.');
    if(!/^https?:\/\//i.test(value))value='http://'+value;
    if(value.charAt(value.length-1)!=='/')value+='/';
    if(!/^http:\/\/[^/]+:18743\/t\/[0-9a-f]+\/$/i.test(value))throw new Error('That is not a Kittens Wear transfer URL.');
    return value;
  }
  function b64ToBytes(s){
    var bin=atob((s||'').replace(/\s/g,'')),out=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes){
    var bin='',a=new Uint8Array(bytes);
    for(var i=0;i<a.length;i++)bin+=String.fromCharCode(a[i]);
    return btoa(bin);
  }
  function provisionWatch(watchUrl){
    var token=getToken();if(!token)return Promise.reject(new Error('Configure the GitHub token on the phone first.'));
    var base=normalizeWatchUrl(watchUrl);
    emit('Getting watch encryption key…',{busy:true});
    return fetch(base+'github-key',{cache:'no-store'}).then(function(r){return r.json();}).then(function(keyInfo){
      if(keyInfo.state!=='success'||!keyInfo.publicKeySpkiBase64)throw new Error(keyInfo.message||'Watch did not provide a pairing key.');
      return crypto.subtle.importKey('spki',b64ToBytes(keyInfo.publicKeySpkiBase64),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    }).then(function(pub){
      var plain=new TextEncoder().encode(JSON.stringify({owner:OWNER,repo:REPO,branch:BRANCH,token:token}));
      return crypto.subtle.encrypt({name:'RSA-OAEP'},pub,plain);
    }).then(function(ciphertext){
      return fetch(base+'github-config',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ciphertext:bytesToB64(ciphertext)}),cache:'no-store'
      });
    }).then(function(r){return r.json();}).then(function(result){
      if(result.state!=='success')throw new Error(result.message||'Watch rejected GitHub configuration.');
      emit('Watch GitHub access provisioned securely.',{busy:false,lastResult:result});
      return result;
    }).catch(function(e){emit('Watch provisioning failed: '+e.message,{busy:false});throw e;});
  }
  function init(){
    if(!window.game||typeof game.save!=='function')return false;
    ensureRuntime();return true;
  }

  global.KittensPlanAPhone={
    init:init,getStatus:getStatus,getToken:getToken,setToken:setToken,verify:verify,bootstrap:bootstrap,
    syncNow:syncNow,scheduleAutoSync:scheduleAutoSync,provisionWatch:provisionWatch,normalizeWatchUrl:normalizeWatchUrl
  };
  (function autoInit(){try{if(init())return;}catch(e){}setTimeout(autoInit,250);})();
})(window);
