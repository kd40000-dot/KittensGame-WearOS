(function(global){
  'use strict';

  var PREFIX='com.nuclearunicorn.kittengame.liveSync.';

  function normEndpoint(value){
    return String(value||'').trim().replace(/\/+$/,'');
  }

  function wsEndpoint(httpBase,sessionId){
    var base=normEndpoint(httpBase).replace(/^http:/i,'ws:').replace(/^https:/i,'wss:');
    return base+'/ws/'+encodeURIComponent(sessionId);
  }

  function safeJson(text){
    try{return JSON.parse(text);}catch(e){return null;}
  }

  function create(opts){
    opts=opts||{};
    var deviceId=opts.deviceId||'device';
    var configKey=PREFIX+deviceId+'.config';
    var revisionKey=PREFIX+deviceId+'.lastRevision';
    var ws=null,connected=false,authed=false,role='offline',serverState=null;
    var reconnectTimer=0,heartbeatTimer=0,liveTimer=0,commitTimer=0;
    var reconnectDelay=700,manualDisconnect=false,pendingClaim=false;

    function emit(message,extra){
      var detail={
        message:message||'',
        connected:connected,
        authed:authed,
        role:role,
        serverState:serverState,
        config:getConfig()
      };
      if(extra)for(var k in extra)detail[k]=extra[k];
      if(opts.onStatus)try{opts.onStatus(detail);}catch(e){}
      try{global.dispatchEvent(new CustomEvent('kittens-live-sync-status',{detail:detail}));}catch(e){}
      return detail;
    }

    function getConfig(){
      try{return JSON.parse(localStorage.getItem(configKey)||'{}');}catch(e){return {};}
    }

    function setConfig(cfg){
      cfg=cfg||{};
      var out={
        endpoint:normEndpoint(cfg.endpoint),
        sessionId:String(cfg.sessionId||'').trim(),
        deviceToken:String(cfg.deviceToken||'').trim()
      };
      localStorage.setItem(configKey,JSON.stringify(out));
      emit('Live Sync configuration saved.');
      return out;
    }

    function clearConfig(){
      disconnect();
      localStorage.removeItem(configKey);
      localStorage.removeItem(revisionKey);
      emit('Live Sync configuration cleared.');
    }

    function getLastRevision(){
      return Number(localStorage.getItem(revisionKey)||0)||0;
    }

    function setLastRevision(rev){
      rev=Number(rev)||0;
      localStorage.setItem(revisionKey,String(rev));
      return rev;
    }

    function send(obj){
      if(!ws||ws.readyState!==WebSocket.OPEN)return false;
      try{ws.send(JSON.stringify(obj));return true;}catch(e){return false;}
    }

    function setRole(next,message){
      role=next;
      if(opts.setWritable)try{opts.setWritable(next==='owner');}catch(e){}
      if(opts.onRole)try{opts.onRole(next,serverState);}catch(e){}
      emit(message||('Live Sync: '+next));
    }

    async function applyCanonical(saveText,revision){
      if(!saveText)return;
      if(Number(revision||0)===getLastRevision())return;
      if(opts.applySaveText)await opts.applySaveText(saveText);
      setLastRevision(revision);
    }

    function stopOwnerLoops(){
      clearInterval(heartbeatTimer);heartbeatTimer=0;
      clearInterval(liveTimer);liveTimer=0;
    }

    function startOwnerLoops(){
      stopOwnerLoops();
      heartbeatTimer=setInterval(function(){
        if(role==='owner')send({type:'heartbeat'});
      },5000);
      liveTimer=setInterval(function(){
        if(role!=='owner'||document.hidden)return;
        try{
          var resources=opts.getResources?opts.getResources():[];
          send({type:'live',resources:resources});
        }catch(e){}
      },500);
    }

    function claim(){
      if(!connected||!authed){pendingClaim=true;connect();return false;}
      pendingClaim=false;
      setRole('claiming','Live Sync: taking control…');
      return send({type:'claim'});
    }

    function forceClaim(){
      if(!connected||!authed)return false;
      setRole('claiming','Live Sync: forcing control…');
      return send({type:'force-claim'});
    }

    async function commitNow(){
      clearTimeout(commitTimer);commitTimer=0;
      if(role!=='owner')return {ok:false,type:'not-owner'};
      try{
        var text=opts.getSaveText?await opts.getSaveText():null;
        if(!text)return {ok:false,type:'no-save'};
        send({type:'commit',saveText:text});
        return {ok:true,type:'sent'};
      }catch(e){
        emit('Live Sync commit failed: '+e.message,{error:e});
        return {ok:false,type:'error',error:e};
      }
    }

    function scheduleCommit(delay){
      if(role!=='owner')return;
      clearTimeout(commitTimer);
      commitTimer=setTimeout(function(){commitNow();},delay==null?250:delay);
    }

    async function release(){
      if(role!=='owner')return;
      var saveText=null;
      try{saveText=opts.getSaveText?await opts.getSaveText():null;}catch(e){}
      send({type:'release',saveText:saveText});
      stopOwnerLoops();
      setRole('mirror','Live Sync: released control.');
    }

    function scheduleReconnect(){
      if(manualDisconnect)return;
      clearTimeout(reconnectTimer);
      reconnectTimer=setTimeout(connect,reconnectDelay);
      reconnectDelay=Math.min(10000,Math.round(reconnectDelay*1.6));
    }

    async function handle(data){
      if(!data||!data.type)return;

      if(data.type==='auth-failed'){
        emit('Live Sync authentication failed.');
        return;
      }

      if(data.type==='welcome'){
        authed=true;
        serverState=data.state||{};
        reconnectDelay=700;
        if(serverState.ownerDeviceId===deviceId){
          setRole('owner','Live Sync connected · this device owns the session.');
          startOwnerLoops();
        }else{
          setRole('mirror','Live Sync connected · '+(serverState.ownerDeviceId||'no device')+' owns the session.');
        }
        if(!document.hidden||pendingClaim)setTimeout(claim,50);
        return;
      }

      if(data.type==='control-granted'){
        serverState={
          revision:Number(data.revision||0),
          ownerDeviceId:data.ownerDeviceId||deviceId,
          leaseUntil:Number(data.leaseUntil||0)
        };
        try{
          await applyCanonical(data.saveText,data.revision);
        }catch(e){
          setRole('error','Live Sync could not apply canonical save: '+e.message);
          return;
        }
        setRole('owner','Live Sync: control granted.');
        startOwnerLoops();
        return;
      }

      if(data.type==='control-revoked'){
        serverState=serverState||{};
        serverState.ownerDeviceId=data.ownerDeviceId||null;
        serverState.revision=Number(data.revision||serverState.revision||0);
        if(data.revision)setLastRevision(data.revision);
        stopOwnerLoops();
        setRole('mirror','Live Sync: control moved to '+(data.ownerDeviceId||'the other device')+'.');
        return;
      }

      if(data.type==='owner-changed'){
        serverState=serverState||{};
        serverState.ownerDeviceId=data.ownerDeviceId||null;
        serverState.revision=Number(data.revision||serverState.revision||0);
        serverState.leaseUntil=Number(data.leaseUntil||0);
        if(serverState.ownerDeviceId!==deviceId&&role==='owner'){
          stopOwnerLoops();
          setRole('mirror','Live Sync: control moved to '+(serverState.ownerDeviceId||'the other device')+'.');
        }
        return;
      }

      if(data.type==='handoff-request'){
        if(role!=='owner')return;
        var saveText=null;
        try{saveText=opts.getSaveText?await opts.getSaveText():null;}catch(e){}
        if(saveText)send({type:'handoff-state',saveText:saveText});
        emit('Live Sync: handing control to '+(data.requestedBy||'the other device')+'…');
        return;
      }

      if(data.type==='handoff-wait'){
        setRole('claiming','Live Sync: waiting for '+(data.ownerDeviceId||'the other device')+' to hand off…');
        return;
      }

      if(data.type==='owner-offline'){
        setRole('mirror','Live Sync: '+(data.ownerDeviceId||'the other device')+' is offline; waiting for its safety lease.');
        var wait=Math.max(250,Number(data.leaseUntil||0)-Date.now()+100);
        clearTimeout(reconnectTimer);
        reconnectTimer=setTimeout(claim,Math.min(wait,16000));
        return;
      }

      if(data.type==='release-ack'){
        setLastRevision(data.revision);
        serverState=serverState||{};
        serverState.revision=Number(data.revision||0);
        serverState.ownerDeviceId=null;
        serverState.leaseUntil=0;
        emit('Live Sync: final state released at revision '+data.revision+'.');
        return;
      }

      if(data.type==='commit-ack'){
        setLastRevision(data.revision);
        serverState=serverState||{};
        serverState.revision=Number(data.revision||0);
        serverState.leaseUntil=Number(data.leaseUntil||0);
        emit('Live Sync: saved revision '+data.revision+'.');
        return;
      }

      if(data.type==='remote-commit'){
        serverState=serverState||{};
        serverState.revision=Number(data.revision||serverState.revision||0);
        serverState.ownerDeviceId=data.ownerDeviceId||serverState.ownerDeviceId;
        emit('Live Sync: remote revision '+data.revision+' available.');
        return;
      }

      if(data.type==='live'){
        serverState=serverState||{};
        serverState.revision=Number(data.revision||serverState.revision||0);
        serverState.ownerDeviceId=data.ownerDeviceId||serverState.ownerDeviceId;
        if(role!=='owner'&&opts.applyLiveResources){
          try{opts.applyLiveResources(data.resources||[],Number(data.serverTime||Date.now()));}catch(e){}
        }
        return;
      }

      if(data.type==='not-owner'){
        stopOwnerLoops();
        setRole('mirror','Live Sync: '+(data.ownerDeviceId||'the other device')+' owns the session.');
        return;
      }

      if(data.type==='heartbeat-ack'){
        serverState=serverState||{};
        serverState.leaseUntil=Number(data.leaseUntil||0);
        serverState.revision=Number(data.revision||serverState.revision||0);
        return;
      }

      if(data.type==='error')emit('Live Sync server error: '+(data.error||'unknown'));
    }

    function connect(){
      var cfg=getConfig();
      if(!cfg.endpoint||!cfg.sessionId||!cfg.deviceToken){
        emit('Live Sync is not configured.');
        return false;
      }
      if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return true;
      manualDisconnect=false;
      setRole('connecting','Live Sync: connecting…');
      try{ws=new WebSocket(wsEndpoint(cfg.endpoint,cfg.sessionId));}
      catch(e){emit('Live Sync connection failed: '+e.message);scheduleReconnect();return false;}

      ws.onopen=function(){
        connected=true;authed=false;
        send({type:'auth',deviceId:deviceId,deviceToken:cfg.deviceToken,lastRevision:getLastRevision()});
      };
      ws.onmessage=function(ev){
        var data=safeJson(ev.data);
        if(data)Promise.resolve(handle(data)).catch(function(e){emit('Live Sync message failed: '+e.message);});
      };
      ws.onerror=function(){emit('Live Sync socket error.');};
      ws.onclose=function(){
        connected=false;authed=false;stopOwnerLoops();
        if(role!=='offline')setRole('offline','Live Sync disconnected; reconnecting…');
        scheduleReconnect();
      };
      return true;
    }

    function disconnect(){
      manualDisconnect=true;
      clearTimeout(reconnectTimer);clearTimeout(commitTimer);
      stopOwnerLoops();
      try{if(ws)ws.close();}catch(e){}
      ws=null;connected=false;authed=false;
      setRole('offline','Live Sync disconnected.');
    }

    document.addEventListener('visibilitychange',function(){
      if(document.hidden){
        if(role==='owner')release();
      }else{
        connect();
        setTimeout(claim,100);
      }
    });
    global.addEventListener('pagehide',function(){if(role==='owner')release();});

    return {
      connect:connect,disconnect:disconnect,claim:claim,forceClaim:forceClaim,release:release,
      commitNow:commitNow,scheduleCommit:scheduleCommit,getConfig:getConfig,setConfig:setConfig,
      clearConfig:clearConfig,getLastRevision:getLastRevision,getRole:function(){return role;},
      getServerState:function(){return serverState;},setLastRevision:setLastRevision
    };
  }

  async function bootstrap(opts){
    var endpoint=normEndpoint(opts.endpoint),sessionId=String(opts.sessionId||'').trim();
    if(!endpoint||!sessionId||!opts.adminSecret||!opts.saveText)throw new Error('Endpoint, session ID, admin secret and save are required.');
    var r=await fetch(endpoint+'/api/session/'+encodeURIComponent(sessionId)+'/bootstrap',{
      method:'POST',
      headers:{'content-type':'application/json','authorization':'Bearer '+opts.adminSecret},
      body:JSON.stringify({deviceId:opts.deviceId||'phone',saveText:opts.saveText})
    });
    var x=await r.json();
    if(!r.ok||!x.ok)throw new Error(x.error||('HTTP '+r.status));
    return x;
  }

  async function createPairCode(opts){
    var endpoint=normEndpoint(opts.endpoint),sessionId=String(opts.sessionId||'').trim();
    var r=await fetch(endpoint+'/api/session/'+encodeURIComponent(sessionId)+'/pair',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({deviceId:opts.deviceId||'phone',deviceToken:opts.deviceToken})
    });
    var x=await r.json();
    if(!r.ok||!x.ok)throw new Error(x.error||('HTTP '+r.status));
    return x;
  }

  async function claimPair(opts){
    var endpoint=normEndpoint(opts.endpoint),code=String(opts.code||'').trim();
    if(!endpoint||!code)throw new Error('Endpoint and pairing code are required.');
    var r=await fetch(endpoint+'/api/pair/'+encodeURIComponent(code)+'/claim',{method:'POST'});
    var x=await r.json();
    if(!r.ok||!x.ok)throw new Error(x.error||('HTTP '+r.status));
    return x;
  }

  global.KittensLiveSync={create:create,bootstrap:bootstrap,createPairCode:createPairCode,claimPair:claimPair};
})(window);
