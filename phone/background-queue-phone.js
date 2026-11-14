(function(global){
 'use strict';
 // When the Android notification service observes that a queued item should
 // be affordable, it asks this EXISTING game instance to execute its queue.
 // This module never purchases from the Android service or from a second
 // game instance. No activity is launched or brought to the foreground.
 var bridge=null, timer=0, lastSerialized='', busy=false;
 function owns(){
   var sync=global.KittensLiveSyncPhone;
   if(!sync||typeof sync.getStatus!=='function')return true;
   var state=sync.getStatus();
   return !state.configured || state.role==='owner';
 }
 function activeGame(){
   return !!(global.game&&game.time&&game.time.queue&&game.resPool&&game.time.queue.queueItems);
 }
 function buildSnapshot(){
   var result={owner:owns(),pending:false,at:Date.now(),prices:[]};
   if(!activeGame()||!result.owner)return result;
   var q=game.time.queue,first=q.queueItems[0];
   if(!first)return result;
   try{
     var model=q.getQueueElementModel(first);
     if(!model||!Array.isArray(model.prices))return result;
     result.pending=true;
     for(var i=0;i<model.prices.length;i++){
       var p=model.prices[i],r=game.resPool.get(p.name);
       if(!r)return {owner:false,pending:false,at:Date.now(),prices:[]};
       var rate=(Number(game.getResourcePerTick(p.name,true))||0)*(Number(game.ticksPerSecond)||0);
       try{
         var engineers=game.workshop.getConsumptionEngineers()||{};
         rate+=(Number(engineers[p.name])||0)*(Number(game.ticksPerSecond)||0);
         rate+=(Number(game.workshop.getEffectEngineer(p.name,true))||0)*(Number(game.ticksPerSecond)||0);
       }catch(e){}
       result.prices.push({name:p.name,price:Number(p.val)||0,value:Number(r.value)||0,max:Number(r.maxValue)||0,rate:rate});
     }
   }catch(e){console.warn('Background queue snapshot skipped:',e);return {owner:false,pending:false,at:Date.now(),prices:[]};}
   return result;
 }
 function publish(force){
   if(!bridge)bridge=global.kittensTrackerBridge;
   if(!bridge||typeof bridge.setQueueSnapshot!=='function'||!activeGame())return false;
   var next=buildSnapshot(),signature=JSON.stringify(next);
   // No forced JSON churn for identical queued items while the game is hidden.
   if(force||!document.hidden||signature!==lastSerialized){
     lastSerialized=signature;
     try{
       var reply=JSON.parse(bridge.setQueueSnapshot(signature));
       return !!reply.ok;
     }catch(e){console.warn('Background queue native snapshot failed:',e);}
   }
   return false;
 }
 async function serverConfirmsPhoneOwnership(){
   var sync=global.KittensLiveSyncPhone;
   if(!sync||typeof sync.getStatus!=='function')return true;
   var status=sync.getStatus(),cfg=status.config;
   if(!status.configured)return true;
   if(status.role!=='owner'||!cfg||!cfg.endpoint||!cfg.sessionId||!cfg.deviceToken)return false;
   // The native snapshot may be stale if a watch handoff occurred while the
   // phone WebView was suspended. Verify canonical ownership before spending.
   var controller=typeof AbortController==='function'?new AbortController():null;
   var abort=controller?setTimeout(function(){controller.abort();},4000):null;
   try{
     var endpoint=cfg.endpoint.replace(/\\/+$/,'')+'/api/session/'+encodeURIComponent(cfg.sessionId)+'/state';
     var reply=await fetch(endpoint,{
       method:'GET',
       headers:{'x-device-id':'phone','x-device-token':cfg.deviceToken},
       cache:'no-store',
       signal:controller?controller.signal:undefined
     });
     if(!reply.ok)return false;
     var data=await reply.json();
     return !!(data&&data.ok&&data.state&&data.state.ownerDeviceId==='phone');
   }catch(e){console.warn('Background queue ownership verification unavailable:',e);return false;}
   finally{if(abort)clearTimeout(abort);}
 }
 async function runIfDue(source){
   if(busy||!activeGame()||!owns()||!document.hidden)return false;
   if(!game.time.queue.queueItems.length)return false;
   busy=true;
   try{
     if(!await serverConfirmsPhoneOwnership())return false;
     if(!document.hidden||!owns())return false;
     // Use the canonical game engine for accurate cost/automation handling.
     game.time.calculateRedshift();
     game.time.queue.update();
     game.save();
     publish(true);
     if(global.KittensLiveSyncPhone&&typeof KittensLiveSyncPhone.commitNow==='function') {
       KittensLiveSyncPhone.commitNow().catch(function(e){console.warn('Background queue sync commit failed',e);});
     }
     return true;
   }catch(e){
     console.error('Background queue execution failed:',e);
     return false;
   }finally{busy=false;publish(true);}
 }
 function init(){
   if(timer)return;
   if(!global.kittensTrackerBridge||typeof global.kittensTrackerBridge.setQueueSnapshot!=='function'||!activeGame())return;
   bridge=global.kittensTrackerBridge;
   timer=setInterval(function(){if(!document.hidden)publish(false);},1000);
   document.addEventListener('visibilitychange',function(){publish(true);});
   global.addEventListener('pagehide',function(){publish(true);});
   global.addEventListener('kittens-live-sync-phone-status',function(){publish(true);});
   publish(true);
 }
 global.KittensBackgroundQueue={runIfDue:runIfDue,publish:publish,buildSnapshot:buildSnapshot};
 (function ready(){try{if(!timer)init();}catch(e){console.warn('Background queue setup:',e);}if(!timer)setTimeout(ready,300);})();
})(window);
