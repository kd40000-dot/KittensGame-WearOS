package com.balthazar.kittenswear;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

final class ComplicationStore {
 static final String PREFS="kittens_complication";
 static final String KEY_RESOURCE="resource";
 static final String KEY_VIBRATE="vibrate_full";
 static final String KEY_SNAPSHOT="snapshot";
 static final String KEY_FULL_NOTIFIED="full_notified";
 static final String KEY_LAST_UPDATE_REQUEST="last_update_request";
 static final String ACTION_FULL="com.balthazar.kittenswear.RESOURCE_FULL";
 private static final int ALARM_REQUEST=4107;
 private static final long UPDATE_MIN_INTERVAL_MS=5*60*1000L;
 private static final double CHANGE_REL_TOL=1e-6;
 private static final double CHANGE_ABS_TOL=1e-4;

 static final class ResourceInfo {
  final String name,title; final double value,max,rate; final long timestamp;
  ResourceInfo(String n,String t,double v,double m,double r,long ts){name=n;title=t;value=v;max=m;rate=r;timestamp=ts;}
  double projected(long now){
   double seconds=Math.max(0,(now-timestamp)/1000.0); double out=value+rate*seconds;
   if(max>0)out=Math.min(max,out); return Math.max(0,out);
  }
 }

 private ComplicationStore(){}
 static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
 static String selected(Context c){return prefs(c).getString(KEY_RESOURCE,"catnip");}
 static boolean vibrateEnabled(Context c){return prefs(c).getBoolean(KEY_VIBRATE,false);}

 static void saveSnapshot(Context c,String json) throws Exception {
  JSONObject root=new JSONObject(json);
  root.getJSONArray("resources");
  root.put("timestamp",System.currentTimeMillis());
  String previous=prefs(c).getString(KEY_SNAPSHOT,null);
  ResourceInfo before=findIn(previous,selected(c));
  prefs(c).edit().putString(KEY_SNAPSHOT,root.toString()).apply();
  ResourceInfo now=findIn(root.toString(),selected(c));
  boolean selectedStateChanged=meaningfulStateChange(before,now);
  if(now!=null && now.max>0){
   boolean full=now.value>=now.max-Math.max(1e-9,Math.abs(now.max)*1e-9);
   boolean wasFull=before!=null && before.max>0 && before.value>=before.max-Math.max(1e-9,Math.abs(before.max)*1e-9);
   if(!full){prefs(c).edit().putBoolean(KEY_FULL_NOTIFIED,false).apply();scheduleFullAlarm(c,now);}
   else {cancelFullAlarm(c);if(!wasFull && vibrateEnabled(c) && !prefs(c).getBoolean(KEY_FULL_NOTIFIED,false)){vibrate(c);prefs(c).edit().putBoolean(KEY_FULL_NOTIFIED,true).apply();}}
  } else cancelFullAlarm(c);
  requestUpdate(c,selectedStateChanged);
 }

 static boolean meaningfulStateChange(ResourceInfo before,ResourceInfo now){
  if(before==null || now==null)return true;
  if(!nearlyEqual(before.max,now.max) || !nearlyEqual(before.rate,now.rate))return true;
  double expected=before.projected(now.timestamp);
  return !nearlyEqual(expected,now.value);
 }
 private static boolean nearlyEqual(double a,double b){
  double scale=Math.max(1.0,Math.max(Math.abs(a),Math.abs(b)));
  return Math.abs(a-b)<=Math.max(CHANGE_ABS_TOL,scale*CHANGE_REL_TOL);
 }

 static List<ResourceInfo> resources(Context c){
  List<ResourceInfo> out=new ArrayList<>(); String raw=prefs(c).getString(KEY_SNAPSHOT,null); if(raw==null)return out;
  try{JSONObject root=new JSONObject(raw);long ts=root.optLong("timestamp",System.currentTimeMillis());JSONArray a=root.getJSONArray("resources");
   for(int i=0;i<a.length();i++){JSONObject o=a.getJSONObject(i);out.add(new ResourceInfo(o.getString("name"),o.optString("title",o.getString("name")),o.optDouble("value",0),o.optDouble("max",0),o.optDouble("rate",0),ts));}
  }catch(Exception ignored){}
  out.sort(Comparator.comparing(r->r.title.toLowerCase(java.util.Locale.ROOT)));return out;
 }

