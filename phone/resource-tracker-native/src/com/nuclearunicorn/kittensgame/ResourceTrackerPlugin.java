package com.nuclearunicorn.kittensgame;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PluginMethod;

@CapacitorPlugin(name = "KittensResourceTracker")
public class ResourceTrackerPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        try {
            Context c = getContext();
            ResourceTrackerService.writeSnapshot(
                c,
                true,
                value(call.getString("name"), "catnip"),
                value(call.getString("title"), value(call.getString("name"), "Catnip")),
                number(call, "value"),
                number(call, "max"),
                number(call, "rate")
            );
            ResourceTrackerService.start(c);
            call.resolve();
        } catch (Throwable e) {
            call.reject("Could not start resource tracker: " + e.getMessage());
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        try {
            Context c = getContext();
            if (!ResourceTrackerService.isEnabled(c)) {
                call.resolve();
                return;
            }
            ResourceTrackerService.writeSnapshot(
                c,
                true,
                value(call.getString("name"), ResourceTrackerService.getName(c)),
                value(call.getString("title"), ResourceTrackerService.getTitle(c)),
                number(call, "value"),
                number(call, "max"),
                number(call, "rate")
            );
            ResourceTrackerService.start(c);
            call.resolve();
        } catch (Throwable e) {
            call.reject("Could not update resource tracker: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            ResourceTrackerService.disable(getContext());
            call.resolve();
        } catch (Throwable e) {
            call.reject("Could not stop resource tracker: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openLiveUpdateSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 36) {
                Intent i = new Intent("android.settings.MANAGE_APP_PROMOTED_NOTIFICATIONS");
                i.setData(Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } else {
                Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
            call.resolve();
        } catch (Throwable e) {
            call.reject("Could not open notification settings: " + e.getMessage());
        }
    }

    private static String value(String v, String fallback) {
        return v == null || v.trim().isEmpty() ? fallback : v;
    }

    private static double number(PluginCall call, String key) {
        Double v = call.getDouble(key);
        return v == null || !Double.isFinite(v) ? 0.0 : v;
    }
}
