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
 function runIfDue(source){
   if(busy||!activeGame()||!owns())return false;
   if(!document.hidden)return false; // foreground already advances its queue
   if(!game.time.queue.queueItems.length)return false;
   busy=true;
   try{
     // Existing game redshift is queue-aware, and updates the exact authoritative
     // game state; if it cannot handle a purchase, the regular queue update
     // receives an additional opportunity on the next eligible day.
     game.time.calculateRedshift();
     game.time.queue.update();
     game.save();
     if(global.KittensLiveSyncPhone&&typeof KittensLiveSyncPhone.commitNow==='function') {
       KittensLiveSyncPhone.commitNow().catch(function(e){console.warn('Background queue sync commit failed',e);});
     }
     publish(true);
     return true;
   }catch(e){
     console.error('Background queue execution failed:',e);
     publish(true);
     return false;
   }finally{busy=false;}
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
