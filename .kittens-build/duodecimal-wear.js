/* Kittens Wear 1.1.5, Draft A duodecimal display.
 * The exact custom font from phone v1006120 is installed next to wear.js.
 * This is display-only: saves, game arithmetic, sync values, native complications
 * and numeric input retain their original machine-readable decimal numbers.
 */
(function(global){
 'use strict';
 var MARKERS=['','K','M','G','T','P','E','Z','Y'];
 var PUA=0xE000;
 var DIGITS='0123456789↊↋';
 function glyph(n){return String.fromCharCode(PUA+n);}
 function integer(n){
   n=Math.floor(n);
   if(n===0)return glyph(0);
   var result='';
   while(n>0){result=glyph(n%12)+result;n=Math.floor(n/12);}
   return result;
 }
 function format(value,precision,plus){
   value=Number(value);
   if(!isFinite(value))return value===Infinity?'∞':value===-Infinity?'−∞':'NaN';
   var sign=value<0?'−':plus&&value>0?'+':'';
   value=Math.abs(value);
   var digits=precision===undefined?2:Math.max(0,Math.min(8,Math.floor(Number(precision)||0)));
   if(value>=Number.MAX_SAFE_INTEGER){
     var exponent=Math.floor(Math.log(value)/Math.log(12));
     return sign+format(value/Math.pow(12,exponent),digits,false)+'e'+integer(exponent);
   }
   var factor=Math.pow(12,digits),scaled=Math.round(value*factor);
   if(!Number.isSafeInteger(scaled))return sign+format(value/12,2,false)+'e'+glyph(1);
   var whole=Math.floor(scaled/factor),fraction=scaled%factor,rendered=integer(whole);
   if(digits&&fraction){
     var f=integer(fraction);
     while(f.length<digits)f=glyph(0)+f;
     while(f.endsWith(glyph(0)))f=f.slice(0,-1);
     if(f)rendered+='.'+f;
   }
   return sign+rendered;
 }
 function extended(value,prefix,usePerTickHack,precision,postfix){
   if(typeof value!=='number')return value==null?'':String(value);
   var perTick=!!(usePerTickHack&&this.opts&&this.opts.usePerSecondValues);
   if(perTick)value*=Number(this.ticksPerSecond)||1;
   var magnitude=Math.abs(value),tier=0;
   while(magnitude>=1728&&tier<MARKERS.length-1){
     magnitude/=1728;value/=1728;tier++;
   }
   return format(value,precision===undefined?(this.opts&&this.opts.forceHighPrecision?3:2):precision,prefix)
     +(postfix||'')+MARKERS[tier]+(perTick?'/'+(global.$I?global.$I('unit.sec'):'sec'):'');
 }
 function convertToken(token){
   var value=Number(token.replace(/,/g,''));
   if(!isFinite(value))return token;
   var dot=token.indexOf('.');
   var precision=dot<0?0:Math.min(6,token.length-dot-1);
   return precision?format(value,precision,false):integer(value);
 }
 function convertText(text){
   // Whole decimal numbers only; never digits embedded in words or identifiers.
   return String(text).replace(/(^|[^\p{L}\p{N}_\uE000-\uE00B])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.([0-9]+))?(?![\p{L}\p{N}_])/gu,
     function(m,before,whole,fraction){
       return before+convertToken(whole+(fraction===undefined?'':'.'+fraction));
     });
 }
 var pending=[],scheduled=false;
 function renderTextNode(node){
   if(!node||node.nodeType!==3||!node.nodeValue||!/[0-9]/.test(node.nodeValue))return;
   var parent=node.parentElement;
   if(!parent||parent.closest('script,style,noscript,textarea,input,option,select,code,pre,[contenteditable=""],[contenteditable="true"],[data-dozenal-skip]'))return;
   var next=convertText(node.nodeValue);
   if(next!==node.nodeValue)node.nodeValue=next;
 }
 function enqueue(node){
   if(!node)return;
   pending.push(node);
   if(scheduled)return;
   scheduled=true;
   (global.requestAnimationFrame||function(f){setTimeout(f,15);})(function(){
     scheduled=false;var batch=pending;pending=[];
     for(var k=0;k<batch.length;k++){
       var item=batch[k];
       if(item.nodeType===3){renderTextNode(item);continue;}
       if(item.nodeType!==1&&item.nodeType!==9&&item.nodeType!==11)continue;
       if(item.nodeType===1&&item.matches('script,style,noscript,textarea,input,option,select,code,pre'))continue;
       var walk=document.createTreeWalker(item,NodeFilter.SHOW_TEXT),textNode;
       while((textNode=walk.nextNode()))renderTextNode(textNode);
     }
   });
 }
 function installObserver(){
   if(!document.body||document.body.__kittensDozenalWatch)return;
   document.body.__kittensDozenalWatch=true;
   enqueue(document.body);
   var observer=new MutationObserver(function(changes){
     for(var i=0;i<changes.length;i++){
       var change=changes[i];
       if(change.type==='characterData')enqueue(change.target);
       else for(var j=0;j<change.addedNodes.length;j++)enqueue(change.addedNodes[j]);
     }
   });
   observer.observe(document.body,{subtree:true,childList:true,characterData:true});
 }
 function installStyle(){
   if(document.getElementById('kittens-watch-dozenal-style'))return;
   var el=document.createElement('style');el.id='kittens-watch-dozenal-style';
   el.textContent="@font-face{font-family:'KittensDraftA';src:url('/duo-draft-a.ttf') format('truetype');unicode-range:U+E000-E00B;} body,body *:not(i):not([class*='icon']):not([class*='fa-']),input,button,textarea{font-family:'KittensDraftA',system-ui,'Roboto',sans-serif!important;}";
   document.head.appendChild(el);
 }
 function install(){
   installStyle();
   installObserver();
   var g=global.game;
   if(!g||typeof g.getDisplayValue!=='function'||typeof g.getDisplayValueExt!=='function')return false;
   if(g.__draftADuodecimalInstalled)return true;
   g.getDisplayValue=function(value,prefix,precision){
     if(typeof value!=='number')return value==null?'':String(value);
     return format(value,precision===undefined?(this.opts&&this.opts.forceHighPrecision?3:2):precision,prefix);
   };
   g.getDisplayValueExt=extended;
   g.__draftADuodecimalInstalled=true;
   return true;
 }
 global.KittensWearDuodecimal={format:format,convertText:convertText,install:install};
 (function retry(){
   try{if(install())return;}catch(e){console.error('Kittens watch duodecimal:',e);}
   setTimeout(retry,250);
 })();
})(window);
