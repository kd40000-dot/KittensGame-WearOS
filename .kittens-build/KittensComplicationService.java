package com.balthazar.kittenswear;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.Icon;
import android.os.RemoteException;
import androidx.wear.watchface.complications.data.*;
import androidx.wear.watchface.complications.datasource.*;
import androidx.wear.protolayout.expression.DynamicBuilders;
import java.time.Instant;
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
  ComplicationText dynamicText=dynamicValueText(r,text);

  if(ComplicationType.RANGED_VALUE.equals(type)){
   float fraction=r.max>0?(float)Math.max(0.0,Math.min(1.0,value/r.max)):0f;
   PlainComplicationText cd=new PlainComplicationText.Builder(desc).build();
   PlainComplicationText title=new PlainComplicationText.Builder(shortTitle(r.title)).build();
   if(r.max>0&&Double.isFinite(r.max)){
    try{
     deliver(listener,new RangedValueComplicationData.Builder(
      dynamicFraction(r),fraction,0f,1f,cd)
      .setText(dynamicText).setTitle(title).setTapAction(tap).build());
    }catch(Throwable ignored){
     deliver(listener,new RangedValueComplicationData.Builder(
      fraction,0f,1f,cd)
      .setText(dynamicText).setTitle(title).setTapAction(tap).build());
    }
   }else{
    deliver(listener,new RangedValueComplicationData.Builder(
     0f,0f,1f,cd)
     .setText(dynamicText).setTitle(title).setTapAction(tap).build());
   }
  }else if(ComplicationType.LONG_TEXT.equals(type)){
   String fallback=r.title+" "+text+(r.max>0?" / "+shortNumber(r.max):"");
   deliver(listener,new LongTextComplicationData.Builder(
    dynamicLongText(r,fallback),
    new PlainComplicationText.Builder(desc).build())
    .setTapAction(tap).build());
  }else{
   deliver(listener,new ShortTextComplicationData.Builder(
    dynamicText,
    new PlainComplicationText.Builder(desc).build())
    .setTitle(new PlainComplicationText.Builder(shortTitle(r.title)).build())
    .setTapAction(tap).build());
  }
 }

 @Override public ComplicationData getPreviewData(ComplicationType type){
  return buildStatic(type,"1.2K","Catnip","Catnip 1.2K",0);
 }

 private ComplicationText dynamicValueText(ComplicationStore.ResourceInfo r,String fallback){
  try{return new DynamicComplicationText(abbreviated(dynamicValue(r)),fallback);}
  catch(Throwable e){return new PlainComplicationText.Builder(fallback).build();}
 }
 private ComplicationText dynamicLongText(ComplicationStore.ResourceInfo r,String fallback){
  try{
   DynamicBuilders.DynamicString s=DynamicBuilders.DynamicString.constant(shortTitle(r.title)+" ").concat(abbreviated(dynamicValue(r)));
   if(r.max>0)s=s.concat(DynamicBuilders.DynamicString.constant(" / "+shortNumber(r.max)));
   return new DynamicComplicationText(s,fallback);
  }catch(Throwable e){return new PlainComplicationText.Builder(fallback).build();}
 }
 private DynamicBuilders.DynamicFloat dynamicFraction(ComplicationStore.ResourceInfo r){
  double start=r.max>0?r.value/r.max:0.0;
  double perSecond=r.max>0?r.rate/r.max:0.0;
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

 public static void requestHudUpdates(Context c){
  Class<?>[] services=new Class<?>[]{
   KittensComplicationService.class,
   HudCatnipService.class, HudWoodService.class, HudScienceService.class, HudFaithService.class,
   HudMetalsPanelService.class, HudIndustryPanelService.class, HudVillagePanelService.class, HudMythicPanelService.class,
   HudRawPanelService.class, HudRarePanelService.class, HudBottomPanelService.class
  };
  for(Class<?> cls:services){
   try{
    ComplicationDataSourceUpdateRequester.create(c,new ComponentName(c,cls)).requestUpdateAll();
   }catch(Throwable ignored){}
  }
 }

public static abstract class HudFixedResourceService extends ComplicationDataSourceService {
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
  String secondaryFallback=capped
   ?shortNumber(value)+" / "+shortNumber(r.max)
   :shortNumber(value);
  ComplicationText secondary=new PlainComplicationText.Builder(secondaryFallback).build();
  String desc=r.title+" "+fallback;
  PlainComplicationText cd=new PlainComplicationText.Builder(desc).build();
  PendingIntent tap=tapIntent(id);

  if(ComplicationType.RANGED_VALUE.equals(type)){
   DynamicBuilders.DynamicFloat dyn=capped?dynamicFraction(r):DynamicBuilders.DynamicFloat.constant(0f);
   return new RangedValueComplicationData.Builder(dyn,fraction,0f,1f,cd)
    .setText(text)
    .setTitle(secondary)
    .setTapAction(tap)
    .build();
  }
  return new ShortTextComplicationData.Builder(text,cd)
   .setTitle(secondary)
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

public static abstract class HudPanelComplicationService extends ComplicationDataSourceService {
 private static final int W=220,H=132;
 private static final int BG=Color.rgb(33,34,44);
 private static final int BORDER=Color.rgb(68,71,90);
 private static final int MUTED=Color.rgb(98,103,125);
 private static final int TEXT=Color.rgb(248,248,242);
 private static final int[] STEPS=new int[]{
  Color.rgb(255,85,85), Color.rgb(255,105,76), Color.rgb(255,128,72),
  Color.rgb(255,160,74), Color.rgb(241,250,140), Color.rgb(199,242,128),
  Color.rgb(158,238,113), Color.rgb(112,229,105), Color.rgb(80,250,123)
 };

 protected abstract String panelName();
 protected abstract String[] resourceNames();

 @Override public void onComplicationRequest(ComplicationRequest request,ComplicationRequestListener listener){
  if(!ComplicationType.SMALL_IMAGE.equals(request.getComplicationType())){
   deliver(listener,new NoDataComplicationData());
   return;
  }
  Bitmap bitmap=render(false);
  SmallImage image=new SmallImage.Builder(Icon.createWithBitmap(bitmap),SmallImageType.PHOTO).build();
  PlainComplicationText cd=new PlainComplicationText.Builder(panelName()+" Kittens resources").build();
  ComplicationData data=new SmallImageComplicationData.Builder(image,cd)
   .setTapAction(tapIntent(request.getComplicationInstanceId()))
   .build();
  deliver(listener,data);
 }

 @Override public ComplicationData getPreviewData(ComplicationType type){
  if(!ComplicationType.SMALL_IMAGE.equals(type))return null;
  Bitmap bitmap=render(true);
  SmallImage image=new SmallImage.Builder(Icon.createWithBitmap(bitmap),SmallImageType.PHOTO).build();
  return new SmallImageComplicationData.Builder(
   image,new PlainComplicationText.Builder(panelName()).build()).build();
 }

 private Bitmap render(boolean preview){
  Bitmap out=Bitmap.createBitmap(W,H,Bitmap.Config.ARGB_8888);
  Canvas c=new Canvas(out);
  c.drawColor(BG);
  Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);
  p.setStrokeWidth(2f);
  p.setStyle(Paint.Style.STROKE);
  p.setColor(BORDER);
  c.drawRoundRect(1,1,W-1,H-1,14,14,p);
  c.drawLine(W/2f,5,W/2f,H-5,p);
  c.drawLine(5,H/2f,W-5,H/2f,p);

  String[] names=resourceNames();
  for(int i=0;i<4;i++){
   int col=i%2,row=i/2;
   float x=col*(W/2f), y=row*(H/2f);
   ComplicationStore.ResourceInfo r=preview?previewInfo(names[i],i):ComplicationStore.findByName(this,names[i]);
   drawCell(c,p,x,y,W/2f,H/2f,names[i],r);
  }
  return out;
 }

 private ComplicationStore.ResourceInfo previewInfo(String name,int i){
  double max=(i%2==0)?100:0;
  double value=max>0?(20+i*24):(1200*Math.pow(10,i));
  return new ComplicationStore.ResourceInfo(name,name,value,max,0,System.currentTimeMillis());
 }

 private void drawCell(Canvas c,Paint p,float x,float y,float w,float h,String name,ComplicationStore.ResourceInfo r){
  long now=System.currentTimeMillis();
  double value=r==null?0:r.projected(now);
  double ratio=(r!=null&&r.max>0)?Math.max(0,Math.min(1,value/r.max)):-1;
  int accent=r==null?MUTED:(ratio>=0?statusColor(ratio):resourceColor(name));
  float iconX=x+22, iconY=y+22;
  drawIcon(c,p,name,iconX,iconY,14,accent);

  p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));
  p.setTextAlign(Paint.Align.LEFT);
  p.setTextSize(18f);
  p.setColor(TEXT);
  String val=r==null?"--":(ratio>=0?Math.round(ratio*100)+"%":HudFixedResourceService.shortNumber(value));
  c.drawText(val,x+43,y+28,p);

  p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.NORMAL));
  p.setTextSize(11f);
  p.setColor(accent);
  c.drawText(abbrev(name),x+8,y+h-10,p);

  if(ratio>=0){
   float left=x+8, top=y+h-6, right=x+w-8;
   p.setStyle(Paint.Style.FILL);p.setColor(BORDER);c.drawRoundRect(left,top,right,top+3,1.5f,1.5f,p);
   p.setColor(accent);c.drawRoundRect(left,top,(float)(left+(right-left)*ratio),top+3,1.5f,1.5f,p);
  }
 }

 static int statusColor(double ratio){
  int idx=(int)Math.round(Math.max(0,Math.min(1,ratio))*8.0);
  return STEPS[Math.max(0,Math.min(8,idx))];
 }

 static int resourceColor(String n){
  switch(n){
   case "minerals": return Color.rgb(189,189,189);
   case "coal": return Color.rgb(130,130,140);
   case "iron": return Color.rgb(210,210,220);
   case "titanium": return Color.rgb(139,233,253);
   case "gold": return Color.rgb(241,250,140);
   case "oil": return Color.rgb(189,147,249);
   case "uranium": return Color.rgb(80,250,123);
   case "unobtainium": return Color.rgb(255,85,85);
   case "manpower": return Color.rgb(255,184,108);
   case "culture": return Color.rgb(255,121,198);
   case "kittens": return Color.rgb(248,248,242);
   case "starchart": return Color.rgb(189,147,249);
   case "unicorns": return Color.rgb(255,121,198);
   case "alicorn": return Color.rgb(139,233,253);
   case "necrocorn": return Color.rgb(255,85,85);
   case "timeCrystal": return Color.rgb(80,250,123);
   default: return Color.rgb(191,195,213);
  }
 }

 static String abbrev(String n){
  switch(n){
   case "minerals": return "MIN";
   case "coal": return "COAL";
   case "iron": return "IRON";
   case "titanium": return "TI";
   case "gold": return "GOLD";
   case "oil": return "OIL";
   case "uranium": return "U";
   case "unobtainium": return "UNOB";
   case "manpower": return "MAN";
   case "culture": return "CUL";
   case "kittens": return "KIT";
   case "starchart": return "STAR";
   case "unicorns": return "UNI";
   case "alicorn": return "ALI";
   case "necrocorn": return "NEC";
   case "timeCrystal": return "TIME";
   default: return n.length()>4?n.substring(0,4).toUpperCase(Locale.US):n.toUpperCase(Locale.US);
  }
 }

 static void drawIcon(Canvas c,Paint p,String n,float cx,float cy,float s,int color){
  p.setColor(color);p.setStrokeWidth(2.6f);p.setStyle(Paint.Style.STROKE);p.setStrokeCap(Paint.Cap.ROUND);
  Path q=new Path();
  switch(n){
   case "minerals":
    q.moveTo(cx,cy-s);q.lineTo(cx+s,cy);q.lineTo(cx,cy+s);q.lineTo(cx-s,cy);q.close();c.drawPath(q,p);break;
   case "coal":
    p.setStyle(Paint.Style.FILL);c.drawCircle(cx,cy,s*.72f,p);break;
   case "iron":
    c.drawRoundRect(cx-s,cy-s*.55f,cx+s,cy+s*.55f,3,3,p);c.drawLine(cx-s*.65f,cy,cx+s*.65f,cy,p);break;
   case "titanium":
    q.moveTo(cx,cy-s);q.lineTo(cx+s*.8f,cy);q.lineTo(cx,cy+s);q.lineTo(cx-s*.8f,cy);q.close();c.drawPath(q,p);c.drawLine(cx,cy-s,cx,cy+s,p);break;
   case "gold":
    c.drawCircle(cx,cy,s*.82f,p);c.drawCircle(cx,cy,s*.48f,p);break;
   case "oil":
    q.moveTo(cx,cy-s);q.cubicTo(cx+s*.9f,cy-s*.05f,cx+s*.7f,cy+s,cx,cy+s);q.cubicTo(cx-s*.7f,cy+s,cx-s*.9f,cy-s*.05f,cx,cy-s);q.close();c.drawPath(q,p);break;
   case "uranium":
    c.drawCircle(cx,cy,s*.24f,p);for(int i=0;i<3;i++){double a=Math.toRadians(i*120-90);float x2=(float)(cx+Math.cos(a)*s*.9),y2=(float)(cy+Math.sin(a)*s*.9);c.drawLine(cx+(x2-cx)*.42f,cy+(y2-cy)*.42f,x2,y2,p);}break;
   case "unobtainium":
    polygon(c,p,cx,cy,s,6,-90);break;
   case "manpower":
    c.drawCircle(cx,cy-s*.48f,s*.28f,p);c.drawLine(cx,cy-s*.18f,cx,cy+s*.72f,p);c.drawLine(cx-s*.55f,cy+s*.15f,cx+s*.55f,cy+s*.15f,p);break;
   case "culture":
    c.drawLine(cx-s*.25f,cy-s*.8f,cx-s*.25f,cy+s*.5f,p);c.drawLine(cx-s*.25f,cy-s*.8f,cx+s*.7f,cy-s*.55f,p);c.drawCircle(cx-s*.48f,cy+s*.62f,s*.3f,p);break;
   case "kittens":
    q.moveTo(cx-s*.75f,cy-s*.6f);q.lineTo(cx-s*.15f,cy-s*.95f);q.lineTo(cx,cy-s*.55f);q.lineTo(cx+s*.2f,cy-s*.95f);q.lineTo(cx+s*.75f,cy-s*.58f);q.lineTo(cx+s*.65f,cy+s*.65f);q.lineTo(cx-s*.65f,cy+s*.65f);q.close();c.drawPath(q,p);c.drawCircle(cx-s*.25f,cy,s*.08f,p);c.drawCircle(cx+s*.25f,cy,s*.08f,p);break;
   case "starchart":
    star(c,p,cx,cy,s,5);break;
   case "unicorns":
    q.moveTo(cx,cy-s);q.lineTo(cx+s*.4f,cy+s*.75f);q.lineTo(cx-s*.4f,cy+s*.75f);q.close();c.drawPath(q,p);for(int i=1;i<4;i++)c.drawLine(cx-s*.25f,cy-s+i*s*.42f,cx+s*.25f,cy-s+i*s*.42f,p);break;
   case "alicorn":
    q.moveTo(cx,cy-s);q.lineTo(cx+s*.28f,cy+s*.15f);q.lineTo(cx,cy+s*.72f);q.lineTo(cx-s*.28f,cy+s*.15f);q.close();c.drawPath(q,p);c.drawLine(cx-s*.8f,cy+s*.1f,cx-s*.28f,cy+s*.25f,p);c.drawLine(cx+s*.8f,cy+s*.1f,cx+s*.28f,cy+s*.25f,p);break;
   case "necrocorn":
    q.moveTo(cx,cy-s);q.lineTo(cx+s*.5f,cy+s*.82f);q.lineTo(cx-s*.5f,cy+s*.82f);q.close();c.drawPath(q,p);c.drawLine(cx-s*.42f,cy+s*.2f,cx+s*.42f,cy+s*.2f,p);break;
   case "timeCrystal":
    q.moveTo(cx,cy-s);q.lineTo(cx+s*.72f,cy-s*.25f);q.lineTo(cx+s*.45f,cy+s*.8f);q.lineTo(cx-s*.45f,cy+s*.8f);q.lineTo(cx-s*.72f,cy-s*.25f);q.close();c.drawPath(q,p);c.drawLine(cx,cy-s,cx,cy+s*.8f,p);break;
   default:
    c.drawCircle(cx,cy,s*.7f,p);
  }
 }

 private static void polygon(Canvas c,Paint p,float cx,float cy,float r,int n,float offsetDeg){
  Path path=new Path();
  for(int i=0;i<n;i++){double a=Math.toRadians(offsetDeg+i*360.0/n);float x=(float)(cx+Math.cos(a)*r),y=(float)(cy+Math.sin(a)*r);if(i==0)path.moveTo(x,y);else path.lineTo(x,y);}
  path.close();c.drawPath(path,p);
 }

 private static void star(Canvas c,Paint p,float cx,float cy,float r,int n){
  Path path=new Path();
  for(int i=0;i<n*2;i++){double a=Math.toRadians(-90+i*180.0/n);float rr=(i%2==0)?r:r*.42f;float x=(float)(cx+Math.cos(a)*rr),y=(float)(cy+Math.sin(a)*rr);if(i==0)path.moveTo(x,y);else path.lineTo(x,y);}
  path.close();c.drawPath(path,p);
 }

 private PendingIntent tapIntent(int id){
  Intent i=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  return PendingIntent.getActivity(this,20000+id,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 }

 private static void deliver(ComplicationRequestListener l,ComplicationData d){
  try{l.onComplicationData(d);}catch(RemoteException ignored){}
 }
}