 static ResourceInfo selectedInfo(Context c){return findIn(prefs(c).getString(KEY_SNAPSHOT,null),selected(c));}
 private static ResourceInfo findIn(String raw,String name){
  if(raw==null)return null;try{JSONObject root=new JSONObject(raw);long ts=root.optLong("timestamp",System.currentTimeMillis());JSONArray a=root.getJSONArray("resources");
   for(int i=0;i<a.length();i++){JSONObject o=a.getJSONObject(i);if(name.equals(o.optString("name")))return new ResourceInfo(name,o.optString("title",name),o.optDouble("value",0),o.optDouble("max",0),o.optDouble("rate",0),ts);}
  }catch(Exception ignored){}return null;
 }

 static void configure(Context c,String resource,boolean vibrate){
  prefs(c).edit().putString(KEY_RESOURCE,resource).putBoolean(KEY_VIBRATE,vibrate).putBoolean(KEY_FULL_NOTIFIED,false).apply();
  ResourceInfo r=selectedInfo(c); if(r!=null && r.max>0 && r.value<r.max)scheduleFullAlarm(c,r); else cancelFullAlarm(c); requestUpdate(c,true);
 }

 static void requestUpdate(Context c,boolean force){
  long now=System.currentTimeMillis(),last=prefs(c).getLong(KEY_LAST_UPDATE_REQUEST,0);
  if(!force && now-last<UPDATE_MIN_INTERVAL_MS)return;
  try{
   ComplicationDataSourceUpdateRequester.create(c,new ComponentName(c,KittensComplicationService.class)).requestUpdateAll();
   prefs(c).edit().putLong(KEY_LAST_UPDATE_REQUEST,now).apply();
  }catch(Throwable ignored){}
 }

 static void scheduleFullAlarm(Context c,ResourceInfo r){
  cancelFullAlarm(c); if(!vibrateEnabled(c) || r==null || r.max<=0 || r.rate<=0)return;
  double left=r.max-r.projected(System.currentTimeMillis()); if(left<=0)return;
  long delay=(long)Math.ceil(left/r.rate*1000.0); if(delay<1000)delay=1000;
  AlarmManager am=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
  if(am!=null)am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,SystemClock.elapsedRealtime()+delay,alarmIntent(c));
 }
 static void cancelFullAlarm(Context c){AlarmManager am=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);if(am!=null)am.cancel(alarmIntent(c));}
 private static PendingIntent alarmIntent(Context c){Intent i=new Intent(c,ResourceFullReceiver.class).setAction(ACTION_FULL);return PendingIntent.getBroadcast(c,ALARM_REQUEST,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}

 static void onFullAlarm(Context c){
  ResourceInfo r=selectedInfo(c); if(r==null || !vibrateEnabled(c) || r.max<=0)return;
  double v=r.projected(System.currentTimeMillis());
  if(v>=r.max-Math.max(1e-9,Math.abs(r.max)*1e-9)){
   if(!prefs(c).getBoolean(KEY_FULL_NOTIFIED,false)){vibrate(c);prefs(c).edit().putBoolean(KEY_FULL_NOTIFIED,true).apply();requestUpdate(c,true);}
  } else scheduleFullAlarm(c,r);
 }

 static void vibrate(Context c){
  try{
   Vibrator v;
   if(android.os.Build.VERSION.SDK_INT>=31){VibratorManager vm=(VibratorManager)c.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);v=vm==null?null:vm.getDefaultVibrator();}
   else v=(Vibrator)c.getSystemService(Context.VIBRATOR_SERVICE);
   if(v!=null && v.hasVibrator())v.vibrate(VibrationEffect.createWaveform(new long[]{0,180,90,180},-1));
  }catch(Throwable ignored){}
 }
}
