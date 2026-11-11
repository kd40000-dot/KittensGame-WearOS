package com.nuclearunicorn.kittensgame;

import android.content.Context;
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

    public ResourceTrackerDirectBridge(Context context) {
        this.context = context;
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
