package com.balthazar.kittenswear;

import android.app.*;
import android.os.Bundle;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import android.content.*;
import android.net.Uri;
import android.graphics.Bitmap;
import java.lang.ref.WeakReference;

public class MainActivity extends Activity {
 private static final int REQ_EXPORT=7201,REQ_IMPORT=7202;
 private static LocalGameServer server;
 private static WeakReference<MainActivity> current=new WeakReference<>(null);
 private WebView view;
 static MainActivity current(){return current.get();}

 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  current=new WeakReference<>(this);
  getWindow().getDecorView().setSystemUiVisibility(
   View.SYSTEM_UI_FLAG_FULLSCREEN|
   View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
   View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|
   View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|
   View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|
   View.SYSTEM_UI_FLAG_LAYOUT_STABLE
  );

  try{
   if(server==null)server=new LocalGameServer(this);

   WebView.setWebContentsDebuggingEnabled(false);
   view=new WebView(this);
   view.setBackgroundColor(0xff000000);

   WebSettings settings=view.getSettings();
   settings.setJavaScriptEnabled(true);
   settings.setDomStorageEnabled(true);
   settings.setDatabaseEnabled(true);
   settings.setAllowFileAccess(false);
   settings.setAllowContentAccess(false);
   settings.setSupportMultipleWindows(false);
   settings.setBuiltInZoomControls(false);
   settings.setDisplayZoomControls(false);
   settings.setTextZoom(100);
   settings.setCacheMode(WebSettings.LOAD_DEFAULT);
   settings.setMediaPlaybackRequiresUserGesture(true);
   if(android.os.Build.VERSION.SDK_INT>=21){
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
   }

   view.setWebViewClient(new WebViewClient(){
    private boolean allowed(String url){
     return url!=null&&url.startsWith("http://127.0.0.1:"+LocalGameServer.PORT+"/");
    }

    @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){
     String url=request.getUrl()==null?null:request.getUrl().toString();
     return !allowed(url);
    }

    @SuppressWarnings("deprecation")
    @Override public boolean shouldOverrideUrlLoading(WebView v,String url){
     return !allowed(url);
    }

    @Override public void onPageStarted(WebView v,String url,Bitmap favicon){
     super.onPageStarted(v,url,favicon);
    }
   });

   view.setWebChromeClient(new WebChromeClient(){
    @Override public boolean onJsAlert(WebView v,String url,String message,JsResult result){
     new AlertDialog.Builder(MainActivity.this)
      .setMessage(message)
      .setPositiveButton("OK",(d,w)->result.confirm())
      .setOnCancelListener(d->result.cancel())
      .show();
     return true;
    }

    @Override public boolean onJsConfirm(WebView v,String url,String message,JsResult result){
     new AlertDialog.Builder(MainActivity.this)
      .setMessage(message)
      .setPositiveButton("OK",(d,w)->result.confirm())
      .setNegativeButton("Cancel",(d,w)->result.cancel())
      .setOnCancelListener(d->result.cancel())
      .show();
     return true;
    }

    @Override public boolean onJsPrompt(WebView v,String url,String message,String defaultValue,JsPromptResult result){
     EditText input=new EditText(MainActivity.this);
     input.setText(defaultValue==null?"":defaultValue);
     new AlertDialog.Builder(MainActivity.this)
      .setMessage(message)
      .setView(input)
      .setPositiveButton("OK",(d,w)->result.confirm(input.getText().toString()))
      .setNegativeButton("Cancel",(d,w)->result.cancel())
      .setOnCancelListener(d->result.cancel())
      .show();
     return true;
    }
   });

   setContentView(view);
   view.loadUrl("http://127.0.0.1:"+LocalGameServer.PORT+"/");
  }catch(Throwable ex){
   TextView text=new TextView(this);
   text.setText("Kittens Wear could not start.\n"+ex.getClass().getName()+": "+ex.getMessage());
   text.setTextColor(-1);
   text.setPadding(40,70,40,40);
   setContentView(text);
  }
 }

 void openCreateDocument(String suggestedName){
  runOnUiThread(()->{
   try{
    Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);
    i.addCategory(Intent.CATEGORY_OPENABLE);
    i.setType("text/plain");
    i.putExtra(Intent.EXTRA_TITLE,suggestedName);
    startActivityForResult(i,REQ_EXPORT);
   }catch(Throwable e){
    if(server!=null)server.failExport(e,"Could not launch Android ACTION_CREATE_DOCUMENT. This watch may not provide a compatible document picker.");
   }
  });
 }

 void openImportDocument(){
  runOnUiThread(()->{
   try{
    Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);
    i.addCategory(Intent.CATEGORY_OPENABLE);
    i.setType("*/*");
    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(i,REQ_IMPORT);
   }catch(Throwable e){
    if(server!=null)server.failImport(e,"Could not launch Android ACTION_OPEN_DOCUMENT. This watch may not provide a compatible document picker.");
   }
  });
 }

 @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
  super.onActivityResult(requestCode,resultCode,data);
  try{
   if(requestCode==REQ_EXPORT){
    if(resultCode==RESULT_OK&&data!=null&&data.getData()!=null)server.finishExport(data.getData());
    else server.cancelExport();
   }else if(requestCode==REQ_IMPORT){
    if(resultCode==RESULT_OK&&data!=null&&data.getData()!=null){
     Uri u=data.getData();
     try{
      getContentResolver().takePersistableUriPermission(
       u,
       data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      );
     }catch(Exception ignored){}
     server.finishImport(u);
    }else server.cancelImport();
   }
  }catch(Throwable e){
   if(requestCode==REQ_EXPORT)server.failExport(e,"onActivityResult failed");
   else if(requestCode==REQ_IMPORT)server.failImport(e,"onActivityResult failed");
  }
 }

 @Override protected void onResume(){
  super.onResume();
  current=new WeakReference<>(this);
  if(view!=null)view.onResume();
 }

 @Override protected void onPause(){
  if(view!=null)view.onPause();
  super.onPause();
 }

 @Override protected void onDestroy(){
  if(current.get()==this)current.clear();
  if(view!=null){
   try{
    view.stopLoading();
    view.loadUrl("about:blank");
    view.setWebChromeClient(null);
    view.setWebViewClient(null);
    view.destroy();
   }catch(Throwable ignored){}
   view=null;
  }
  super.onDestroy();
 }

 @Override public void onBackPressed(){moveTaskToBack(true);}
}
