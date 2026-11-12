package ru.oni.plrstudio;

import android.webkit.JavascriptInterface;

public class OniJsBridge {
    private final MainActivity activity;

    public OniJsBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isNativeAndroid() {
        return true;
    }

    @JavascriptInterface
    public void saveFile(final String filename, final String mimeType, final String content, final boolean isBase64) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.requestSaveFile(filename, mimeType, content, isBase64);
            }
        });
    }

    @JavascriptInterface
    public void toggleFullscreen() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.toggleImmersiveFullscreen();
            }
        });
    }

    @JavascriptInterface
    public void showToast(final String message) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.showNativeToast(message);
            }
        });
    }
}
