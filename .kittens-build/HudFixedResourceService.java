package com.balthazar.kittenswear;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.RemoteException;
import androidx.wear.protolayout.expression.DynamicBuilders;
import androidx.wear.watchface.complications.data.*;
import androidx.wear.watchface.complications.datasource.*;
import java.time.Instant;
import java.util.Locale;

public abstract class HudFixedResourceService extends ComplicationDataSourceService {
 protected abstract String resourceName();

 @Override public void onComplicationRequest(ComplicationRequest request,ComplicationRequestListener listener){
  int id=request.getComplicationInstanceId();
  ComplicationStore.ResourceInfo r=ComplicationStore.findByName(this,resourceName());
  if(r==null){
   deliver(listener,emptyData(request.getComplicationType(),id));
   return;
  }
  deliver(listener,buildData(request.getComplicationType(),r,id));
 }

 @Override public ComplicationData getPreviewData(ComplicationType type){
  String n=resourceName();
  ComplicationStore.ResourceInfo fake=new ComplicationStore.ResourceInfo(n,n,65,100,0,System.currentTimeMillis());
  return buildData(type,fake,0);
 }

 private ComplicationData buildData(ComplicationType type,ComplicationStore.ResourceInfo r,int id){
  long now=System.currentTimeMillis();
  double value=r.projected(now);
  boolean capped=r.max>0&&Double.isFinite(r.max);
  float fraction=capped?(float)Math.max(0,Math.min(1,value/r.max)):0f;
  String fallback=capped?Math.round(fraction*100f)+"%":shortNumber(value);
  ComplicationText text=capped?dynamicPercentText(r,fallback):dynamicValueText(r,fallback);
  String desc=r.title+" "+fallback;
  PlainComplicationText cd=new PlainComplicationText.Builder(desc).build();
  PendingIntent tap=tapIntent(id);

  if(ComplicationType.RANGED_VALUE.equals(type)){
   DynamicBuilders.DynamicFloat dyn=capped?dynamicFraction(r):DynamicBuilders.DynamicFloat.constant(0f);
   return new RangedValueComplicationData.Builder(dyn,fraction,0f,1f,cd)
    .setText(text)
    .setTapAction(tap)
    .build();
  }
  return new ShortTextComplicationData.Builder(text,cd)
   .setTapAction(tap)
   .build();
 }

 private ComplicationData emptyData(ComplicationType type,int id){
  PlainComplicationText cd=new PlainComplicationText.Builder(resourceName()+" unavailable").build();
  PlainComplicationText text=new PlainComplicationText.Builder("--").build();
  if(ComplicationType.RANGED_VALUE.equals(type)){
   return new RangedValueComplicationData.Builder(0f,0f,1f,cd).setText(text).setTapAction(tapIntent(id)).build();
  }
  return new ShortTextComplicationData.Builder(text,cd).setTapAction(tapIntent(id)).build();
 }

 private ComplicationText dynamicPercentText(ComplicationStore.ResourceInfo r,String fallback){
  try{
   DynamicBuilders.DynamicFloat.FloatFormatter zero=new DynamicBuilders.DynamicFloat.FloatFormatter.Builder()
    .setMaxFractionDigits(0).setMinFractionDigits(0).setGroupingUsed(false).build();
   DynamicBuilders.DynamicString s=dynamicFraction(r).times(100f).format(zero)
    .concat(DynamicBuilders.DynamicString.constant("%"));
   return new DynamicComplicationText(s,fallback);
  }catch(Throwable e){return new PlainComplicationText.Builder(fallback).build();}
 }

 private ComplicationText dynamicValueText(ComplicationStore.ResourceInfo r,String fallback){
  try{return new DynamicComplicationText(abbreviated(dynamicValue(r)),fallback);}
  catch(Throwable e){return new PlainComplicationText.Builder(fallback).build();}
 }

 private DynamicBuilders.DynamicFloat dynamicFraction(ComplicationStore.ResourceInfo r){
  if(r.max<=0)return DynamicBuilders.DynamicFloat.constant(0f);
  double start=r.value/r.max;
  double perSecond=r.rate/r.max;
  DynamicBuilders.DynamicInt32 seconds=DynamicBuilders.DynamicInstant
   .withSecondsPrecision(Instant.ofEpochMilli(r.timestamp))
   .durationUntil(DynamicBuilders.DynamicInstant.platformTimeWithSecondsPrecision())
   .toIntSeconds();
  DynamicBuilders.DynamicFloat raw=DynamicBuilders.DynamicFloat.constant((float)start).plus(seconds.times((float)perSecond));
  DynamicBuilders.DynamicFloat nonnegative=DynamicBuilders.DynamicFloat.onCondition(raw.lt(0f)).use(0f).elseUse(raw);
  return DynamicBuilders.DynamicFloat.onCondition(nonnegative.gt(1f)).use(1f).elseUse(nonnegative);
 }

 private DynamicBuilders.DynamicFloat dynamicValue(ComplicationStore.ResourceInfo r){
  DynamicBuilders.DynamicInt32 seconds=DynamicBuilders.DynamicInstant
   .withSecondsPrecision(Instant.ofEpochMilli(r.timestamp))
   .durationUntil(DynamicBuilders.DynamicInstant.platformTimeWithSecondsPrecision())
   .toIntSeconds();
  DynamicBuilders.DynamicFloat raw=DynamicBuilders.DynamicFloat.constant((float)r.value).plus(seconds.times((float)r.rate));
  DynamicBuilders.DynamicFloat nonnegative=DynamicBuilders.DynamicFloat.onCondition(raw.lt(0f)).use(0f).elseUse(raw);
  if(r.max>0)return DynamicBuilders.DynamicFloat.onCondition(nonnegative.gt((float)r.max)).use((float)r.max).elseUse(nonnegative);
  return nonnegative;
 }

 private DynamicBuilders.DynamicString abbreviated(DynamicBuilders.DynamicFloat v){
  DynamicBuilders.DynamicFloat.FloatFormatter one=new DynamicBuilders.DynamicFloat.FloatFormatter.Builder()
   .setMaxFractionDigits(1).setMinFractionDigits(0).setGroupingUsed(false).build();
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

 private PendingIntent tapIntent(int id){
  Intent i=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  return PendingIntent.getActivity(this,10000+id,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
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
 private static void deliver(ComplicationRequestListener l,ComplicationData d){
  try{l.onComplicationData(d);}catch(RemoteException ignored){}
 }
}
