package com.balthazar.kittenswear;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService;
import java.util.List;

public class ComplicationConfigActivity extends Activity {
 private static final int PAD=18;
 private int complicationId=-1;

 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  setResult(RESULT_CANCELED);
  complicationId=getIntent().getIntExtra(ComplicationDataSourceService.EXTRA_CONFIG_COMPLICATION_ID,-1);
  render();
 }

 private TextView text(String s,int sp){
  TextView v=new TextView(this);
  v.setText(s);v.setTextColor(Color.rgb(248,248,242));v.setTextSize(sp);
  v.setPadding(PAD,8,PAD,8);return v;
 }
 private Button button(String s){
  Button b=new Button(this);
  b.setText(s);b.setAllCaps(false);
  b.setTextColor(Color.rgb(248,248,242));
  b.setBackgroundColor(Color.rgb(52,55,70));
  LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
  lp.setMargins(PAD,6,PAD,6);b.setLayoutParams(lp);
  return b;
 }

 private void render(){
  ScrollView scroll=new ScrollView(this);
  scroll.setBackgroundColor(Color.rgb(40,42,54));
  LinearLayout root=new LinearLayout(this);
  root.setOrientation(LinearLayout.VERTICAL);
  root.setPadding(0,20,0,40);
  scroll.addView(root,new ScrollView.LayoutParams(-1,-2));

  TextView title=text(complicationId>=0?"Choose resource for this slot":"Kittens complications",20);
  title.setTextColor(Color.rgb(189,147,249));
  title.setGravity(Gravity.CENTER_HORIZONTAL);
  root.addView(title);

  if(complicationId<0){
   root.addView(text("Each complication slot can now show a different Kittens Game resource. Open your watch-face editor, choose a complication slot, select “Kittens resource”, then pick the resource for that slot. Repeat for as many slots as your watch face supports.",14));
   List<ComplicationStore.ResourceInfo> resources=ComplicationStore.resources(this);
   if(resources.isEmpty())root.addView(text("Open Kittens Wear for a few seconds first so the app can capture the current resource list.",13));
   else root.addView(text("Resource snapshot is ready: "+resources.size()+" resources available.",13));
   Button close=button("Close");close.setOnClickListener(v->{setResult(RESULT_CANCELED);finish();});root.addView(close);
   setContentView(scroll);return;
  }

  String current=ComplicationStore.selected(this,complicationId);
  CheckBox vibrate=new CheckBox(this);
  vibrate.setText("Vibrate when this resource reaches capacity");
  vibrate.setTextColor(Color.rgb(191,195,213));
  vibrate.setChecked(ComplicationStore.vibrateEnabled(this,complicationId));
  vibrate.setPadding(PAD,10,PAD,10);
  root.addView(vibrate);

  List<ComplicationStore.ResourceInfo> resources=ComplicationStore.resources(this);
  if(resources.isEmpty()){
   root.addView(text("No game resource snapshot yet. Open Kittens Wear, wait a few seconds, then configure this slot again.",14));
   Button catnip=button("Use Catnip for now");
   catnip.setOnClickListener(v->finishWith("catnip",vibrate.isChecked()));
   root.addView(catnip);
  }else{
   root.addView(text("This choice applies only to this watch-face slot. Other Kittens complications keep their own resources.",13));
   for(ComplicationStore.ResourceInfo r:resources){
    String label=(r.name.equals(current)?"✓ ":"")+r.title+"   "+KittensComplicationService.shortNumber(r.projected(System.currentTimeMillis()));
    Button b=button(label);
    b.setOnClickListener(v->finishWith(r.name,vibrate.isChecked()));
    root.addView(b);
   }
  }
  setContentView(scroll);
 }

 private void finishWith(String resource,boolean vibrate){
  ComplicationStore.configure(this,complicationId,resource,vibrate);
  Intent out=new Intent();
  out.putExtra(ComplicationDataSourceService.EXTRA_CONFIG_COMPLICATION_ID,complicationId);
  setResult(RESULT_OK,out);
  finish();
 }
}
