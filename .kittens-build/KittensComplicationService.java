package com.balthazar.kittenswear;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.RemoteException;
import androidx.wear.watchface.complications.data.*;
import androidx.wear.watchface.complications.datasource.*;
import java.util.Locale;

public class KittensComplicationService extends ComplicationDataSourceService {
 @Override public void onComplicationActivated(int complicationInstanceId,ComplicationType type){
  super.onComplicationActivated(complicationInstanceId,type);
  ComplicationStore.markActive(this,complicationInstanceId,true);
  ComplicationStore.requestUpdate(this,true);
 }
 @Override public void onComplicationDeactivated(int complicationInstanceId){
  ComplicationStore.markActive(this,complicationInstanceId,false);
  ComplicationStore.cancelFullAlarm(this,complicationInstanceId);
  super.onComplicationDeactivated(complicationInstanceId);
 }

 @Override public void onComplicationRequest(ComplicationRequest request,ComplicationRequestListener listener){
  int id=request.getComplicationInstanceId();
  ComplicationStore.markActive(this,id,true);
  ComplicationStore.ResourceInfo r=ComplicationStore.selectedInfo(this,id);
  ComplicationType type=request.getComplicationType();

  if(r==null){
   String selected=ComplicationStore.selected(this,id);
   String title=selected==null||selected.isEmpty()?"Kittens":selected;
   deliver(listener,buildStatic(type,"Open",shortTitle(title),"Open Kittens Wear once to refresh this resource",id));
   return;
  }

  double value=r.projected(System.currentTimeMillis());
  String text=shortNumber(value);
  String desc=r.title+" "+text+(r.max>0?" of "+shortNumber(r.max):"");
  PendingIntent tap=tapIntent(id);

  if(ComplicationType.RANGED_VALUE.equals(type)){
   float fraction=r.max>0?(float)Math.max(0.0,Math.min(1.0,value/r.max)):0f;
   deliver(listener,new RangedValueComplicationData.Builder(
    fraction,0f,1f,new PlainComplicationText.Builder(desc).build())
    .setText(new PlainComplicationText.Builder(text).build())
    .setTitle(new PlainComplicationText.Builder(shortTitle(r.title)).build())
    .setTapAction(tap).build());
  }else if(ComplicationType.LONG_TEXT.equals(type)){
   String longText=r.title+" "+text+(r.max>0?" / "+shortNumber(r.max):"");
   deliver(listener,new LongTextComplicationData.Builder(
    new PlainComplicationText.Builder(longText).build(),
    new PlainComplicationText.Builder(desc).build())
    .setTapAction(tap).build());
  }else{
   deliver(listener,new ShortTextComplicationData.Builder(
    new PlainComplicationText.Builder(text).build(),
    new PlainComplicationText.Builder(desc).build())
    .setTitle(new PlainComplicationText.Builder(shortTitle(r.title)).build())
    .setTapAction(tap).build());
  }
 }

 @Override public ComplicationData getPreviewData(ComplicationType type){
  return buildStatic(type,"1.2K","Catnip","Catnip 1.2K",0);
 }

 private PendingIntent tapIntent(int id){
  Intent i=new Intent(this,MainActivity.class)
   .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  return PendingIntent.getActivity(this,id,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 }

 private ComplicationData buildStatic(ComplicationType type,String value,String title,String desc,int id){
  PendingIntent tap=tapIntent(id);
  PlainComplicationText text=new PlainComplicationText.Builder(value).build();
  PlainComplicationText cd=new PlainComplicationText.Builder(desc).build();
  if(ComplicationType.RANGED_VALUE.equals(type)){
   return new RangedValueComplicationData.Builder(0f,0f,1f,cd)
    .setText(text)
    .setTitle(new PlainComplicationText.Builder(title).build())
    .setTapAction(tap).build();
  }
  if(ComplicationType.LONG_TEXT.equals(type)){
   return new LongTextComplicationData.Builder(
    new PlainComplicationText.Builder(title+" "+value).build(),cd)
    .setTapAction(tap).build();
  }
  return new ShortTextComplicationData.Builder(text,cd)
   .setTitle(new PlainComplicationText.Builder(title).build())
   .setTapAction(tap).build();
 }

 private static void deliver(ComplicationRequestListener listener,ComplicationData data){
  try{listener.onComplicationData(data);}catch(RemoteException ignored){}
 }
 private static String shortTitle(String s){
  if(s==null||s.isEmpty())return "Kittens";
  return s.length()<=10?s:s.substring(0,10);
 }
 static String shortNumber(double v){
  double a=Math.abs(v);
  if(a>=1e12)return trim(v/1e12)+"T";
  if(a>=1e9)return trim(v/1e9)+"B";
  if(a>=1e6)return trim(v/1e6)+"M";
  if(a>=1e3)return trim(v/1e3)+"K";
  return trim(v);
 }
 private static String trim(double v){
  String s=String.format(Locale.US,"%.1f",v);
  return s.endsWith(".0")?s.substring(0,s.length()-2):s;
 }
}
