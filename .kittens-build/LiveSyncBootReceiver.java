package com.balthazar.kittenswear;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class LiveSyncBootReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context context,Intent intent){
  if(ComplicationLiveSync.configured(context))ComplicationLiveSync.startObserver(context);
 }
}
