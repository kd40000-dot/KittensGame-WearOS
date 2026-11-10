package com.nuclearunicorn.kittensgame;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.os.*;
import java.lang.reflect.Method;
import java.util.Locale;

public class ResourceTrackerService extends Service {
    static final String PREFS = "kittens_resource_tracker";
    static final String CHANNEL = "kittens_resource_tracker_live_v2";
    static final int NOTIFICATION_ID = 41617;
    static final int DRACULA_PURPLE = Color.rgb(189, 147, 249);
    static final int DRACULA_GREEN = Color.rgb(80, 250, 123);
    private static volatile boolean running = false;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!isEnabled(ResourceTrackerService.this)) {
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
                return;
            }
            updateNotification(false);
            handler.postDelayed(this, 1000L);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        running = true;
        createChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isEnabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = buildNotification();
        startForeground(NOTIFICATION_ID, n);
        handler.removeCallbacks(tick);
        handler.postDelayed(tick, 1000L);
        return START_STICKY;
    }

    @Override public void onDestroy() {
        running = false;
        handler.removeCallbacks(tick);
        super.onDestroy();
    }

    @Override public android.os.IBinder onBind(Intent intent) { return null; }

    static void start(Context c) {
        if (running) return;
        Intent i = new Intent(c, ResourceTrackerService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static void disable(Context c) {
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("enabled", false).apply();
        try { c.stopService(new Intent(c, ResourceTrackerService.class)); } catch (Throwable ignored) {}
        try {
            NotificationManager nm = (NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIFICATION_ID);
        } catch (Throwable ignored) {}
    }

    static boolean isEnabled(Context c) {
        return c.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("enabled", false);
    }

    static String getName(Context c) {
        return c.getSharedPreferences(PREFS, MODE_PRIVATE).getString("name", "catnip");
    }

    static String getTitle(Context c) {
        return c.getSharedPreferences(PREFS, MODE_PRIVATE).getString("title", "Catnip");
    }

    static void writeSnapshot(Context c, boolean enabled, String name, String title, double value, double max, double rate) {
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled)
            .putString("name", name)
            .putString("title", title)
            .putLong("value", Double.doubleToRawLongBits(value))
            .putLong("max", Double.doubleToRawLongBits(max))
            .putLong("rate", Double.doubleToRawLongBits(rate))
            .putLong("at", System.currentTimeMillis())
            .apply();
    }

    private static double readDouble(SharedPreferences p, String key) {
        return Double.longBitsToDouble(p.getLong(key, Double.doubleToRawLongBits(0.0)));
    }

    private void updateNotification(boolean forceForeground) {
        Notification n = buildNotification();
        if (forceForeground) startForeground(NOTIFICATION_ID, n);
        else {
            NotificationManager nm = (NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFICATION_ID, n);
        }
    }

    private Notification buildNotification() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String title = p.getString("title", p.getString("name", "Resource"));
        double base = readDouble(p, "value");
        double max = readDouble(p, "max");
        double rate = readDouble(p, "rate");
        long at = p.getLong("at", System.currentTimeMillis());
        double elapsed = Math.max(0.0, (System.currentTimeMillis() - at) / 1000.0);
        double value = base + rate * elapsed;
        if (max > 0) value = Math.min(max, value);
        value = Math.max(0.0, value);

        boolean full = max > 0 && value >= max - Math.max(1e-9, max * 1e-9);
        String chip = shortNumber(value);
        String amount = max > 0 ? chip + " / " + shortNumber(max) : chip;
        String rateText = rate == 0 ? "Tracking Kittens Game resource" : signed(rate) + "/s";

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content = null;
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            content = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);

        b.setSmallIcon(getApplicationInfo().icon)
         .setContentTitle(title + " · " + amount)
         .setContentText(rateText)
         .setOngoing(true)
         .setOnlyAlertOnce(true)
         .setAutoCancel(false)
         .setShowWhen(false)
         .setCategory(Notification.CATEGORY_PROGRESS)
         .setVisibility(Notification.VISIBILITY_PUBLIC)
         .setColor(full ? DRACULA_GREEN : DRACULA_PURPLE);

        if (content != null) b.setContentIntent(content);

        int progress = max > 0
            ? (int)Math.round(Math.max(0.0, Math.min(1.0, value / max)) * 1000.0)
            : 0;

        if (max > 0) b.setProgress(1000, progress, false);
        else b.setProgress(0, 0, true);

        if (Build.VERSION.SDK_INT >= 36) {
            // Use the Android 16 progress-centric template used for Live Updates.
            try {
                Notification.ProgressStyle ps = new Notification.ProgressStyle()
                    .setStyledByProgress(true)
                    .setProgress(progress);
                b.setStyle(ps);
            } catch (Throwable ignored) {}

            try { b.setShortCriticalText(chip); }
            catch (Throwable ignored) {
                try { b.getExtras().putString("android.shortCriticalText", chip); } catch (Throwable ignored2) {}
            }

            // The request API arrived in Android 16's promoted-notification update.
            // Set the public extra unconditionally as the compatibility path, then
            // use the direct builder method when it exists on this framework.
            try { b.getExtras().putBoolean("android.requestPromotedOngoing", true); } catch (Throwable ignored) {}
            try {
                Method m = Notification.Builder.class.getMethod("setRequestPromotedOngoing", boolean.class);
                m.invoke(b, true);
            } catch (Throwable ignored) {}
        }

        Notification built=b.build();
        if (Build.VERSION.SDK_INT >= 36) {
            try {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putBoolean("last_promotable", built.hasPromotableCharacteristics())
                    .apply();
            } catch (Throwable ignored) {}
        }
        return built;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Kittens resource tracker", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Shows a selected Kittens Game resource as a live status-bar update.");
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.enableLights(false);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private static String signed(double v) {
        String s = shortNumber(Math.abs(v));
        return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
    }

    static String shortNumber(double v) {
        if (!Double.isFinite(v)) return "∞";
        double a = Math.abs(v);
        String suffix = "";
        double scaled = v;
        if (a >= 1e15) { scaled = v / 1e15; suffix = "Q"; }
        else if (a >= 1e12) { scaled = v / 1e12; suffix = "T"; }
        else if (a >= 1e9) { scaled = v / 1e9; suffix = "B"; }
        else if (a >= 1e6) { scaled = v / 1e6; suffix = "M"; }
        else if (a >= 1e3) { scaled = v / 1e3; suffix = "K"; }

        String number;
        double absScaled = Math.abs(scaled);
        if (suffix.isEmpty()) {
            if (absScaled >= 100) number = String.format(Locale.US, "%.0f", scaled);
            else if (absScaled >= 10) number = trim(String.format(Locale.US, "%.1f", scaled));
            else number = trim(String.format(Locale.US, "%.2f", scaled));
        } else {
            if (absScaled >= 100) number = String.format(Locale.US, "%.0f", scaled);
            else if (absScaled >= 10) number = trim(String.format(Locale.US, "%.1f", scaled));
            else number = trim(String.format(Locale.US, "%.2f", scaled));
        }
        String out = number + suffix;
        if (out.length() <= 7) return out;
        return trim(String.format(Locale.US, "%.1e", v)).replace("e+","e");
    }

    private static String trim(String s) {
        if (s.indexOf('.') >= 0) {
            while (s.endsWith("0")) s = s.substring(0, s.length() - 1);
            if (s.endsWith(".")) s = s.substring(0, s.length() - 1);
        }
        return s;
    }
}
