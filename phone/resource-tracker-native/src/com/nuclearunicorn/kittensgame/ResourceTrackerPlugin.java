package com.nuclearunicorn.kittensgame;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSObject;
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
            boolean rootGranted=false;
            if (Build.VERSION.SDK_INT >= 36 && !canPostPromoted(c)) {
                rootGranted=tryRootGrant(c);
            }
            ResourceTrackerService.start(c);
            if (Build.VERSION.SDK_INT >= 36 && !canPostPromoted(c) && !rootGranted) {
                openPromotedSettings(c);
            }
            JSObject out=new JSObject();
            out.put("rootGrantAttempted", Build.VERSION.SDK_INT >= 36);
            out.put("rootGrantSucceeded", rootGranted);
            out.put("canPostPromoted", Build.VERSION.SDK_INT < 36 || canPostPromoted(c));
            call.resolve(out);
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
    public void status(PluginCall call) {
        try {
            Context c=getContext();
            JSObject out=new JSObject();
            out.put("enabled", ResourceTrackerService.isEnabled(c));
            out.put("sdk", Build.VERSION.SDK_INT);
            out.put("canPostPromoted", Build.VERSION.SDK_INT < 36 || canPostPromoted(c));
            out.put("lastPromotable", c.getSharedPreferences(ResourceTrackerService.PREFS, Context.MODE_PRIVATE).getBoolean("last_promotable", false));
            out.put("activePromoted", ResourceTrackerService.isActiveNotificationPromoted(c));
            out.put("activeFound", ResourceTrackerService.isActiveNotificationPresent(c));
            out.put("channelImportance", ResourceTrackerService.channelImportance(c));
            call.resolve(out);
        } catch (Throwable e) {
            call.reject("Could not read resource tracker status: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openLiveUpdateSettings(PluginCall call) {
        try {
            openPromotedSettings(getContext());
            call.resolve();
        } catch (Throwable e) {
            call.reject("Could not open notification settings: " + e.getMessage());
        }
    }

    private static boolean tryRootGrant(Context c) {
        try {
            String pkg=c.getPackageName();
            String cmd="appops set --uid " + pkg + " android:post_promoted_notifications allow";
            Process proc=new ProcessBuilder("su","-c",cmd).redirectErrorStream(true).start();
            boolean finished=proc.waitFor(4, java.util.concurrent.TimeUnit.SECONDS);
            if(!finished){proc.destroy();return false;}
            // Give PermissionManager/AppOps a moment to observe the uid-mode change.
            try{Thread.sleep(180);}catch(InterruptedException ignored){}
            return proc.exitValue()==0 && canPostPromoted(c);
        } catch(Throwable e) {
            return false;
        }
    }

    private static boolean canPostPromoted(Context c) {
        try {
            Object nm=c.getSystemService(Context.NOTIFICATION_SERVICE);
            java.lang.reflect.Method m=nm.getClass().getMethod("canPostPromotedNotifications");
            Object result=m.invoke(nm);
            return result instanceof Boolean && (Boolean)result;
        } catch (Throwable e) {
            return false;
        }
    }

    private static void openPromotedSettings(Context c) {
        if (Build.VERSION.SDK_INT >= 36) {
            Intent i = new Intent("android.settings.MANAGE_APP_PROMOTED_NOTIFICATIONS");
            i.setData(Uri.parse("package:" + c.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } else {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
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