public static class HudCatnipService extends HudFixedResourceService { @Override protected String resourceName(){return "catnip";} }

public static class HudWoodService extends HudFixedResourceService { @Override protected String resourceName(){return "wood";} }

public static class HudScienceService extends HudFixedResourceService { @Override protected String resourceName(){return "science";} }

public static class HudFaithService extends HudFixedResourceService { @Override protected String resourceName(){return "faith";} }

public static class HudMetalsPanelService extends HudPanelComplicationService { @Override protected String panelName(){return "Metals";} @Override protected String[] resourceNames(){return new String[]{"minerals","coal","iron","titanium"};} }

public static class HudIndustryPanelService extends HudPanelComplicationService { @Override protected String panelName(){return "Industry";} @Override protected String[] resourceNames(){return new String[]{"gold","oil","uranium","unobtainium"};} }

public static class HudVillagePanelService extends HudPanelComplicationService { @Override protected String panelName(){return "Village";} @Override protected String[] resourceNames(){return new String[]{"manpower","culture","kittens","starchart"};} }

public static class HudMythicPanelService extends HudPanelComplicationService { @Override protected String panelName(){return "Mythic";} @Override protected String[] resourceNames(){return new String[]{"unicorns","alicorn","necrocorn","timeCrystal"};} }

public static abstract class HudListPanelService extends ComplicationDataSourceService {
 private static final int W=320,H=300;
 private static final int BG=Color.rgb(7,18,18);
 private static final int BORDER=Color.rgb(0,255,200);
 private static final int TEXT=Color.rgb(213,255,244);
 protected abstract String panelName();
 protected abstract String[] resources();

