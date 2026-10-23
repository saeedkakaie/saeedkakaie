/*
 * نسخه اندروید برنامه IBP گروه زر.
 *
 * برنامه (پوشه app) داخل فایل APK است و بدون اینترنت اجرا می‌شود. فایل‌ها از نشانی امن
 * https://appassets.androidplatform.net/app/ به WebView داده می‌شوند تا پایگاه داده محلی (IndexedDB)
 * مثل مرورگر کار کند. داده‌ها روی همین گوشی می‌مانند.
 *
 *   ذخیره فایل   خروجی‌های Excel و پشتیبان از طریق پل IBPAndroid در Downloads/Zar IBP ذخیره و قابل باز کردن/اشتراک هستند
 *   ورود فایل    انتخاب فایل (Excel یا پشتیبان) با انتخابگر فایل اندروید
 *   بازگشت       دکمه بازگشت گوشی صفحه قبلی برنامه را نشان می‌دهد
 */
package ir.zargroup.ibp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/app/index.html";
    private static final int PICK_FILE = 41;
    private static final Map<String, String> MIME = new HashMap<String, String>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff2", "font/woff2");
        MIME.put("woff", "font/woff");
        MIME.put("ttf", "font/ttf");
        MIME.put("txt", "text/plain");
        MIME.put("md", "text/plain");
    }

    private WebView web;
    private ValueCallback<Uri[]> pendingPick;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        // اتصال اختیاری به موتور تحلیل پایتون روی شبکه داخلی (http) از صفحه https برنامه
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        web.addJavascriptInterface(new Bridge(), "IBPAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                return asset(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // پیوندهای بیرونی در مرورگر گوشی باز می‌شوند
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException e) { /* بی‌اثر */ }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingPick != null) pendingPick.onReceiveValue(null);
                pendingPick = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "انتخاب فایل"), PICK_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    pendingPick = null;
                    return false;
                }
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(START);
    }

    /** پاسخ به درخواست فایل‌های برنامه از پوشه assets */
    private WebResourceResponse asset(String path) {
        if (path == null) path = "/";
        String p = path.startsWith("/") ? path.substring(1) : path;
        if (p.isEmpty() || p.endsWith("/")) p = p + "index.html";
        if (p.contains("..")) return notFound();
        int dot = p.lastIndexOf('.');
        String ext = dot >= 0 ? p.substring(dot + 1).toLowerCase() : "";
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        try {
            InputStream in = getAssets().open(p);
            WebResourceResponse r = new WebResourceResponse(mime, mime.startsWith("text/") || ext.equals("js") || ext.equals("json") ? "utf-8" : null, in);
            Map<String, String> h = new HashMap<String, String>();
            h.put("Cache-Control", "no-cache");
            r.setResponseHeaders(h);
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK_FILE && pendingPick != null) {
            pendingPick.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingPick = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    /** پل محدود صفحه برنامه با اندروید */
    private class Bridge {
        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            final String fileName = (name == null || name.trim().isEmpty() ? "IBP" : name).replaceAll("[\\\\/:*?\"<>|]", "_");
            final String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
            final Uri uri;
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                ContentResolver cr = getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Zar IBP");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IOException("insert failed");
                OutputStream out = cr.openOutputStream(uri);
                if (out == null) throw new IOException("open failed");
                try { out.write(data); } finally { out.close(); }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, done, null, null);
            } catch (Exception e) {
                runOnUiThread(new Runnable() {
                    public void run() { Toast.makeText(MainActivity.this, "ذخیره فایل ناموفق بود: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
                });
                return;
            }
            runOnUiThread(new Runnable() {
                public void run() { offer(fileName, type, uri); }
            });
        }
    }

    /** پس از ذخیره: باز کردن یا اشتراک‌گذاری فایل */
    private void offer(String fileName, final String type, final Uri uri) {
        new AlertDialog.Builder(this)
            .setTitle("فایل ذخیره شد")
            .setMessage("Downloads/Zar IBP/" + fileName)
            .setPositiveButton("باز کردن", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int w) {
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(uri, type);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivity(i); } catch (ActivityNotFoundException e) { Toast.makeText(MainActivity.this, "برنامه‌ای برای باز کردن این فایل نصب نیست", Toast.LENGTH_LONG).show(); }
                }
            })
            .setNeutralButton("اشتراک‌گذاری", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int w) {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType(type);
                    i.putExtra(Intent.EXTRA_STREAM, uri);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(i, "اشتراک‌گذاری"));
                }
            })
            .setNegativeButton("بستن", null)
            .show();
    }
}
