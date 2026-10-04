package com.balthazar.kittenswear;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.RemoteException;
import androidx.wear.protolayout.expression.DynamicBuilders;
import androidx.wear.watchface.complications.data.*;
import androidx.wear.watchface.complications.datasource.*;
import java.time.Instant;
import java.util.Locale;

public class KittensComplicationService extends ComplicationDataSourceService {
 @Override public void onComplicationRequest(ComplicationRequest request,ComplicationRequestListener listener){
  ComplicationStore.ResourceInfo r=ComplicationStore.selectedInfo(this);
  if(r==null){deliver(listener,buildStatic(request.getComplicationType(),"Open","Kittens","Open Kittens Wear to sync resources"));return;}
  double projected=r.projected(System.currentTimeMillis());
  String fallback=shortNumber(projected);String desc=r.title+" "+fallback+(r.max>0?" of "+shortNumber(r.max):"");
  ComplicationText dynamicText=dynamicValueText(r,fallback);
  PendingIntent tap=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  ComplicationType type=request.getComplicationType();
  if(ComplicationType.RANGED_VALUE.equals(type)){
   deliver(listener,buildRanged(r,projected,dynamicText,desc,tap));
  } else if(ComplicationType.LONG_TEXT.equals(type)){
   String longFallback=r.title+" "+fallback+(r.max>0?" / "+shortNumber(r.max):"");
   ComplicationText longDynamic=dynamicLongText(r,longFallback);
   deliver(listener,new LongTextComplicationData.Builder(longDynamic,new PlainComplicationText.Builder(desc).build()).setTapAction(tap).build());
  } else {
   deliver(listener,new ShortTextComplicationData.Builder(dynamicText,new PlainComplicationText.Builder(desc).build()).setTitle(new PlainComplicationText.Builder(shortTitle(r.title)).build()).setTapAction(tap).build());
  }
 }
 @Override public ComplicationData getPreviewData(ComplicationType type){return buildStatic(type,"1.2K","Catnip","Catnip 1.2K");}

 private static void deliver(ComplicationRequestListener listener,ComplicationData data){
  try{listener.onComplicationData(data);}catch(RemoteException ignored){}
 }

 private ComplicationData buildStatic(ComplicationType type,String value,String title,String desc){
  PendingIntent tap=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  PlainComplicationText text=new PlainComplicationText.Builder(value).build(),cd=new PlainComplicationText.Builder(desc).build();
  if(ComplicationType.RANGED_VALUE.equals(type))return new RangedValueComplicationData.Builder(0.24f,0f,1f,cd).setText(text).setTitle(new PlainComplicationText.Builder(title).build()).setTapAction(tap).build();
  if(ComplicationType.LONG_TEXT.equals(type))return new LongTextComplicationData.Builder(new PlainComplicationText.Builder(title+" "+value).build(),cd).setTapAction(tap).build();
  return new ShortTextComplicationData.Builder(text,cd).setTitle(new PlainComplicationText.Builder(title).build()).setTapAction(tap).build();
 }

 private ComplicationData buildRanged(ComplicationStore.ResourceInfo r,double projected,ComplicationText dynamicText,String desc,PendingIntent tap){
  PlainComplicationText cd=new PlainComplicationText.Builder(desc).build();
  PlainComplicationText title=new PlainComplicationText.Builder(shortTitle(r.title)).build();
  if(r.max>0 && Double.isFinite(r.max)){
   float fallback=(float)Math.max(0.0,Math.min(1.0,projected/r.max));
   try{
    return new RangedValueComplicationData.Builder(dynamicFraction(r),fallback,0f,1f,cd).setText(dynamicText).setTitle(title).setTapAction(tap).build();
   }catch(Throwable ignored){
    return new RangedValueComplicationData.Builder(fallback,0f,1f,cd).setText(dynamicText).setTitle(title).setTapAction(tap).build();
   }
  }
  return new RangedValueComplicationData.Builder(0f,0f,1f,cd).setText(dynamicText).setTitle(title).setTapAction(tap).build();
 }

