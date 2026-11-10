package com.nuclearunicorn.kittensgame;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ResourceTrackerBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        try {
            if (ResourceTrackerService.isEnabled(context)) ResourceTrackerService.start(context);
        } catch (Throwable ignored) {}
    }
}
