package com.balthazar.kittenswear;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.*;
import android.graphics.drawable.Icon;
import android.os.RemoteException;
import androidx.wear.watchface.complications.data.*;
import androidx.wear.watchface.complications.datasource.*;
import java.util.Locale;

public abstract class HudPanelComplicationService extends ComplicationDataSourceService {
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

 private static int statusColor(double ratio){
  int idx=(int)Math.round(Math.max(0,Math.min(1,ratio))*8.0);
  return STEPS[Math.max(0,Math.min(8,idx))];
 }

 private static int resourceColor(String n){
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

 private static String abbrev(String n){
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

 private static void drawIcon(Canvas c,Paint p,String n,float cx,float cy,float s,int color){
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
