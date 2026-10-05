package com.balthazar.kittenswear;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ResourceFullReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context context,Intent intent){
  if(intent==null||!ComplicationStore.ACTION_FULL.equals(intent.getAction()))return;
  int id=intent.getIntExtra(ComplicationStore.EXTRA_INSTANCE_ID,-1);
  if(id>=0)ComplicationStore.onFullAlarm(context,id);
 }
}