 @Override public void onComplicationRequest(ComplicationRequest request,ComplicationRequestListener listener){
  if(!ComplicationType.SMALL_IMAGE.equals(request.getComplicationType())){deliver(listener,new NoDataComplicationData());return;}
  Bitmap b=render(false);
  SmallImage img=new SmallImage.Builder(Icon.createWithBitmap(b),SmallImageType.PHOTO).build();
  deliver(listener,new SmallImageComplicationData.Builder(img,new PlainComplicationText.Builder(panelName()).build()).setTapAction(tap(request.getComplicationInstanceId())).build());
 }
 @Override public ComplicationData getPreviewData(ComplicationType type){
  if(!ComplicationType.SMALL_IMAGE.equals(type))return null;
  SmallImage img=new SmallImage.Builder(Icon.createWithBitmap(render(true)),SmallImageType.PHOTO).build();
  return new SmallImageComplicationData.Builder(img,new PlainComplicationText.Builder(panelName()).build()).build();
 }
 private Bitmap render(boolean preview){
  Bitmap out=Bitmap.createBitmap(W,H,Bitmap.Config.ARGB_8888);
  Canvas c=new Canvas(out);c.drawColor(BG);
  Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setStrokeCap(Paint.Cap.ROUND);
  p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(3);p.setColor(BORDER);c.drawRoundRect(2,2,W-2,H-2,18,18,p);
  p.setStyle(Paint.Style.FILL);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(30);p.setColor(TEXT);p.setTextAlign(Paint.Align.LEFT);
  c.drawText(panelName(),18,38,p);
  c.drawRect(18,48,W-18,51,p);
  String[] ns=resources();
  for(int i=0;i<3;i++){
   float cy=92+i*68;
   ComplicationStore.ResourceInfo r=preview
    ?new ComplicationStore.ResourceInfo(ns[i],ns[i],(i+1)*1234,(i+1)*2400,0,System.currentTimeMillis())
    :ComplicationStore.findByName(this,ns[i]);
   double value=r==null?0:r.projected(System.currentTimeMillis());
   double ratio=(r!=null&&r.max>0)?Math.max(0,Math.min(1,value/r.max)):-1;
   int accent=r==null?Color.rgb(90,100,105):(ratio>=0?HudPanelComplicationService.statusColor(ratio):HudPanelComplicationService.resourceColor(ns[i]));
   HudPanelComplicationService.drawIcon(c,p,ns[i],32,cy-9,17,accent);
   p.setStyle(Paint.Style.FILL);p.setTextAlign(Paint.Align.LEFT);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(22);p.setColor(TEXT);
   c.drawText(HudPanelComplicationService.abbrev(ns[i]),58,cy-3,p);
   p.setTextAlign(Paint.Align.RIGHT);p.setTextSize(29);
   c.drawText(r==null?"--":HudFixedResourceService.shortNumber(value),W-18,cy-3,p);
   float l=58,t=cy+10,rr=W-18;
   p.setColor(Color.rgb(25,60,60));c.drawRoundRect(l,t,rr,t+10,5,5,p);
   if(ratio>=0){p.setColor(accent);c.drawRoundRect(l,t,(float)(l+(rr-l)*ratio),t+10,5,5,p);}
   p.setColor(Color.rgb(0,105,100));c.drawRect(18,cy+31,W-18,cy+33,p);
  }
  return out;
 }
 private PendingIntent tap(int id){
  Intent i=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  return PendingIntent.getActivity(this,30000+id,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 }
 private static void deliver(ComplicationRequestListener l,ComplicationData d){try{l.onComplicationData(d);}catch(RemoteException ignored){}}
}

public static class HudRawPanelService extends HudListPanelService {
 @Override protected String panelName(){return "RAW";}
 @Override protected String[] resources(){return new String[]{"minerals","coal","iron"};}
}
public static class HudRarePanelService extends HudListPanelService {
 @Override protected String panelName(){return "RARE";}
 @Override protected String[] resources(){return new String[]{"gold","oil","uranium"};}
}

public static class HudBottomPanelService extends ComplicationDataSourceService {
 private static final int W=720,H=250;
 private static final int BG=Color.rgb(7,18,18);
 private static final int BORDER=Color.rgb(0,255,200);
 private static final int TEXT=Color.rgb(213,255,244);
 private static final String[] NAMES=new String[]{"manpower","culture","unicorns"};

