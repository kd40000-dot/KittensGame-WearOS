package com.balthazar.kittenswear;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class ComplicationLiveSync {
 static final String PREFS="kittens_live_complication";
 private static final String KEY_ENDPOINT="endpoint";
 private static final String KEY_SESSION="session";
 private static final String KEY_TOKEN="token";
 private static final String KEY_LAST_PANEL_UPDATE="last_panel_update";
 private static final ExecutorService IO=Executors.newSingleThreadExecutor();

 static final class Config {
  final String endpoint,sessionId,deviceToken;
  Config(String e,String s,String t){endpoint=e;sessionId=s;deviceToken=t;}
 }

 private ComplicationLiveSync(){}

 static SharedPreferences prefs(Context c){
  return c.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
 }

 static Config config(Context c){
  SharedPreferences p=prefs(c);
  String e=p.getString(KEY_ENDPOINT,""),s=p.getString(KEY_SESSION,""),t=p.getString(KEY_TOKEN,"");
  if(e==null||s==null||t==null||e.isEmpty()||s.isEmpty()||t.isEmpty())return null;
  return new Config(e,s,t);
 }

 static boolean configured(Context c){return config(c)!=null;}

 static void saveConfig(Context c,String endpoint,String sessionId,String token){
  endpoint=endpoint==null?"":endpoint.trim().replaceAll("/+$","");
  sessionId=sessionId==null?"":sessionId.trim();
  token=token==null?"":token.trim();
  if(endpoint.isEmpty()||sessionId.isEmpty()||token.isEmpty())return;
  prefs(c).edit()
   .putString(KEY_ENDPOINT,endpoint)
   .putString(KEY_SESSION,sessionId)
   .putString(KEY_TOKEN,token)
   .apply();
  startObserver(c);
 }

 static void clearConfig(Context c){
  prefs(c).edit().clear().apply();
  try{c.stopService(new Intent(c,ComplicationLiveSyncService.class));}catch(Throwable ignored){}
 }

 static void startObserver(Context c){
  if(!configured(c))return;
  try{
   Intent i=new Intent(c,ComplicationLiveSyncService.class);
   if(android.os.Build.VERSION.SDK_INT>=26)c.startForegroundService(i);
   else c.startService(i);
  }catch(Throwable ignored){}
 }

 static String wsUrl(Config cfg){
  String base=cfg.endpoint.replaceFirst("^https:","wss:").replaceFirst("^http:","ws:");
  return base+"/ws/"+urlEncode(cfg.sessionId);
 }

 static String stateUrl(Config cfg){
  return cfg.endpoint+"/api/session/"+urlEncode(cfg.sessionId)+"/state";
 }

 private static String urlEncode(String s){
  try{return java.net.URLEncoder.encode(s,"UTF-8").replace("+","%20");}
  catch(Exception e){return s;}
 }

 static void refreshAsync(Context c,Runnable done){
  Context app=c.getApplicationContext();
  IO.execute(()->{
   try{refreshBlocking(app);}catch(Throwable ignored){}
   if(done!=null)new Handler(Looper.getMainLooper()).post(done);
  });
 }

 static boolean refreshBlocking(Context c){
  Config cfg=config(c);
  if(cfg==null)return false;
  HttpURLConnection conn=null;
  try{
   conn=(HttpURLConnection)new URL(stateUrl(cfg)).openConnection();
   conn.setConnectTimeout(1800);
   conn.setReadTimeout(2200);
   conn.setRequestMethod("GET");
   conn.setRequestProperty("Accept","application/json");
   conn.setRequestProperty("X-Device-Id","watch");
   conn.setRequestProperty("X-Device-Token",cfg.deviceToken);
   int code=conn.getResponseCode();
   InputStream in=code>=400?conn.getErrorStream():conn.getInputStream();
   if(in==null||code>=400)return false;
   JSONObject body=new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8));
   JSONObject live=body.optJSONObject("live");
   if(live==null)return false;
   acceptLiveEnvelope(c,live,false);
   return true;
  }catch(Throwable e){return false;}
  finally{if(conn!=null)conn.disconnect();}
 }

 static void acceptLiveEnvelope(Context c,JSONObject live,boolean pushUpdates){
  try{
   JSONArray incoming=live.optJSONArray("resources");
   if(incoming==null)return;
   long now=System.currentTimeMillis();
   long serverTime=live.optLong("serverTime",now);
   double elapsed=Math.max(0,(now-serverTime)/1000.0);
   JSONArray normalized=new JSONArray();

   for(int i=0;i<incoming.length();i++){
    JSONObject src=incoming.optJSONObject(i);
    if(src==null)continue;
    String name=src.optString("name","");
    if(name.isEmpty())continue;
    double value=src.optDouble("value",0);
    double max=src.optDouble("max",0);
    double rate=src.optDouble("rate",0);
    value+=rate*elapsed;
    if(max>0)value=Math.min(max,value);
    value=Math.max(0,value);

    JSONObject out=new JSONObject();
    out.put("name",name);
    out.put("title",src.optString("title",name));
    out.put("value",value);
    out.put("max",max);
    out.put("rate",rate);
    normalized.put(out);
   }

   JSONObject root=new JSONObject();
   root.put("resources",normalized);
   boolean meaningful=ComplicationStore.saveSnapshot(c,root.toString(),false);

   if(pushUpdates){
    if(meaningful){
     KittensComplicationService.requestHudUpdates(c);
     prefs(c).edit().putLong(KEY_LAST_PANEL_UPDATE,now).apply();
    }else{
     long last=prefs(c).getLong(KEY_LAST_PANEL_UPDATE,0);
     if(now-last>=1000){
      KittensComplicationService.requestPanelUpdates(c);
      prefs(c).edit().putLong(KEY_LAST_PANEL_UPDATE,now).apply();
     }
    }
   }
  }catch(Throwable ignored){}
 }
}
