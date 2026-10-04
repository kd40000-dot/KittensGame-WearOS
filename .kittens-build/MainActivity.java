package com.balthazar.kittenswear;

import android.app.*;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import android.content.*;
import android.net.Uri;
import java.lang.ref.WeakReference;
import org.mozilla.geckoview.*;

public class MainActivity extends Activity {
 private static final int REQ_EXPORT=7201,REQ_IMPORT=7202;
 private static GeckoRuntime runtime;
 private static LocalGameServer server;
 private static GeckoSession session;
 private static WeakReference<MainActivity> current=new WeakReference<>(null);
 private GeckoView view;
 static MainActivity current(){return current.get();}

 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  current=new WeakReference<>(this);
  getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  try{
   if(server==null)server=new LocalGameServer(this);
   if(runtime==null)runtime=GeckoRuntime.create(getApplicationContext(),new GeckoRuntimeSettings.Builder().javaScriptEnabled(true).consoleOutput(false).build());
   view=new GeckoView(this);view.setBackgroundColor(0xff000000);setContentView(view);
   if(session==null){
    session=new GeckoSession(new GeckoSessionSettings.Builder().usePrivateMode(false).build());
    session.setContentDelegate(new GeckoSession.ContentDelegate(){});
    session.setNavigationDelegate(new GeckoSession.NavigationDelegate(){
     @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s,LoadRequest r){
      return GeckoResult.fromValue(r.uri.startsWith("http://127.0.0.1:"+LocalGameServer.PORT+"/")?AllowOrDeny.ALLOW:AllowOrDeny.DENY);
     }
    });
    session.open(runtime);view.setSession(session);session.loadUri("http://127.0.0.1:"+LocalGameServer.PORT+"/");
   }else view.setSession(session);
   session.setPromptDelegate(new GeckoSession.PromptDelegate(){
    @Override public GeckoResult<PromptResponse> onChoicePrompt(GeckoSession s,ChoicePrompt p){
     GeckoResult<PromptResponse> result=new GeckoResult<>();String[] labels=new String[p.choices.length];for(int i=0;i<labels.length;i++)labels[i]=p.choices[i].label;
     new AlertDialog.Builder(MainActivity.this).setTitle(p.title).setItems(labels,(d,w)->result.complete(p.confirm(p.choices[w].id))).setOnCancelListener(d->result.complete(p.dismiss())).show();return result;
    }
    @Override public GeckoResult<PromptResponse> onTextPrompt(GeckoSession s,TextPrompt p){
     GeckoResult<PromptResponse> result=new GeckoResult<>();EditText input=new EditText(MainActivity.this);input.setText(p.defaultValue);
     new AlertDialog.Builder(MainActivity.this).setTitle(p.title).setMessage(p.message).setView(input).setPositiveButton("OK",(d,w)->result.complete(p.confirm(input.getText().toString()))).setNegativeButton("Cancel",(d,w)->result.complete(p.dismiss())).setOnCancelListener(d->result.complete(p.dismiss())).show();return result;
    }
    @Override public GeckoResult<PromptResponse> onAlertPrompt(GeckoSession s,AlertPrompt p){
     GeckoResult<PromptResponse> result=new GeckoResult<>();new AlertDialog.Builder(MainActivity.this).setMessage(p.message).setPositiveButton("OK",(d,w)->result.complete(p.dismiss())).setOnCancelListener(d->result.complete(p.dismiss())).show();return result;
    }
    @Override public GeckoResult<PromptResponse> onButtonPrompt(GeckoSession s,ButtonPrompt p){
     GeckoResult<PromptResponse> result=new GeckoResult<>();new AlertDialog.Builder(MainActivity.this).setMessage(p.message).setPositiveButton("OK",(d,w)->result.complete(p.confirm(ButtonPrompt.Type.POSITIVE))).setNegativeButton("Cancel",(d,w)->result.complete(p.dismiss())).setOnCancelListener(d->result.complete(p.dismiss())).show();return result;
    }
   });
  }catch(Exception ex){
   TextView text=new TextView(this);text.setText("Kittens Wear could not start.\n"+ex.getClass().getName()+": "+ex.getMessage());text.setTextColor(-1);text.setPadding(40,70,40,40);setContentView(text);
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
    if(resultCode==RESULT_OK&&data!=null&&data.getData()!=null)server.finishExport(data.getData());else server.cancelExport();
   }else if(requestCode==REQ_IMPORT){
    if(resultCode==RESULT_OK&&data!=null&&data.getData()!=null){
     Uri u=data.getData();
     try{getContentResolver().takePersistableUriPermission(u,data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));}catch(Exception ignored){}
     server.finishImport(u);
    }else server.cancelImport();
   }
  }catch(Throwable e){
   if(requestCode==REQ_EXPORT)server.failExport(e,"onActivityResult failed");
   else if(requestCode==REQ_IMPORT)server.failImport(e,"onActivityResult failed");
  }
 }

 @Override protected void onResume(){super.onResume();current=new WeakReference<>(this);if(session!=null)session.setActive(true);}
 @Override protected void onPause(){if(session!=null)session.setActive(false);super.onPause();}
 @Override protected void onDestroy(){if(current.get()==this)current.clear();if(view!=null)view.releaseSession();super.onDestroy();}
 @Override public void onBackPressed(){moveTaskToBack(true);}
}
