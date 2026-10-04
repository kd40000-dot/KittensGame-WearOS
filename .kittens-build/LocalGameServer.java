package com.balthazar.kittenswear;

import android.content.ContentResolver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.AtomicFile;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.Executors;

final class LocalGameServer {
 static final int PORT=18742, MAX_BODY=16_000_000;
 private static final String AUTOSAVE_PATH=Environment.DIRECTORY_DOWNLOADS+"/Kittens Game/Autosaves/";
 private final Context context; private final ServerSocket socket;
 private volatile byte[] pendingExport;
 private volatile String exportState="{\"state\":\"idle\"}";
 private volatile String importState="{\"state\":\"idle\"}";
 LocalGameServer(Context c)throws IOException{
  context=c.getApplicationContext();socket=new ServerSocket();socket.setReuseAddress(true);
  socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),PORT));
  var pool=Executors.newFixedThreadPool(4);
  Thread t=new Thread(()->{while(!socket.isClosed())try{Socket s=socket.accept();pool.execute(()->serve(s));}catch(IOException ignored){}},"Kittens assets");
  t.setDaemon(true);t.start();
 }
 private static String line(InputStream in)throws IOException{ByteArrayOutputStream b=new ByteArrayOutputStream();int x;while((x=in.read())!=-1&&x!='\n'){if(x!='\r')b.write(x);if(b.size()>8192)throw new IOException("Header too large");}return b.toString("UTF-8");}
 private File backup(){return new File(context.getFilesDir(),"game-backup.json");}
 private static String esc(String s){if(s==null)return "";return s.replace("\\","\\\\").replace("\"","\\\"").replace("\r","\\r").replace("\n","\\n");}
 private static String errorJson(String op,Throwable e,String detail){
  String cause=e.getCause()!=null?e.getCause().getClass().getName()+": "+String.valueOf(e.getCause().getMessage()):"";
  return "{\"state\":\"error\",\"operation\":\""+esc(op)+"\",\"type\":\""+esc(e.getClass().getName())+"\",\"message\":\""+esc(String.valueOf(e.getMessage()))+"\",\"cause\":\""+esc(cause)+"\",\"detail\":\""+esc(detail)+"\"}";
 }
 private void serve(Socket socket){
  try(Socket s=socket){
   s.setSoTimeout(15000);InputStream in=new BufferedInputStream(s.getInputStream());
   String[] request=line(in).split(" ");if(request.length<2)return;
   int length=0;String h;while(!(h=line(in)).isEmpty())if(h.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(h.substring(15).trim());
   if(length<0||length>MAX_BODY)throw new IOException("Body too large: "+length);
   String path=URLDecoder.decode(request[1].split("\\?")[0],"UTF-8");
   byte[] data;String type="application/json";
   if(request[0].equals("POST")&&path.equals("/complication-state")){
    data=in.readNBytes(length);if(data.length!=length)throw new IOException("Incomplete complication body");
    ComplicationStore.saveSnapshot(context,new String(data,StandardCharsets.UTF_8));data="{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
   }else if(request[0].equals("POST")&&path.equals("/open-complication-settings")){
    android.content.Intent intent=new android.content.Intent(context,ComplicationConfigActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);context.startActivity(intent);data="{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
   }else if(request[0].equals("POST")&&(path.equals("/backup")||path.equals("/save-manual"))){
    byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException("Incomplete save body");
    data=(path.equals("/save-manual")?manualSave(body):internalSave(body)).getBytes(StandardCharsets.UTF_8);
   }else if(request[0].equals("POST")&&path.equals("/export")){
    byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException("Incomplete export body");
    org.json.JSONObject parsed=new org.json.JSONObject(new String(body,StandardCharsets.UTF_8));
    data=copyClipboard(parsed.getString("exportText")).getBytes(StandardCharsets.UTF_8);
   }else if(request[0].equals("POST")&&path.equals("/clipboard-copy")){
    byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException("Incomplete clipboard body");
    org.json.JSONObject parsed=new org.json.JSONObject(new String(body,StandardCharsets.UTF_8));
    data=copyClipboard(parsed.getString("text")).getBytes(StandardCharsets.UTF_8);
   }else if(path.equals("/clipboard-read")){
    data=readClipboard().getBytes(StandardCharsets.UTF_8);
   }else if(path.equals("/restore")){
    AtomicFile f=new AtomicFile(backup());data=f.getBaseFile().exists()?f.readFully():"null".getBytes(StandardCharsets.UTF_8);
   }else{
    if(path.equals("/"))path="/index.html";
    try(InputStream asset=context.getAssets().open("game"+path)){data=asset.readAllBytes();}catch(FileNotFoundException e){reply(s,404,"text/plain",new byte[0]);return;}
    type=path.endsWith(".html")?"text/html":path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".json")?"application/json":path.endsWith(".png")?"image/png":path.endsWith(".gif")?"image/gif":path.endsWith(".svg")?"image/svg+xml":"application/octet-stream";
   }
   reply(s,200,type,data);
  }catch(Exception e){try{reply(socket,500,"application/json",errorJson("server",e,"Request processing failed").getBytes(StandardCharsets.UTF_8));}catch(Exception ignored){}}
 }
 private String copyClipboard(String text){
  try{
   if(text==null||text.isEmpty())throw new IllegalArgumentException("Save text is empty.");
   ClipboardManager cm=(ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE);
   if(cm==null)throw new IllegalStateException("Android ClipboardManager service is unavailable.");
   cm.setPrimaryClip(ClipData.newPlainText("Kittens Game save",text));
   return "{\"state\":\"success\",\"characters\":"+text.length()+",\"message\":\"Copied to Android clipboard\"}";
  }catch(Throwable e){return errorJson("clipboard-copy",e,"The save text is still available in the on-screen export box for manual copying.");}
 }
 private String readClipboard(){
  try{
   ClipboardManager cm=(ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE);
   if(cm==null)throw new IllegalStateException("Android ClipboardManager service is unavailable.");
   if(!cm.hasPrimaryClip()||cm.getPrimaryClip()==null||cm.getPrimaryClip().getItemCount()==0)throw new IllegalStateException("Android clipboard is empty.");
   CharSequence value=cm.getPrimaryClip().getItemAt(0).coerceToText(context);
   if(value==null||value.length()==0)throw new IllegalStateException("Clipboard contains no text.");
   String text=value.toString();
   if(text.length()>MAX_BODY)throw new IOException("Clipboard text exceeds the "+MAX_BODY+" character import limit.");
   return "{\"state\":\"success\",\"characters\":"+text.length()+",\"text\":\""+esc(text)+"\"}";
  }catch(Throwable e){return errorJson("clipboard-read",e,"You can still long-press the import box and paste using the keyboard or system paste command.");}
 }
 private String internalSave(byte[] body){
  try{
   AtomicFile f=new AtomicFile(backup());FileOutputStream out=null;
   try{out=f.startWrite();out.write(body);f.finishWrite(out);}
   catch(IOException e){if(out!=null)f.failWrite(out);throw e;}
   return "{\"state\":\"success\",\"internal\":true}";
  }catch(Exception e){return errorJson("background-save",e,"Internal atomic backup failed");}
 }
 private String manualSave(byte[] body){
  boolean internal=false,visible=false;String name="";StringBuilder errors=new StringBuilder();
  try{AtomicFile f=new AtomicFile(backup());FileOutputStream out=null;try{out=f.startWrite();out.write(body);f.finishWrite(out);internal=true;}catch(IOException e){if(out!=null)f.failWrite(out);throw e;}}catch(Exception e){errors.append("Internal backup failed: ").append(e.getClass().getSimpleName()).append(": ").append(e.getMessage()).append(". ");}
  try{name="KittensGame_"+timestamp()+".txt";writeDownload(name,body,AUTOSAVE_PATH);visible=true;}catch(Exception e){errors.append("Visible autosave failed: ").append(e.getClass().getSimpleName()).append(": ").append(e.getMessage()).append(". ");}
  if(!internal&&!visible)return "{\"state\":\"error\",\"operation\":\"save\",\"type\":\"StorageWriteError\",\"message\":\"Both the internal recovery copy and visible timestamped copy failed.\",\"internal\":false,\"visible\":false,\"detail\":\""+esc(errors.toString())+"\"}";
  return "{\"state\":\"success\",\"internal\":"+internal+",\"visible\":"+visible+",\"fileName\":\""+esc(name)+"\",\"location\":\"Download/Kittens Game/Autosaves/\",\"detail\":\""+esc(errors.toString())+"\"}";
 }
 private static String timestamp(){return new SimpleDateFormat("yyyy-MM-dd_HH-mm-ss",Locale.US).format(new Date());}
 private void writeDownload(String name,byte[] bytes,String relativePath)throws IOException{
  ContentResolver cr=context.getContentResolver();ContentValues v=new ContentValues();
  v.put(MediaStore.MediaColumns.DISPLAY_NAME,name);v.put(MediaStore.MediaColumns.MIME_TYPE,"text/plain");v.put(MediaStore.MediaColumns.RELATIVE_PATH,relativePath);
  Uri u=cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,v);if(u==null)throw new IOException("MediaStore returned null while creating "+relativePath+name);
  boolean ok=false;try(OutputStream out=cr.openOutputStream(u,"w")){if(out==null)throw new IOException("ContentResolver returned null output stream for "+u);out.write(bytes);out.flush();ok=true;}finally{if(!ok)try{cr.delete(u,null,null);}catch(Exception ignored){}}
 }
 synchronized void finishExport(Uri uri){
  try{
   if(uri==null){cancelExport();return;}
   byte[] bytes=pendingExport;if(bytes==null)throw new IllegalStateException("No pending export data was available. Start Export again.");
   try(OutputStream out=context.getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("The selected document provider returned no writable stream.");out.write(bytes);out.flush();}
   exportState="{\"state\":\"success\",\"uri\":\""+esc(uri.toString())+"\",\"bytes\":"+bytes.length+"}";
  }catch(Exception e){exportState=errorJson("export",e,"URI="+String.valueOf(uri));}finally{pendingExport=null;}
 }
 synchronized void cancelExport(){pendingExport=null;exportState="{\"state\":\"cancelled\",\"message\":\"Save dialog was cancelled\"}";}
 synchronized void failExport(Throwable e,String detail){pendingExport=null;exportState=errorJson("export",e,detail);}
 synchronized void finishImport(Uri uri){
  try{
   if(uri==null){cancelImport();return;}
   byte[] bytes;try(InputStream in=context.getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("The selected document provider returned no readable stream.");bytes=in.readNBytes(MAX_BODY+1);}
   if(bytes.length>MAX_BODY)throw new IOException("Selected save is larger than "+MAX_BODY+" bytes.");
   String text=new String(bytes,StandardCharsets.UTF_8).trim();if(text.isEmpty())throw new IOException("Selected file is empty.");
   importState="{\"state\":\"success\",\"uri\":\""+esc(uri.toString())+"\",\"bytes\":"+bytes.length+",\"text\":\""+esc(text)+"\"}";
  }catch(Exception e){importState=errorJson("import",e,"URI="+String.valueOf(uri));}
 }
 synchronized void cancelImport(){importState="{\"state\":\"cancelled\",\"message\":\"File picker was cancelled\"}";}
 synchronized void failImport(Throwable e,String detail){importState=errorJson("import",e,detail);}
 private void reply(Socket s,int status,String type,byte[] data)throws IOException{
  OutputStream o=s.getOutputStream();String csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'";
  o.write(("HTTP/1.1 "+status+" OK\r\nContent-Type: "+type+"; charset=utf-8\r\nContent-Length: "+data.length+"\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Security-Policy: "+csp+"\r\n\r\n").getBytes(StandardCharsets.UTF_8));o.write(data);o.flush();
 }
}
