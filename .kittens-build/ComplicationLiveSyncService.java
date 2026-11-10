package com.balthazar.kittenswear;

import android.app.*;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.json.JSONObject;
import java.net.URI;

public class ComplicationLiveSyncService extends Service {
 private static final String CHANNEL="kittens_live_complications";
 private static final int NOTIFICATION_ID=18745;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private WebSocketClient socket;
 private int generation=0;
 private long reconnectDelay=1000;
 private boolean stopping=false;

 @Override public void onCreate(){
  super.onCreate();
  createChannel();
  startForeground(NOTIFICATION_ID,notification("Keeping Kittens complications live"));
 }

 @Override public int onStartCommand(Intent intent,int flags,int startId){
  stopping=false;
  connect();
  return START_STICKY;
 }

 @Override public void onDestroy(){
  stopping=true;generation++;
  handler.removeCallbacksAndMessages(null);
  try{if(socket!=null)socket.close();}catch(Throwable ignored){}
  socket=null;
  super.onDestroy();
 }

 @Override public IBinder onBind(Intent intent){return null;}

 private void createChannel(){
  if(android.os.Build.VERSION.SDK_INT>=26){
   NotificationChannel ch=new NotificationChannel(CHANNEL,"Kittens live complications",NotificationManager.IMPORTANCE_MIN);
   ch.setDescription("Keeps Kittens Game watch complications synchronized with the active phone or watch game.");
   ch.setShowBadge(false);
   NotificationManager nm=getSystemService(NotificationManager.class);
   if(nm!=null)nm.createNotificationChannel(ch);
  }
 }

 private Notification notification(String text){
  Intent open=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  PendingIntent pi=PendingIntent.getActivity(this,18745,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification.Builder b=android.os.Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
  return b.setSmallIcon(com.balthazar.kittenswear.R.drawable.ic_complication)
   .setContentTitle("Kittens Game")
   .setContentText(text)
   .setContentIntent(pi)
   .setOngoing(true)
   .setOnlyAlertOnce(true)
   .build();
 }

 private void updateNotification(String text){
  try{
   NotificationManager nm=getSystemService(NotificationManager.class);
   if(nm!=null)nm.notify(NOTIFICATION_ID,notification(text));
  }catch(Throwable ignored){}
 }

 private void connect(){
  ComplicationLiveSync.Config cfg=ComplicationLiveSync.config(this);
  if(cfg==null){stopSelf();return;}
  int myGeneration=++generation;
  try{if(socket!=null)socket.close();}catch(Throwable ignored){}

  try{
   socket=new WebSocketClient(new URI(ComplicationLiveSync.wsUrl(cfg))){
    @Override public void onOpen(ServerHandshake handshake){
     if(myGeneration!=generation)return;
     reconnectDelay=1000;
     updateNotification("Kittens complications synchronized");
     try{
      JSONObject auth=new JSONObject();
      auth.put("type","auth");
      auth.put("deviceId","watch");
      auth.put("deviceToken",cfg.deviceToken);
      auth.put("observer",true);
      auth.put("lastRevision",0);
      send(auth.toString());
     }catch(Throwable ignored){}
     scheduleHeartbeat(myGeneration);
    }

    @Override public void onMessage(String message){
     if(myGeneration!=generation)return;
     try{
      JSONObject data=new JSONObject(message);
      String type=data.optString("type","");
      if("live".equals(type)){
       ComplicationLiveSync.acceptLiveEnvelope(ComplicationLiveSyncService.this,data,true);
      }else if("welcome".equals(type)||"observer-heartbeat-ack".equals(type)){
       JSONObject live=data.optJSONObject("live");
       if(live!=null)ComplicationLiveSync.acceptLiveEnvelope(ComplicationLiveSyncService.this,live,true);
      }else if("owner-changed".equals(type)&&data.isNull("ownerDeviceId")){
       ComplicationStore.freezeAtCurrentValues(ComplicationLiveSyncService.this);
      }else if("auth-failed".equals(type)){
       updateNotification("Kittens complication sync needs re-pairing");
      }
     }catch(Throwable ignored){}
    }

    @Override public void onClose(int code,String reason,boolean remote){
     if(myGeneration!=generation||stopping)return;
     updateNotification("Kittens complications reconnecting");
     scheduleReconnect(myGeneration);
    }

    @Override public void onError(Exception ex){
     if(myGeneration!=generation||stopping)return;
     scheduleReconnect(myGeneration);
    }
   };
   socket.setConnectionLostTimeout(35);
   socket.connect();
  }catch(Throwable e){
   scheduleReconnect(myGeneration);
  }
 }

 private void scheduleHeartbeat(int myGeneration){
  handler.postDelayed(new Runnable(){
   @Override public void run(){
    if(stopping||myGeneration!=generation)return;
    try{
     if(socket!=null&&socket.isOpen()){
      socket.send("{\"type\":\"observer-heartbeat\"}");
     }
    }catch(Throwable ignored){}
    handler.postDelayed(this,20000);
   }
  },20000);
 }

 private void scheduleReconnect(int myGeneration){
  if(stopping||myGeneration!=generation)return;
  long delay=reconnectDelay;
  reconnectDelay=Math.min(30000,Math.round(reconnectDelay*1.7));
  handler.postDelayed(()->{
   if(!stopping&&myGeneration==generation)connect();
  },delay);
 }
}
