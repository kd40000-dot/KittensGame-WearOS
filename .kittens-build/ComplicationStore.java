package com.balthazar.kittenswear;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class ComplicationStore {
 static final String PREFS="kittens_complication";
 static final String KEY_RESOURCE_LEGACY="resource";
 static final String KEY_VIBRATE_LEGACY="vibrate_full";
 static final String KEY_SNAPSHOT="snapshot";
 static final String KEY_LAST_UPDATE_REQUEST="last_update_request";
 static final String KEY_RESOURCE_PREFIX="resource.";
 static final String KEY_VIBRATE_PREFIX="vibrate.";
 static final String KEY_ACTIVE_PREFIX="active.";
 static final String KEY_FULL_NOTIFIED_PREFIX="full_notified.";
 static final String ACTION_FULL="com.balthazar.kittenswear.RESOURCE_FULL";
 static final String EXTRA_INSTANCE_ID="complicationInstanceId";
 private static final long UPDATE_MIN_INTERVAL_MS=5*60*1000L;

 static final class ResourceInfo {
  final String name,title; final double value,max,rate; final long timestamp;
  ResourceInfo(String n,String t,double v,double m,double r,long ts){name=n;title=t;value=v;max=m;rate=r;timestamp=ts;}
  double projected(long now){
   double seconds=Math.max(0,(now-timestamp)/1000.0);
   double out=value+rate*seconds;
   if(max>0)out=Math.min(max,out);
   return Math.max(0,out);
  }
 }

 private ComplicationStore(){}
 static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREFS,Context.MODE_PRIVATE);}

 static String selected(Context c,int instanceId){
  SharedPreferences p=prefs(c);
  String specific=p.getString(KEY_RESOURCE_PREFIX+instanceId,null);
  if(specific!=null&&!specific.isEmpty())return specific;
  String legacy=p.getString(KEY_RESOURCE_LEGACY,"catnip");
  if(instanceId>=0)p.edit().putString(KEY_RESOURCE_PREFIX+instanceId,legacy).apply();
  return legacy;
 }
 static boolean vibrateEnabled(Context c,int instanceId){
  SharedPreferences p=prefs(c);
  String key=KEY_VIBRATE_PREFIX+instanceId;
  if(p.contains(key))return p.getBoolean(key,false);
  return p.getBoolean(KEY_VIBRATE_LEGACY,false);
 }

 static void markActive(Context c,int instanceId,boolean active){
  if(instanceId<0)return;
  prefs(c).edit().putBoolean(KEY_ACTIVE_PREFIX+instanceId,active).apply();
 }
 static Set<Integer> configuredInstanceIds(Context c){
  Set<Integer> out=new HashSet<>();
  for(Map.Entry<String,?> e:prefs(c).getAll().entrySet()){
   String k=e.getKey();
   if(k.startsWith(KEY_RESOURCE_PREFIX)||k.startsWith(KEY_ACTIVE_PREFIX)){
    int dot=k.indexOf('.');
    if(dot>=0){
     try{out.add(Integer.parseInt(k.substring(dot+1)));}catch(Exception ignored){}
    }
   }
  }
  return out;
 }

 static void saveSnapshot(Context c,String json) throws Exception {
  JSONObject root=new JSONObject(json);
  root.getJSONArray("resources");
  root.put("timestamp",System.currentTimeMillis());

  SharedPreferences p=prefs(c);
  String previous=p.getString(KEY_SNAPSHOT,null);
  Set<Integer> ids=configuredInstanceIds(c);
  java.util.HashMap<Integer,ResourceInfo> before=new java.util.HashMap<>();
  for(int id:ids)before.put(id,findIn(previous,selected(c,id)));

  String next=root.toString();
  p.edit().putString(KEY_SNAPSHOT,next).apply();

  boolean trackedChanged=false;
  long now=System.currentTimeMillis();
  for(int id:ids){
   ResourceInfo r=findIn(next,selected(c,id));
   if(meaningfulStateChange(before.get(id),r))trackedChanged=true;
   if(r!=null && r.max>0 && r.projected(now)<r.max) scheduleFullAlarm(c,id,r);
   else cancelFullAlarm(c,id);
  }

  // A spend/craft/build action must invalidate the visible complication immediately.
  // Otherwise ordinary refreshes may be throttled for several minutes.
  // HUD image panels are snapshot-rendered rather than continuously evaluated,
  // so refresh them whenever the game posts its current resource state.
  requestUpdate(c,true);
 }

 static boolean meaningfulStateChange(ResourceInfo before,ResourceInfo now){
  if(before==null||now==null)return before!=now;
  if(!nearlyEqual(before.max,now.max)||!nearlyEqual(before.rate,now.rate))return true;
  double expected=before.projected(now.timestamp);
  return !nearlyEqual(expected,now.value);
 }
 private static boolean nearlyEqual(double a,double b){
  double scale=Math.max(1.0,Math.max(Math.abs(a),Math.abs(b)));
  return Math.abs(a-b)<=Math.max(1e-4,scale*1e-6);
 }

 static List<ResourceInfo> resources(Context c){
  List<ResourceInfo> out=new ArrayList<>();
  String raw=prefs(c).getString(KEY_SNAPSHOT,null);
  if(raw==null)return out;
  try{
   JSONObject root=new JSONObject(raw);
   long ts=root.optLong("timestamp",System.currentTimeMillis());
   JSONArray a=root.getJSONArray("resources");
   for(int i=0;i<a.length();i++){
    JSONObject o=a.getJSONObject(i);
    String name=o.getString("name");
    out.add(new ResourceInfo(name,o.optString("title",name),o.optDouble("value",0),o.optDouble("max",0),o.optDouble("rate",0),ts));
   }
  }catch(Exception ignored){}
  out.sort(Comparator.comparing(r->r.title.toLowerCase(java.util.Locale.ROOT)));
  return out;
 }

 static ResourceInfo selectedInfo(Context c,int instanceId){
  return findIn(prefs(c).getString(KEY_SNAPSHOT,null),selected(c,instanceId));
 }
 static ResourceInfo findByName(Context c,String name){
  return findIn(prefs(c).getString(KEY_SNAPSHOT,null),name);
 }
 private static ResourceInfo findIn(String raw,String name){
  if(raw==null||name==null)return null;
  try{
   JSONObject root=new JSONObject(raw);
   long ts=root.optLong("timestamp",System.currentTimeMillis());
   JSONArray a=root.getJSONArray("resources");
   for(int i=0;i<a.length();i++){
    JSONObject o=a.getJSONObject(i);
    if(name.equals(o.optString("name"))){
     return new ResourceInfo(name,o.optString("title",name),o.optDouble("value",0),o.optDouble("max",0),o.optDouble("rate",0),ts);
    }
   }
  }catch(Exception ignored){}
  return null;
 }

 static void configure(Context c,int instanceId,String resource,boolean vibrate){
  if(instanceId<0)return;
  prefs(c).edit()
   .putString(KEY_RESOURCE_PREFIX+instanceId,resource)
   .putBoolean(KEY_VIBRATE_PREFIX+instanceId,vibrate)
   .putBoolean(KEY_ACTIVE_PREFIX+instanceId,true)
   .putBoolean(KEY_FULL_NOTIFIED_PREFIX+instanceId,false)
   .apply();
  ResourceInfo r=selectedInfo(c,instanceId);
  if(r!=null&&r.max>0&&r.projected(System.currentTimeMillis())<r.max)scheduleFullAlarm(c,instanceId,r);
  else cancelFullAlarm(c,instanceId);
  requestUpdate(c,true);
 }

 static void requestUpdate(Context c,boolean force){
  long now=System.currentTimeMillis(),last=prefs(c).getLong(KEY_LAST_UPDATE_REQUEST,0);
  if(!force&&now-last<UPDATE_MIN_INTERVAL_MS)return;
  try{
   HudUpdateRequester.requestAll(c);
   prefs(c).edit().putLong(KEY_LAST_UPDATE_REQUEST,now).apply();
  }catch(Throwable ignored){}
 }

 static void scheduleFullAlarm(Context c,int instanceId,ResourceInfo r){
  cancelFullAlarm(c,instanceId);
  if(!vibrateEnabled(c,instanceId)||r==null||r.max<=0||r.rate<=0)return;
  double left=r.max-r.projected(System.currentTimeMillis());
  if(left<=0)return;
  long delay=(long)Math.ceil(left/r.rate*1000.0);
  if(delay<1000)delay=1000;
  AlarmManager am=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
  if(am!=null)am.setAndAllowWhileIdle(
   AlarmManager.ELAPSED_REALTIME_WAKEUP,
   SystemClock.elapsedRealtime()+delay,
   alarmIntent(c,instanceId)
  );
 }
 static void cancelFullAlarm(Context c,int instanceId){
  AlarmManager am=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
  if(am!=null)am.cancel(alarmIntent(c,instanceId));
 }
 private static PendingIntent alarmIntent(Context c,int instanceId){
  Intent i=new Intent(c,ResourceFullReceiver.class)
   .setAction(ACTION_FULL)
   .setData(Uri.parse("kittenswear://complication/full/"+instanceId))
   .putExtra(EXTRA_INSTANCE_ID,instanceId);
  return PendingIntent.getBroadcast(c,instanceId,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 }

 static void onFullAlarm(Context c,int instanceId){
  ResourceInfo r=selectedInfo(c,instanceId);
  if(r==null||!vibrateEnabled(c,instanceId)||r.max<=0)return;
  double v=r.projected(System.currentTimeMillis());
  String notifiedKey=KEY_FULL_NOTIFIED_PREFIX+instanceId;
  if(v>=r.max-Math.max(1e-9,Math.abs(r.max)*1e-9)){
   if(!prefs(c).getBoolean(notifiedKey,false)){
    vibrate(c);
    prefs(c).edit().putBoolean(notifiedKey,true).apply();
    requestUpdate(c,true);
   }
  }else scheduleFullAlarm(c,instanceId,r);
 }

 static void vibrate(Context c){
  try{
   Vibrator v;
   if(android.os.Build.VERSION.SDK_INT>=31){
    VibratorManager vm=(VibratorManager)c.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
    v=vm==null?null:vm.getDefaultVibrator();
   }else v=(Vibrator)c.getSystemService(Context.VIBRATOR_SERVICE);
   if(v!=null&&v.hasVibrator())v.vibrate(VibrationEffect.createWaveform(new long[]{0,180,90,180},-1));
  }catch(Throwable ignored){}
 }
}
