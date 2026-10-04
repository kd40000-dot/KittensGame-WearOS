(function(){
 'use strict';
 const KEY='com.nuclearunicorn.kittengame.savedata';
 let ready=false, suspended=false, lastTabList='', page='play', lastComplicationSync=0;
 const $id=id=>document.getElementById(id);
 function node(tag,attrs,text){let n=document.createElement(tag);Object.assign(n,attrs||{});if(text!==undefined)n.textContent=text;return n;}
 function button(text,fn,parent){let b=node('button',{type:'button',className:'wear-button'},text);b.onclick=fn;parent.appendChild(b);return b;}
 function status(text){$id('wearStatus').textContent=text;}
 function detail(html){$id('wearDetailBody').innerHTML=html;$id('wearDetail').hidden=false;$id('wearDetail').scrollTop=0;}
 function go(next){page=next;document.body.dataset.page=next;['wearResources','wearSettings'].forEach(id=>$id(id).hidden=true);$id('wearQuick').hidden=next!=='play';$id('wearTabs').hidden=next!=='play';if(next==='resources')$id('wearResources').hidden=false;if(next==='settings')$id('wearSettings').hidden=false;document.querySelectorAll('.wear-nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===next));window.scrollTo(0,0);update();}
 const header=node('header',{id:'wearHeader'});header.append(node('strong',{},'Kittens'),node('span',{id:'wearSeason'},'Your village, on your wrist'));
 const nav=node('nav',{className:'wear-nav','ariaLabel':'Game sections'});
 [['play','Play'],['resources','Resources'],['log','Log'],['settings','Settings']].forEach(([p,label])=>{let b=button(label,()=>go(p),nav);b.dataset.page=p;});document.body.prepend(header);
 const quick=node('div',{id:'wearQuick'});quick.innerHTML='<label>CATNIP</label><b id="wearNip">0</b><span id="wearNipRate"></span>';header.after(quick);
 const tabs=node('select',{id:'wearTabs','ariaLabel':'Game category'});quick.after(tabs);tabs.onchange=()=>{game.ui.activeTabId=tabs.value;game.render();};
 const resources=node('section',{id:'wearResources',hidden:true});tabs.after(resources);
 const settings=node('section',{id:'wearSettings',hidden:true});resources.after(settings);
 settings.append(node('div',{className:'wear-label'},'Your game'));
 function wearEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 async function waitNative(url){for(;;){await new Promise(r=>setTimeout(r,500));const q=await fetch(url,{cache:'no-store'});let x;try{x=await q.json();}catch(e){throw new Error('Native operation returned invalid JSON: '+e.message);}if(x.state!=='waiting')return x;}}
 function opError(title,x){detail('<h2>'+wearEsc(title)+'</h2><p><b>Operation:</b> '+wearEsc(x.operation||'unknown')+'</p><p><b>Error type:</b> '+wearEsc(x.type||'unknown')+'</p><p><b>Message:</b> '+wearEsc(x.message||'No message')+'</p>'+(x.cause?'<p><b>Cause:</b> '+wearEsc(x.cause)+'</p>':'')+(x.detail?'<p><b>Details:</b> '+wearEsc(x.detail)+'</p>':''));}
 function showExportBox(text){
  const box=node('div');box.append(node('h2',{},'Export save'));
  box.append(node('p',{id:'wearExportStatus'},'Preparing Android clipboard…'));
  const area=node('textarea',{id:'wearExportText',readOnly:true,rows:10,value:text});
  area.style.width='100%';area.style.minHeight='180px';area.style.fontSize='11px';area.style.boxSizing='border-box';
  area.onclick=()=>{area.focus();area.select();};
  box.append(area);
  button('Copy again',async()=>{try{const r=await fetch('/clipboard-copy',{method:'POST',body:JSON.stringify({text:area.value})});const x=await r.json();if(x.state==='success'){status('Save copied to clipboard');$id('wearExportStatus').textContent='Copied to Android clipboard · '+x.characters+' characters';}else opError('Clipboard copy failed',x);}catch(e){opError('Clipboard copy failed',{operation:'clipboard-copy',type:e.name,message:e.message,detail:'Long-press the export box and copy manually.'});}},box);
  box.append(node('p',{},'Fallback: tap the text box to select it, then use Copy. This is the same compressed save string used by the web version.'));
  $id('wearDetailBody').replaceChildren(box);$id('wearDetail').hidden=false;$id('wearDetail').scrollTop=0;
 }
 function showImportBox(){
  const box=node('div');box.append(node('h2',{},'Import save'),node('p',{},'Paste a Kittens Game export string or save JSON below.'));
  const area=node('textarea',{id:'wearImportText',rows:10,placeholder:'Paste save here…'});
  area.style.width='100%';area.style.minHeight='180px';area.style.fontSize='11px';area.style.boxSizing='border-box';box.append(area);
  button('Paste clipboard',async()=>{try{const r=await fetch('/clipboard-read',{cache:'no-store'});const x=await r.json();if(x.state==='success'){area.value=x.text;status('Pasted '+x.characters+' characters');area.focus();}else opError('Clipboard paste failed',x);}catch(e){opError('Clipboard paste failed',{operation:'clipboard-read',type:e.name,message:e.message,detail:'Long-press the import box and paste manually.'});}},box);
  button('Import pasted save',async()=>{const text=area.value.trim();if(!text){opError('Import failed',{operation:'import',type:'EmptyInput',message:'The import box is empty.',detail:'Paste a Kittens Game export string or save JSON first.'});return;}try{if(!confirm('Replace your current village with this pasted save?'))return;await save(true);await importSave(text);detail('<h2>Import complete</h2><p>The pasted save was validated and loaded successfully.</p><p><b>Characters:</b> '+wearEsc(text.length)+'</p>');}catch(e){opError('Import failed',{operation:'import',type:e.name||'ImportError',message:e.message||String(e),detail:'The pasted text was not accepted as a valid Kittens Game save. Your previous village was retained when validation failed.'});}},box);
  button('Clear',()=>{area.value='';area.focus();},box);
  $id('wearDetailBody').replaceChildren(box);$id('wearDetail').hidden=false;$id('wearDetail').scrollTop=0;setTimeout(()=>area.focus(),100);
 }
 button('Save now',async()=>{await save(true);},settings);
 button('Export save',async()=>{try{const text=game.compressLZData(JSON.stringify(game.save()));showExportBox(text);const response=await fetch('/export',{method:'POST',body:JSON.stringify({exportText:text})});let x;try{x=await response.json();}catch(e){x={state:'error',operation:'clipboard-copy',type:e.name,message:e.message,detail:'The export string is still visible below for manual copying.'};}const msg=$id('wearExportStatus');if(x.state==='success'){msg.textContent='Copied to Android clipboard · '+x.characters+' characters';status('Save copied to clipboard');}else{msg.textContent='Automatic clipboard copy failed. Long-press the box and copy manually.';msg.dataset.error=JSON.stringify(x);}}catch(e){opError('Export failed',{operation:'export',type:e.name,message:e.message,detail:'The game could not generate an export string.'});}},settings);
 button('Import save',()=>showImportBox(),settings);
 button('Building filters',()=>{const list=node('div');list.append(node('h2',{},'Building filters'));game.bld.getBuildingGroups(true).forEach(group=>button(group.title,()=>{game.bldTab.activeGroup=group.name;game.render();$id('wearDetail').hidden=true;go('play');},list));$id('wearDetailBody').replaceChildren(list);$id('wearDetail').hidden=false;},settings);
 button('Game options',()=>{$('#optionsDiv').show();game.ui.updateOptions();},settings);
 button('Pause / resume',()=>{game.togglePause();status(game.isPaused?'Game paused':'Game running');syncComplication(true);},settings);
 button('Complication resource',async()=>{try{const r=await fetch('/open-complication-settings',{method:'POST'});if(!r.ok)throw Error();}catch(e){status('Could not open complication settings');}},settings);
 button('Reset / prestige',()=>game.reset(),settings);
 settings.append(node('p',{},'Swipe up to scroll. Tap Details for costs and effects. The bottom Menu button switches screens. Your game saves every 10 seconds and when you leave. Offline progress follows the original game rules.'));
 button('About & credits',()=>detail('<h2>Kittens Wear 1.1.5</h2><p>Personal offline adaptation for Wear OS. Original game by bloodrizer and contributors.</p><p>Based on Kittens Game '+version+'. Bundles Mozilla GeckoView (MPL 2.0).</p><p>Original game: kittensgame.com/web/</p><p>Source: github.com/nuclear-unicorn/kittensgame</p><p>Game code retains its WET PAWS LICENSE; this build is for personal use.</p><p>Engine sources: archive.mozilla.org/pub/firefox/releases/140.0.4/source/</p><p>All original acknowledgements:</p>'+$id('creditsDiv').innerHTML),settings);
 const state=node('p',{id:'wearStatus'},'Starting your forest…');document.body.append(state);
 const menu=node('section',{id:'wearMenu',hidden:true});menu.append(node('h2',{},'Your village'),nav);button('Back to game',()=>menu.hidden=true,menu);document.body.append(menu);nav.addEventListener('click',()=>menu.hidden=true);const top=button('Menu',()=>{menu.hidden=false;menu.scrollTop=0;},document.body);top.id='wearHome';
 const sheet=node('section',{id:'wearDetail',hidden:true});sheet.append(node('div',{id:'wearDetailBody'}));button('Close',()=>sheet.hidden=true,sheet);document.body.append(sheet);
 function fmt(x){return game.getDisplayValueExt(x);}
 function update(){if(!ready)return;
  const cat=game.resPool.get('catnip');$id('wearNip').textContent=fmt(cat.value);$id('wearNipRate').textContent=' / '+fmt(cat.maxValue);
  $id('wearSeason').textContent='Year '+game.calendar.year+' · '+game.calendar.getCurSeason().title+(game.isPaused?' · Paused':'');
  let visible=game.tabs.filter(t=>t.visible);let list=visible.map(t=>t.tabId+':'+t.tabName).join('|');
  if(list!==lastTabList){tabs.replaceChildren(...visible.map(t=>node('option',{value:t.tabId},t.tabName.replace(/<[^>]+>/g,''))));lastTabList=list;}
  tabs.value=game.ui.activeTabId;tabs.style.display=visible.length>1 && page==='play'?'block':'none';
  if(page==='resources'){
   resources.replaceChildren();
   game.resPool.resources.filter(r=>(r.visible || r.craftable) && (r.unlocked || r.value>0 || r.name==='catnip' || (r.name==='kittens' && r.maxValue>0))).forEach(r=>{
    let card=node('div',{className:'resource-card'}),line=node('div',{className:'resource-line'});line.append(node('span',{},r.title||r.name),node('b',{},fmt(r.value)));card.append(line);
    let rate=game.getResourcePerTick(r.name,true)*game.ticksPerSecond;card.append(node('small',{},(r.maxValue?'Capacity '+fmt(r.maxValue)+' · ':'')+(rate>=0?'+':'')+fmt(rate)+'/s'));
    if(r.maxValue>0){let meter=node('div',{className:'resource-meter'}),fill=node('i');fill.style.width=Math.min(100,r.value/r.maxValue*100)+'%';meter.append(fill);card.append(meter);}resources.append(card);
   });
  }
 }
 async function save(manual){if(!ready || game.currentSaveIsBroken){if(manual)opError('Save failed',{operation:'save',type:'GameStateError',message:'The game is not ready to save or reports the current save as broken.',detail:'No new save file was created.'});return;}try{let data=game.save();const endpoint=manual?'/save-manual':'/backup';const r=await fetch(endpoint,{method:'POST',body:JSON.stringify(data),keepalive:true});let x;try{x=await r.json();}catch(e){throw new Error('Save service returned invalid JSON: '+e.message);}if(!r.ok||x.state==='error'){if(manual)opError('Save failed',x);return;}if(manual){let msg='<h2>Save complete</h2><p><b>'+wearEsc(x.fileName||'KittensGame save')+'</b></p><p>Location: <b>'+wearEsc(x.location||'internal storage')+'</b></p><p>Internal recovery copy: <b>'+(x.internal?'OK':'FAILED')+'</b><br>Visible timestamped copy: <b>'+(x.visible?'OK':'FAILED')+'</b></p>';if(x.detail)msg+='<p><b>Warnings:</b> '+wearEsc(x.detail)+'</p>';detail(msg);}}catch(e){if(manual)opError('Save failed',{operation:'save',type:e.name,message:e.message,detail:'The request to the native save service failed.'});}}
 async function importSave(text){
  text=text.trim();const parsed=JSON.parse(text.startsWith('{')?text:game.decompressLZData(text));text=game.compressLZData(JSON.stringify(parsed));if(!parsed || !Array.isArray(parsed.resources) || !parsed.game)throw Error('Not a Kittens Game save');const previous=LCstorage[KEY];
  return new Promise((resolve,reject)=>game.saveImportText(text,error=>{if(error){LCstorage[KEY]=previous;game.load();game.render();reject(error);}else{game.opts.enableRedshift=true;game.opts.useWorkers=false;save(true);go('play');resolve();}}));
 }
 function installDetails(){
  com.nuclearunicorn.game.ui.ContentRowRenderer.prototype.initRenderer=function(content){this.content=content;this.twoRows=false;};
  const attach=UIUtils.attachTooltip;
  UIUtils.attachTooltip=function(g,container,top,left,provider){container._wearTip=()=>provider.call(g);return provider;};
  const original=com.nuclearunicorn.game.ui.Button.prototype.render;
  com.nuclearunicorn.game.ui.Button.prototype.render=function(parent){original.call(this,parent);const self=this;
   const info=node('button',{type:'button',className:'wear-info'},'Details');
   info.onclick=function(e){e.preventDefault();e.stopPropagation();let html;
    if(self.domNode._wearTip)html=self.domNode._wearTip();
    else{const m=self.controller.fetchModel(self.opts);let box=node('div');box.append(node('h2',{},m.name),node('p',{},m.description||''));(m.prices||[]).forEach(p=>box.append(node('p',{},(gTitle(p.name))+': '+fmt(p.val))));html=box.innerHTML;}
    detail(html);
   };this.domNode.append(info);
  };
 }
 function gTitle(name){let r=game.resPool.get(name);return r?r.title||name:name;}
 async function syncComplication(force){
  if(!ready)return;const now=Date.now();if(!force && now-lastComplicationSync<5000)return;lastComplicationSync=now;
  try{
   const list=game.resPool.resources.filter(r=>(r.visible||r.craftable||r.unlocked||r.value>0||r.name==='catnip')).map(r=>({
    name:r.name,title:r.title||r.name,value:Number(r.value)||0,max:Number(r.maxValue)||0,
    rate:game.isPaused?0:(Number(game.getResourcePerTick(r.name,true))*Number(game.ticksPerSecond)||0)
   }));
   await fetch('/complication-state',{method:'POST',body:JSON.stringify({resources:list}),keepalive:true});
  }catch(e){console.warn('Complication sync failed',e);}
 }
 const originalInit=window.initGame;
 window.initGame=async function(){
  try{
   if(!LCstorage[KEY]){try{const r=await fetch('/restore'),backup=await r.json();if(backup&&backup.saveVersion)LCstorage[KEY]=JSON.stringify(backup);}catch(e){}}
   classes.game.Server.prototype.refresh=function(){};classes.game.Server.prototype.fetchBcoinPrice=function(){return $.Deferred().resolve().promise();};installDetails();originalInit();
   if(!window.game||!game.resPool)throw Error('Game engine did not initialize');
   ready=true;game.opts.disableTelemetry=true;game.opts.enableRedshift=true;game.opts.useWorkers=false;game.autosaveFrequency=50;
   status('Offline · saved on this watch');go('play');
   syncComplication(true);
   setInterval(()=>{if(!document.hidden){update();syncComplication(false);}},1000);
   setInterval(()=>{if(!document.hidden)save(false);},10000);
  }catch(e){status('Startup failed: '+e.message);console.error(e);}
 };
 document.addEventListener('visibilitychange',()=>{
  if(!ready)return;
  if(document.hidden){syncComplication(true);save(false);clearInterval(game._mainTimer);game._mainTimer=null;suspended=true;}
  else if(suspended){suspended=false;if(!game.isPaused)game.time.calculateRedshift();game.start();update();syncComplication(true);}
 });
 window.addEventListener('pagehide',()=>{if(ready)game.save();});
 document.body.dataset.page='play';
})();