 @Override public void onComplicationRequest(ComplicationRequest request,ComplicationRequestListener listener){
  if(!ComplicationType.SMALL_IMAGE.equals(request.getComplicationType())){deliver(listener,new NoDataComplicationData());return;}
  SmallImage img=new SmallImage.Builder(Icon.createWithBitmap(render(false)),SmallImageType.PHOTO).build();
  deliver(listener,new SmallImageComplicationData.Builder(img,new PlainComplicationText.Builder("Iron Will resources").build()).setTapAction(tap(request.getComplicationInstanceId())).build());
 }
 @Override public ComplicationData getPreviewData(ComplicationType type){
  if(!ComplicationType.SMALL_IMAGE.equals(type))return null;
  SmallImage img=new SmallImage.Builder(Icon.createWithBitmap(render(true)),SmallImageType.PHOTO).build();
  return new SmallImageComplicationData.Builder(img,new PlainComplicationText.Builder("Iron Will resources").build()).build();
 }

 private Bitmap render(boolean preview){
  Bitmap out=Bitmap.createBitmap(W,H,Bitmap.Config.ARGB_8888);
  Canvas c=new Canvas(out);c.drawColor(BG);
  Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setStrokeCap(Paint.Cap.ROUND);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));
  for(int i=0;i<3;i++){
   float cx=120+i*240,cy=124,radius=96;
   ComplicationStore.ResourceInfo r=preview
    ?new ComplicationStore.ResourceInfo(NAMES[i],NAMES[i],new double[]{12600,3200,12}[i],new double[]{18000,5000,25}[i],0,System.currentTimeMillis())
    :ComplicationStore.findByName(this,NAMES[i]);
   double value=r==null?0:r.projected(System.currentTimeMillis());
   double ratio=(r!=null&&r.max>0)?Math.max(0,Math.min(1,value/r.max)):-1;
   int accent=r==null?Color.rgb(90,100,105):(ratio>=0?HudPanelComplicationService.statusColor(ratio):HudPanelComplicationService.resourceColor(NAMES[i]));
   p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(14);
   for(int s=0;s<8;s++){
    float start=-150+s*37.5f;
    p.setColor(Color.rgb(25,60,60));c.drawArc(cx-radius,cy-radius,cx+radius,cy+radius,start,28,false,p);
    if(ratio<0 || s<Math.round(ratio*8)){p.setColor(accent);c.drawArc(cx-radius,cy-radius,cx+radius,cy+radius,start,28,false,p);}
   }
   HudPanelComplicationService.drawIcon(c,p,NAMES[i],cx,cy-42,24,accent);
   p.setStyle(Paint.Style.FILL);p.setTextAlign(Paint.Align.CENTER);p.setColor(TEXT);p.setTextSize(25);c.drawText(label(NAMES[i]),cx,cy+2,p);
   p.setTextSize(43);c.drawText(r==null?"--":HudFixedResourceService.shortNumber(value),cx,cy+50,p);
   p.setTextSize(20);p.setColor(accent);
   String max=(r!=null&&r.max>0)?"/ "+HudFixedResourceService.shortNumber(r.max):"";
   c.drawText(max,cx,cy+78,p);
  }
  return out;
 }
 private static String label(String n){if("manpower".equals(n))return "MANPOWER";if("culture".equals(n))return "CULTURE";return "UNICORNS";}
 private PendingIntent tap(int id){
  Intent i=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  return PendingIntent.getActivity(this,31000+id,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 }
 private static void deliver(ComplicationRequestListener l,ComplicationData d){try{l.onComplicationData(d);}catch(RemoteException ignored){}}
}
}