package com.nuclearunicorn.kittensgame;

import android.content.Context;
import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.os.Handler;
import android.os.Looper;
import java.lang.ref.WeakReference;
import android.os.Build;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;

/**
 * Minimal WebView bridge for resource tracker. Install on MainActivity's
 * Capacitor WebView using addJavascriptInterface(new
 * ResourceTrackerDirectBridge(this), "kittensTrackerBridge").
 * Synchronous String/JSON calls deliberately bypass Capacitor's message
 * callback registry, which timed out without delivering a native response.
 */
public final class ResourceTrackerDirectBridge {
    private final Context context;
    private static volatile WeakReference<Activity> activityRef = new WeakReference<>(null);

    public ResourceTrackerDirectBridge(Context context) {
        this.context = context;
        if (context instanceof Activity) activityRef = new WeakReference<>((Activity) context);
    }

    // Called by the ongoing native tracker when a queued purchase becomes
    // affordable. Does not launch an Activity or display the app.
    static boolean requestBackgroundQueuePass() {
        final Activity activity = activityRef.get();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return false;
        activity.runOnUiThread(() -> {
            try {
                WebView webView = findWebView(activity.getWindow().getDecorView());
                if (webView != null) webView.evaluateJavascript(
                    "window.KittensBackgroundQueue&&window.KittensBackgroundQueue.runIfDue('native');", null);
            } catch (Throwable error) {
                android.util.Log.w("KittensBackgroundQueue", "Background WebView dispatch failed", error);
            }
        });
        return true;
    }

    private static WebView findWebView(View root) {
        if (root instanceof WebView) return (WebView) root;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView result = findWebView(group.getChildAt(i));
                if (result != null) return result;
            }
        }
        return null;
    }

    @JavascriptInterface
    public String setQueueSnapshot(String json) {
        try {
            // This field is intentionally independent of the displayed resource.
            // It is written by the game and used only as a trigger estimate.
            new JSONObject(json);
            context.getSharedPreferences(ResourceTrackerService.PREFS, Context.MODE_PRIVATE)
                .edit().putString("queue_snapshot", json).apply();
            return "{\\"ok\\":true}";
        } catch (Throwable error) { return error(error); }
    }

    @JavascriptInterface
    public String start(String json) {
        try {
            JSONObject data = new JSONObject(json);
            String name = data.optString("name", "catnip");
            String title = data.optString("title", name);
            ResourceTrackerService.writeSnapshot(context, true, name, title,
                    data.optDouble("value"), data.optDouble("max"), data.optDouble("rate"));
            ResourceTrackerService.start(context);
            return "{\"ok\":true}";
        } catch (Throwable error) {
            return error(error);
        }
    }

    @JavascriptInterface
    public String update(String json) {
        return start(json);
    }

    @JavascriptInterface
    public String stop() {
        try {
            ResourceTrackerService.disable(context);
            return "{\"ok\":true}";
        } catch (Throwable error) {
            return error(error);
        }
    }

    @JavascriptInterface
    public String status() {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("enabled", ResourceTrackerService.isEnabled(context));
            result.put("activeFound", ResourceTrackerService.isActiveNotificationPresent(context));
            result.put("channelImportance", ResourceTrackerService.channelImportance(context));
            result.put("sdk", Build.VERSION.SDK_INT);
            return result.toString();
        } catch (Throwable error) {
            return error(error);
        }
    }

    private static String error(Throwable error) {
        try {
            return new JSONObject().put("ok", false).put("error", error.toString()).toString();
        } catch (Throwable ignored) {
            return "{\"ok\":false,\"error\":\"Native error serialization failed\"}";
        }
    }
}
