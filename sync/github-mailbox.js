(function(global){
  'use strict';
  function b64Utf8(text){
    const bytes=new TextEncoder().encode(text);let bin='';
    for(const b of bytes)bin+=String.fromCharCode(b);
    return btoa(bin);
  }
  function fromB64Utf8(text){
    const bin=atob(text.replace(/\n/g,'')),bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function create(opts){
    const owner=opts.owner,repo=opts.repo,branch=opts.branch||'main',request=opts.request;
    if(!owner||!repo||!request)throw new Error('GitHub mailbox requires owner, repo, and request().');
    const apiPath=p=>'/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo)+'/contents/'+p.split('/').map(encodeURIComponent).join('/');
    async function read(path){
      const r=await request({method:'GET',path:apiPath(path)+'?ref='+encodeURIComponent(branch)});
      if(r.status===404)return null;
      if(r.status<200||r.status>=300)throw new Error('GitHub read failed ('+r.status+'): '+String(r.body||''));
      const x=typeof r.body==='string'?JSON.parse(r.body):r.body;
      return {sha:x.sha,text:fromB64Utf8(x.content),json:JSON.parse(fromB64Utf8(x.content))};
    }
    async function write(path,value,message,sha){
      const body={message:message||('Update '+path),content:b64Utf8(JSON.stringify(value)),branch};
      if(sha)body.sha=sha;
      const r=await request({method:'PUT',path:apiPath(path),json:body});
      if(r.status===409||r.status===422)return {conflict:true,status:r.status,body:r.body};
      if(r.status<200||r.status>=300)throw new Error('GitHub write failed ('+r.status+'): '+String(r.body||''));
      const x=typeof r.body==='string'?JSON.parse(r.body):r.body;
      return {conflict:false,contentSha:x.content&&x.content.sha,commitSha:x.commit&&x.commit.sha};
    }
    async function appendBatch(device,batch){
      const id=(batch.id||((batch.time||Date.now())+'-'+device+'-'+Math.random().toString(16).slice(2)));
      const path='devices/'+device+'/events/'+id+'.json';
      const w=await write(path,batch,'Append '+device+' sync events '+id);
      if(w.conflict)throw new Error('Unexpected append-only event collision for '+id);
      return {id,path,...w};
    }
    async function readDeviceHead(device){return read('devices/'+device+'/head.json');}
    async function updateDeviceHead(device,head,expectedSha){
      const path='devices/'+device+'/head.json';
      if(expectedSha!==undefined)return write(path,head,'Advance '+device+' sync head',expectedSha||undefined);
      const current=await read(path);
      return write(path,head,'Advance '+device+' sync head',current&&current.sha);
    }
    async function readBatch(path){return read(path);}
    async function readCanonical(){return read('canonical/head.json');}
    async function readRevision(path){return read(path);}
    async function writeRevision(revision){
      const path='canonical/revisions/'+revision.revision+'.json';
      const out=await write(path,revision,'Create canonical Kittens revision '+revision.revision);
      if(out.conflict)throw new Error('Canonical revision id collision: '+revision.revision);
      return {path,...out};
    }
    async function updateCanonical(head,expectedSha){
      return write('canonical/head.json',head,'Advance canonical Kittens revision',expectedSha);
    }
    return {owner,repo,branch,read,write,appendBatch,readDeviceHead,updateDeviceHead,readBatch,readCanonical,readRevision,writeRevision,updateCanonical};
  }
  global.KittensGitHubMailbox={create};
})(window);
