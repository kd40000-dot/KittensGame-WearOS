(function(global){
  'use strict';

  var TOKEN_KEY='com.nuclearunicorn.kittengame.planA.githubToken';
  var OWNER='kd40000-dot',REPO='KittensGame-Sync',BRANCH='main';
  var planA=null,mailbox=null,cloud=null,syncTimer=0,syncBusy=false,syncAgain=false,pollTimer=0,conflictModal=null,activeConflictId=null,conflictDismissedUntil=0;
  var status={configured:false,verified:false,busy:false,message:'Plan A is not configured.',lastResult:null};

  function normalizeDraculaSave(save){
    if(!save||typeof save!=='object')return save;
    if(!save.game)save.game={};
    save.game.colorScheme='dracula';
    var schemes=Array.isArray(save.game.unlockedSchemes)?save.game.unlockedSchemes.slice():[];
    if(schemes.indexOf('dracula')<0)schemes.unshift('dracula');
    save.game.unlockedSchemes=schemes;
    return save;
  }
  function getDraculaSave(){
    return normalizeDraculaSave(game.save());
  }

  function installIronWillGuard(){
    if(!window.game||!game.settings||!game.opts)return false;
    var settingName='hideIronWillBreakers';
    var settingsArr=game.settings.settingsArr||[];
    var found=false;
    for(var i=0;i<settingsArr.length;i++){
      if(settingsArr[i]&&settingsArr[i].name===settingName){found=true;break;}
    }
    if(!found){
      settingsArr.push({
        name:settingName,
        defaultValue:false,
        label:'Hide Iron Will-breaking purchases',
        mobileTitle:'Hide Iron Will-breaking purchases',
        mobileDesc:'While Iron Will is active, hides and blocks anything the game marks as breaking Iron Will.',
        tooltip:'While Iron Will is active, hides and blocks anything the game marks as breaking Iron Will.',
        triggerUpdateUI:true,
        onChange:function(g){try{g.render();}catch(e){}}
      });
    }
    if(typeof game.opts[settingName]!=='boolean')game.opts[settingName]=false;

    var uiRoot=global.com&&com.nuclearunicorn&&com.nuclearunicorn.game&&com.nuclearunicorn.game.ui;
    if(!uiRoot||!uiRoot.BuildingBtnController||!uiRoot.BuildingStackableBtnController)return false;

    var baseProto=uiRoot.BuildingBtnController.prototype;
    if(!baseProto.__ironWillGuardVisiblePatched){
      var originalVisible=baseProto.updateVisible;
      baseProto.updateVisible=function(model){
        if(originalVisible)originalVisible.apply(this,arguments);
        if(this.game&&this.game.ironWill&&this.game.opts&&this.game.opts.hideIronWillBreakers&&
           model&&model.metadata&&model.metadata.breakIronWill){
          model.visible=false;
        }
      };
      baseProto.__ironWillGuardVisiblePatched=true;
    }

    var stackProto=uiRoot.BuildingStackableBtnController.prototype;
    function protectedPurchase(ctrl,model){
      return !!(ctrl&&ctrl.game&&ctrl.game.ironWill&&ctrl.game.opts&&ctrl.game.opts.hideIronWillBreakers&&
        model&&model.metadata&&model.metadata.breakIronWill);
    }
    if(!stackProto.__ironWillGuardBuyPatched){
      var originalBuy=stackProto.buyItem;
      stackProto.buyItem=function(model){
        if(protectedPurchase(this,model))return {itemBought:false,reason:'iron-will-protected'};
        return originalBuy.apply(this,arguments);
      };
      var originalBuild=stackProto.build;
      stackProto.build=function(model){
        if(protectedPurchase(this,model))return 0;
        return originalBuild.apply(this,arguments);
      };
      stackProto.__ironWillGuardBuyPatched=true;
    }
    return true;
  }
  function installIronWillPhoneOptionsUi(){
    if(!global.React||!global.WOptionsPopup||!global.WSimpleOpt)return false;
    var proto=global.WOptionsPopup.prototype;
    if(!proto||proto.__ironWillGuardUiPatched)return true;
    var originalRender=proto.render;
    if(typeof originalRender!=='function')return false;
    proto.render=function(){
      var root=originalRender.apply(this,arguments);
      try{
        var rootChildren=React.Children.toArray(root.props.children);
        var page=rootChildren[1];
        if(!page||!page.props)return root;
        var pageChildren=React.Children.toArray(page.props.children);
        var pageContent=pageChildren[0];
        if(!pageContent||!pageContent.props)return root;
        var contentChildren=React.Children.toArray(pageContent.props.children);
        var listBlock=contentChildren[1];
        if(!listBlock||!listBlock.props)return root;
        var optionChildren=React.Children.toArray(listBlock.props.children);
        var alreadyThere=optionChildren.some(function(child){
          return child&&child.props&&child.props.opt==='hideIronWillBreakers';
        });
        if(!alreadyThere){
          optionChildren.push(React.createElement(global.WSimpleOpt,{
            key:'iron-will-protection',
            title:'Hide Iron Will-breaking purchases',
            opt:'hideIronWillBreakers',
            desc:'While Iron Will is active, hides and blocks purchases that would end Iron Will mode.'
          }));
        }
        contentChildren[1]=React.cloneElement(listBlock,listBlock.props,optionChildren);
        pageChildren[0]=React.cloneElement(pageContent,pageContent.props,contentChildren);
        rootChildren[1]=React.cloneElement(page,page.props,pageChildren);
        return React.cloneElement(root,root.props,rootChildren);
      }catch(e){
        console.warn('Iron Will phone option injection failed',e);
        return root;
      }
    };
    proto.__ironWillGuardUiPatched=true;
    return true;
  }

  function ensureIronWillPhoneOptionsUi(){
    if(installIronWillPhoneOptionsUi())return;
    setTimeout(ensureIronWillPhoneOptionsUi,250);
  }

  function armIronWillPhoneOptionsUi(){
    if(global.WOptionsPopup){
      installIronWillPhoneOptionsUi();
      return true;
    }
    try{
      var d=Object.getOwnPropertyDescriptor(global,'WOptionsPopup');
      if(d&&!d.configurable)return false;
      Object.defineProperty(global,'WOptionsPopup',{
        configurable:true,
        get:function(){return undefined;},
        set:function(value){
          Object.defineProperty(global,'WOptionsPopup',{
            value:value,writable:true,enumerable:true,configurable:true
          });
          installIronWillPhoneOptionsUi();
        }
      });
      return true;
    }catch(e){
      console.warn('Could not arm Iron Will mobile Options hook',e);
      return false;
    }
  }

  function forceDraculaLocal(){
    if(!window.game)return;
    game.colorScheme='dracula';
    if(!Array.isArray(game.unlockedSchemes))game.unlockedSchemes=[];
    if(game.unlockedSchemes.indexOf('dracula')<0)game.unlockedSchemes.unshift('dracula');
    try{if(game.ui&&game.ui.updateOptions)game.ui.updateOptions();}catch(e){console.warn('Could not apply Dracula UI',e);}
  }

  function emit(message,extra){
    status.message=message||status.message;
    if(extra){for(var k in extra){if(Object.prototype.hasOwnProperty.call(extra,k)){status[k]=extra[k];}}}
    try{window.dispatchEvent(new CustomEvent('kittens-plan-a-status',{detail:getStatus()}));}catch(e){}
  }

  function conflictSummary(conflict){
    var parts=[];
    (conflict&&conflict.conflicts||[]).forEach(function(c){
      var who=c.deviceId==='watch'?'Watch':c.deviceId==='phone'?'Phone':'Device';
      var label=(c.label||'action').replace(/<[^>]+>/g,'');
      var reason=c.reason==='resource-would-go-negative'?'would overspend a shared resource':
                 c.reason==='set-conflict'?'changes the same game state differently':(c.reason||'conflicts');
      parts.push(who+': '+label+' — '+reason+(c.path?' ('+c.path+')':''));
    });
    return parts.length?parts.slice(0,8):['Phone and watch both changed from the same common revision and cannot be merged automatically.'];
  }

  function closeConflictModal(){
    if(conflictModal&&conflictModal.parentNode)conflictModal.parentNode.removeChild(conflictModal);
    conflictModal=null;
  }

  function resolveConflictChoice(choice){
    if(!cloud)return Promise.reject(new Error('Plan A cloud is not ready.'));
    var labels={phone:'Phone',watch:'Watch',canonical:'Current canonical'};
    emit('Resolving merge conflict using '+labels[choice]+'…',{busy:true});
    return cloud.resolveConflict(choice).then(function(r){
      if(!r.ok){
        if(r.retry){scheduleAutoSync(700);throw new Error('Canonical changed while resolving. Please retry.');}
        throw new Error('Conflict resolution failed: '+r.type);
      }
      return cloud.pullCanonical().then(function(pull){
        closeConflictModal();
        activeConflictId=null;
        conflictDismissedUntil=0;
        emit('Merge conflict resolved using '+labels[choice]+'.',{busy:false,lastResult:r});
        scheduleAutoSync(500);
        return {resolution:r,pull:pull};
      });
    }).catch(function(e){
      emit('Conflict resolution failed: '+e.message,{busy:false});
      throw e;
    });
  }

  function showConflictModal(conflict,force){
    if(!conflict||conflict.state!=='active')return;
    if(!force&&Date.now()<conflictDismissedUntil&&activeConflictId===conflict.id)return;
    if(conflictModal&&activeConflictId===conflict.id)return;
    closeConflictModal();
    activeConflictId=conflict.id;

    var overlay=document.createElement('div');
    overlay.id='kittensPlanAConflictOverlay';
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;font-family:sans-serif;';
    var card=document.createElement('div');
    card.style.cssText='width:min(520px,100%);max-height:88vh;overflow:auto;background:#282a36;color:#f8f8f2;border:1px solid #44475a;border-radius:12px;padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.65);box-sizing:border-box;';
    var h=document.createElement('h2');h.textContent='Plan A merge conflict';h.style.cssText='margin:0 0 10px;color:#bd93f9;';
    var p=document.createElement('p');p.textContent='Phone and watch both changed while apart, and these changes cannot be combined safely. Nothing has been overwritten. Choose which complete branch should become canonical.';
    card.appendChild(h);card.appendChild(p);

    var list=document.createElement('div');list.style.cssText='background:#21222c;border:1px solid #44475a;border-radius:8px;padding:10px;margin:12px 0;';
    conflictSummary(conflict).forEach(function(line){var row=document.createElement('div');row.textContent=line;row.style.cssText='margin:5px 0;color:#bfc3d5;font-size:13px;';list.appendChild(row);});
    card.appendChild(list);

    var note=document.createElement('p');note.textContent='Keep Phone or Keep Watch uses that device’s exact conflict snapshot. Keep Current Canonical discards both conflicting branches and returns to the last accepted shared state.';note.style.cssText='font-size:13px;color:#bfc3d5;';
    card.appendChild(note);

    function addButton(label,choice,accent){
      var b=document.createElement('button');b.textContent=label;
      b.style.cssText='display:block;width:100%;margin:8px 0;padding:12px;border-radius:8px;border:1px solid '+(accent||'#44475a')+';background:#343746;color:#f8f8f2;font-weight:600;';
      b.onclick=function(){
        if(!window.confirm('Use '+label+' to resolve this conflict? The other conflicting branch will be discarded from the canonical save.'))return;
        Array.prototype.forEach.call(card.querySelectorAll('button'),function(x){x.disabled=true;});
        b.textContent='Resolving…';
        resolveConflictChoice(choice).catch(function(err){
          window.alert('Conflict resolution failed: '+err.message);
          Array.prototype.forEach.call(card.querySelectorAll('button'),function(x){x.disabled=false;});
          b.textContent=label;
        });
      };
      card.appendChild(b);
    }
    addButton('Keep Phone','phone','#bd93f9');
    addButton('Keep Watch','watch','#8be9fd');
    addButton('Keep Current Canonical','canonical','#ffb86c');

    var later=document.createElement('button');later.textContent='Decide later';
    later.style.cssText='display:block;width:100%;margin:14px 0 0;padding:10px;border:0;background:transparent;color:#bfc3d5;text-decoration:underline;';
    later.onclick=function(){conflictDismissedUntil=Date.now()+60000;closeConflictModal();emit('Plan A conflict is waiting for resolution.',{busy:false,lastResult:conflict});};
    card.appendChild(later);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    conflictModal=overlay;
    emit('Plan A merge conflict needs your choice.',{busy:false,lastResult:conflict});
  }

  function checkConflict(force){
    ensureRuntime();
    if(!cloud||!getToken())return Promise.resolve(null);
    return cloud.getActiveConflict().then(function(conflict){
      if(conflict)showConflictModal(conflict,!!force);
      else if(activeConflictId){activeConflictId=null;closeConflictModal();}
      return conflict;
    }).catch(function(e){console.warn('Plan A conflict check failed',e);return null;});
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
      getSave:function(){return getDraculaSave();},
      onEntry:function(){scheduleAutoSync();}
    });
    planA.attach();
    if(!planA.getCheckpoint())planA.checkpoint(game.save());
    mailbox=KittensGitHubMailbox.create({owner:OWNER,repo:REPO,branch:BRANCH,request:request});
    cloud=KittensPlanACloud.create({
      deviceId:'phone',
      planA:planA,
      mailbox:mailbox,
      getSave:function(){return getDraculaSave();},
      applySave:function(save){return importSaveObject(normalizeDraculaSave(save));}
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
        save=normalizeDraculaSave(save);
        var text=game.compressLZData(JSON.stringify(save));
        game.saveImportDropboxText(text,function(error){
          if(error){
            try{if(previous){LCstorage[key]=previous;game.load();forceDraculaLocal();game.render();}}catch(e){}
            reject(new Error(String(error)));
            return;
          }
          try{forceDraculaLocal();game.save();game.render();}catch(e){console.warn('Could not persist Dracula after Plan A import',e);}
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
  function adoptCanonical(){
    ensureRuntime();
    emit('Adopting existing canonical revision on this phone…',{busy:true});
    return verify().then(function(){return cloud.adoptCanonical();}).then(function(r){
      emit(r.ok?'Canonical revision adopted on this phone.':'Canonical adoption needs attention: '+r.type,{busy:false,lastResult:r});
      return r;
    }).catch(function(e){emit('Canonical adoption failed: '+e.message,{busy:false});throw e;});
  }
  function syncNow(){
    ensureRuntime();
    if(syncBusy){syncAgain=true;return Promise.resolve({ok:true,type:'queued'});}
    syncBusy=true;status.busy=true;emit('Syncing with GitHub…');
    return verify()
      .then(function(){return cloud.getActiveConflict();})
      .then(function(conflict){
        if(conflict){
          showConflictModal(conflict,true);
          return {__activeConflict:conflict};
        }
        return cloud.publishLocal();
      })
      .then(function(pub){
        if(pub&&pub.__activeConflict)return {__blockedByConflict:pub.__activeConflict};
        if(pub&&pub.type==='needs-bootstrap')throw new Error('Canonical sync has not been initialized yet.');
        if(pub&&pub.type==='needs-adoption')throw new Error('This phone has not adopted the existing canonical baseline yet. Use Adopt existing canonical first.');
        if(pub&&pub.ok===false){
          if(pub.retry)throw new Error('Phone sync head is busy or changed concurrently. Retrying shortly.');
          throw new Error('Phone publication failed: '+pub.type);
        }
        return cloud.reconcileCloud().then(function(rec){return {pub:pub,rec:rec};});
      })
      .then(function(x){
        if(x&&x.__blockedByConflict){
          return {ok:false,type:'merge-conflict',cloudConflict:x.__blockedByConflict};
        }
        if(!x.rec.ok){
          if(x.rec.type==='merge-conflict'){
            var conflict=x.rec.cloudConflict||null;
            if(conflict)showConflictModal(conflict,true);
            else checkConflict(true);
            emit('Plan A found a merge conflict. Your local save was not replaced.',{busy:false,lastResult:x.rec});
            return x.rec;
          }
          if(x.rec.retry)throw new Error('Another device updated the canonical revision at the same time. Retry sync.');
          throw new Error('Cloud reconciliation failed: '+x.rec.type);
        }
        return cloud.pullCanonical().then(function(pull){
          if(pull&&pull.ok===false){
            var waiting={ok:false,type:pull.type,publish:x.pub,reconcile:x.rec,pull:pull};
            if(pull.type==='local-unpublished-actions'){
              emit('Plan A published one batch; newer local actions are queued for the next sync.',{busy:false,lastResult:waiting});
              scheduleAutoSync(500);
              return waiting;
            }
            if(pull.retry){scheduleAutoSync(700);return waiting;}
            throw new Error('Canonical pull failed: '+pull.type);
          }
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
      return crypto.subtle.importKey('spki',b64ToBytes(keyInfo.publicKeySpkiBase64),{name:'RSA-OAEP',hash:'SHA-1'},false,['encrypt']);
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
  function startPolling(){
    if(pollTimer)return;
    pollTimer=setInterval(function(){
      try{
        if(!cloud||!getToken())return;
        var st=cloud.loadState();
        if(!st||!st.baseRevision)return;
        checkConflict(false).then(function(conflict){
          if(!conflict)syncNow().catch(function(){});
        });
      }catch(e){}
    },10000);
    setTimeout(function(){checkConflict(true);},1000);
  }
  function init(){
    if(!window.game||typeof game.save!=='function')return false;
    installIronWillGuard();
    ensureIronWillPhoneOptionsUi();
    forceDraculaLocal();ensureRuntime();startPolling();return true;
  }

  global.KittensPlanAPhone={
    init:init,getStatus:getStatus,getToken:getToken,setToken:setToken,verify:verify,bootstrap:bootstrap,adoptCanonical:adoptCanonical,
    syncNow:syncNow,scheduleAutoSync:scheduleAutoSync,provisionWatch:provisionWatch,normalizeWatchUrl:normalizeWatchUrl,
    checkConflict:checkConflict,resolveConflict:resolveConflictChoice,installIronWillGuard:installIronWillGuard,
    installIronWillPhoneOptionsUi:installIronWillPhoneOptionsUi,armIronWillPhoneOptionsUi:armIronWillPhoneOptionsUi
  };
  armIronWillPhoneOptionsUi();
  (function autoInit(){try{if(init())return;}catch(e){}setTimeout(autoInit,250);})();
})(window);