 private ComplicationText dynamicValueText(ComplicationStore.ResourceInfo r,String fallback){
  try{return new DynamicComplicationText(abbreviated(dynamicValue(r)),fallback);}catch(Throwable e){return new PlainComplicationText.Builder(fallback).build();}
 }
 private ComplicationText dynamicLongText(ComplicationStore.ResourceInfo r,String fallback){
  try{
   DynamicBuilders.DynamicString s=DynamicBuilders.DynamicString.constant(shortTitle(r.title)+" ").concat(abbreviated(dynamicValue(r)));
   if(r.max>0)s=s.concat(DynamicBuilders.DynamicString.constant(" / "+shortNumber(r.max)));
   return new DynamicComplicationText(s,fallback);
  }catch(Throwable e){return new PlainComplicationText.Builder(fallback).build();}
 }
 private DynamicBuilders.DynamicFloat dynamicFraction(ComplicationStore.ResourceInfo r){
  double start=r.max>0?r.value/r.max:0.0, perSecond=r.max>0?r.rate/r.max:0.0;
  DynamicBuilders.DynamicInt32 seconds=DynamicBuilders.DynamicInstant.withSecondsPrecision(Instant.ofEpochMilli(r.timestamp)).durationUntil(DynamicBuilders.DynamicInstant.platformTimeWithSecondsPrecision()).toIntSeconds();
  DynamicBuilders.DynamicFloat raw=DynamicBuilders.DynamicFloat.constant((float)start).plus(seconds.times((float)perSecond));
  DynamicBuilders.DynamicFloat nonnegative=DynamicBuilders.DynamicFloat.onCondition(raw.lt(0f)).use(0f).elseUse(raw);
  return DynamicBuilders.DynamicFloat.onCondition(nonnegative.gt(1f)).use(1f).elseUse(nonnegative);
 }
 private DynamicBuilders.DynamicFloat dynamicValue(ComplicationStore.ResourceInfo r){
  DynamicBuilders.DynamicInt32 seconds=DynamicBuilders.DynamicInstant.withSecondsPrecision(Instant.ofEpochMilli(r.timestamp)).durationUntil(DynamicBuilders.DynamicInstant.platformTimeWithSecondsPrecision()).toIntSeconds();
  DynamicBuilders.DynamicFloat raw=DynamicBuilders.DynamicFloat.constant((float)r.value).plus(seconds.times((float)r.rate));
  DynamicBuilders.DynamicFloat nonnegative=DynamicBuilders.DynamicFloat.onCondition(raw.lt(0f)).use(0f).elseUse(raw);
  if(r.max>0)return DynamicBuilders.DynamicFloat.onCondition(nonnegative.gt((float)r.max)).use((float)r.max).elseUse(nonnegative);
  return nonnegative;
 }
 private DynamicBuilders.DynamicString abbreviated(DynamicBuilders.DynamicFloat v){
  DynamicBuilders.DynamicFloat.FloatFormatter one=new DynamicBuilders.DynamicFloat.FloatFormatter.Builder().setMaxFractionDigits(1).setMinFractionDigits(0).setGroupingUsed(false).build();
  DynamicBuilders.DynamicString base=v.format(one);
  DynamicBuilders.DynamicString k=v.div(1_000f).format(one).concat(DynamicBuilders.DynamicString.constant("K"));
  DynamicBuilders.DynamicString m=v.div(1_000_000f).format(one).concat(DynamicBuilders.DynamicString.constant("M"));
  DynamicBuilders.DynamicString b=v.div(1_000_000_000f).format(one).concat(DynamicBuilders.DynamicString.constant("B"));
  DynamicBuilders.DynamicString t=v.div(1_000_000_000_000f).format(one).concat(DynamicBuilders.DynamicString.constant("T"));
  return DynamicBuilders.DynamicString.onCondition(v.gte(1_000_000_000_000f)).use(t).elseUse(
   DynamicBuilders.DynamicString.onCondition(v.gte(1_000_000_000f)).use(b).elseUse(
    DynamicBuilders.DynamicString.onCondition(v.gte(1_000_000f)).use(m).elseUse(
     DynamicBuilders.DynamicString.onCondition(v.gte(1_000f)).use(k).elseUse(base))));
 }
 private static String shortTitle(String s){if(s==null||s.isEmpty())return "Kittens";return s.length()<=10?s:s.substring(0,10);}
 static String shortNumber(double v){
  double a=Math.abs(v);if(a>=1e12)return trim(v/1e12)+"T";if(a>=1e9)return trim(v/1e9)+"B";if(a>=1e6)return trim(v/1e6)+"M";if(a>=1e3)return trim(v/1e3)+"K";return trim(v);
 }
 private static String trim(double v){String s=String.format(Locale.US,"%.1f",v);return s.endsWith(".0")?s.substring(0,s.length()-2):s;}
}
