package com.balthazar.kittenswear;

import android.content.ContentResolver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.AtomicFile;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.KeyStore;
import java.security.KeyPairGenerator;
import java.security.spec.MGF1ParameterSpec;
import java.security.interfaces.RSAPublicKey;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import java.util.*;
import java.util.concurrent.Executors;

final class LocalGameServer {
 static final int PORT=18742, TRANSFER_PORT=18743, MAX_BODY=16_000_000;
 private static final long TRANSFER_TTL_MS=15*60*1000L;
 private static final String AUTOSAVE_PATH=Environment.DIRECTORY_DOWNLOADS+"/Kittens Game/Autosaves/";
 private final Context context; private final ServerSocket socket;
 private volatile byte[] pendingExport;
 private volatile String exportState="{\"state\":\"idle\"}";
 private volatile String importState="{\"state\":\"idle\"}";
 private volatile ServerSocket transferSocket;
 private volatile String transferToken;
 private volatile String transferExport;
 private volatile String transferUrl;
 private volatile long transferExpires;
 private volatile String pendingImport;
 private volatile long pendingImportId;
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
 private static String sha256Hex(byte[] bytes)throws Exception{
  byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);
  StringBuilder out=new StringBuilder(digest.length*2);
  for(byte b:digest)out.append(String.format(Locale.US,"%02x",b&0xff));
  return out.toString();
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
   }else if(path.equals("/github/config-status")){
    data=githubConfigStatus().getBytes(StandardCharsets.UTF_8);
   }else if(path.equals("/github/pairing-key")){
    data=githubPairingKey().getBytes(StandardCharsets.UTF_8);
   }else if(request[0].equals("POST")&&path.equals("/github/config-encrypted")){
    byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException("Incomplete GitHub config body");
    data=storeGithubConfigEncrypted(new String(body,StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
   }else if(request[0].equals("POST")&&path.equals("/github/request")){
    byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException("Incomplete GitHub proxy body");
    data=githubRequest(new String(body,StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
   }else if(request[0].equals("POST")&&path.equals("/transfer/start")){
    byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException("Incomplete transfer body");
    org.json.JSONObject parsed=new org.json.JSONObject(new String(body,StandardCharsets.UTF_8));
    data=startTransfer(parsed.getString("exportText")).getBytes(StandardCharsets.UTF_8);
   }else if(path.equals("/transfer/status")){
    data=transferStatus().getBytes(StandardCharsets.UTF_8);
   }else if(path.equals("/transfer/qr")){
    byte[] png=transferQr();reply(s,200,"image/png",png);return;
   }else if(path.equals("/transfer/import-text")){
    data=getPendingImport().getBytes(StandardCharsets.UTF_8);
   }else if(request[0].equals("POST")&&path.equals("/transfer/clear-import")){
    pendingImport=null;data="{\"state\":\"success\"}".getBytes(StandardCharsets.UTF_8);
   }else if(request[0].equals("POST")&&path.equals("/transfer/stop")){
    stopTransfer();data="{\"state\":\"success\"}".getBytes(StandardCharsets.UTF_8);
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


 private String githubConfigStatus(){
  try{
   org.json.JSONObject cfg=SecureGithubConfig.load(context);
   if(cfg==null)return "{\"state\":\"success\",\"configured\":false}";
   return "{\"state\":\"success\",\"configured\":true,\"owner\":\""+esc(cfg.optString("owner"))+"\",\"repo\":\""+esc(cfg.optString("repo"))+"\",\"branch\":\""+esc(cfg.optString("branch","main"))+"\"}";
  }catch(Throwable e){return errorJson("github-config-status",e,"Could not read encrypted GitHub configuration.");}
 }
 private String githubPairingKey(){
  try{
   String key=SecureGithubConfig.publicKeyBase64();
   return "{\"state\":\"success\",\"algorithm\":\"RSA-OAEP-256\",\"publicKeySpkiBase64\":\""+esc(key)+"\"}";
  }catch(Throwable e){return errorJson("github-pairing-key",e,"Could not create the watch pairing key.");}
 }
 private String storeGithubConfigEncrypted(String json){
  try{
   org.json.JSONObject body=new org.json.JSONObject(json);
   String ciphertext=body.getString("ciphertext");
   String plain=SecureGithubConfig.decryptPairingPayload(ciphertext);
   org.json.JSONObject cfg=new org.json.JSONObject(plain);
   String owner=cfg.getString("owner").trim(),repo=cfg.getString("repo").trim(),token=cfg.getString("token").trim();
   String branch=cfg.optString("branch","main").trim();
   if(owner.isEmpty()||repo.isEmpty()||token.length()<20)throw new IllegalArgumentException("GitHub configuration is incomplete.");
   if(!owner.equals("kd40000-dot")||!repo.equals("KittensGame-Sync"))throw new SecurityException("This build only accepts kd40000-dot/KittensGame-Sync.");
   org.json.JSONObject safe=new org.json.JSONObject();
   safe.put("owner",owner);safe.put("repo",repo);safe.put("branch",branch.isEmpty()?"main":branch);safe.put("token",token);
   SecureGithubConfig.save(context,safe);
   return "{\"state\":\"success\",\"configured\":true,\"owner\":\""+esc(owner)+"\",\"repo\":\""+esc(repo)+"\"}";
  }catch(Throwable e){return errorJson("github-config",e,"Encrypted GitHub configuration was not accepted.");}
 }
 private String githubRequest(String json){
  HttpURLConnection conn=null;
  try{
   org.json.JSONObject cfg=SecureGithubConfig.load(context);
   if(cfg==null)throw new SecurityException("GitHub sync is not configured on this watch.");
   org.json.JSONObject req=new org.json.JSONObject(json);
   String method=req.optString("method","GET").toUpperCase(Locale.ROOT);
   String path=req.getString("path");
   String allowed="/repos/"+cfg.getString("owner")+"/"+cfg.getString("repo");
   if(!(path.equals(allowed)||path.startsWith(allowed+"/")))throw new SecurityException("GitHub request is outside the configured sync repository.");
   if(!(method.equals("GET")||method.equals("PUT")))throw new SecurityException("GitHub method is not allowed: "+method);
   URL url=new URL("https://api.github.com"+path);
   conn=(HttpURLConnection)url.openConnection();
   conn.setConnectTimeout(12000);conn.setReadTimeout(20000);conn.setRequestMethod(method);
   conn.setRequestProperty("Accept","application/vnd.github+json");
   conn.setRequestProperty("Authorization","Bearer "+cfg.getString("token"));
   conn.setRequestProperty("X-GitHub-Api-Version","2022-11-28");
   conn.setRequestProperty("User-Agent","Kittens-Wear-PlanA");
   if(method.equals("PUT")){
    byte[] body=req.getJSONObject("json").toString().getBytes(StandardCharsets.UTF_8);
    conn.setDoOutput(true);conn.setRequestProperty("Content-Type","application/json");conn.setFixedLengthStreamingMode(body.length);
    try(OutputStream out=conn.getOutputStream()){out.write(body);}
   }
   int status=conn.getResponseCode();
   InputStream response=status>=400?conn.getErrorStream():conn.getInputStream();
   String body=response==null?"":new String(response.readAllBytes(),StandardCharsets.UTF_8);
   org.json.JSONObject out=new org.json.JSONObject();
   out.put("status",status);out.put("body",body);
   return out.toString();
  }catch(Throwable e){return errorJson("github-request",e,"Native GitHub request failed.");}
  finally{if(conn!=null)conn.disconnect();}
 }

 private synchronized String startTransfer(String exportText){
  try{
   if(exportText==null||exportText.isEmpty())throw new IllegalArgumentException("Current save export is empty.");
   stopTransfer();
   List<String> addresses=findLanAddresses();
   if(addresses.isEmpty())throw new IllegalStateException("No reachable Wi-Fi/LAN IPv4 address found.");
   transferToken=randomToken();
   transferExport=exportText;
   pendingImport=null;
   pendingImportId=0;
   transferExpires=System.currentTimeMillis()+TRANSFER_TTL_MS;
   transferSocket=new ServerSocket();
   transferSocket.setReuseAddress(true);
   transferSocket.bind(new InetSocketAddress("0.0.0.0",TRANSFER_PORT));
   transferUrl="http://"+addresses.get(0)+":"+TRANSFER_PORT+"/t/"+transferToken+"/";
   ServerSocket opened=transferSocket;
   Thread t=new Thread(()->{
    while(!opened.isClosed()){
     try{
      Socket s=opened.accept();
      Thread worker=new Thread(()->serveTransfer(s),"Kittens transfer request");
      worker.setDaemon(true);worker.start();
     }catch(IOException ignored){}
    }
   },"Kittens transfer");
   t.setDaemon(true);t.start();
   String tokenAtStart=transferToken;
   Thread expiry=new Thread(()->{
    try{Thread.sleep(TRANSFER_TTL_MS);}catch(InterruptedException ignored){}
    synchronized(LocalGameServer.this){
     if(tokenAtStart.equals(transferToken)&&System.currentTimeMillis()>=transferExpires)stopTransfer();
    }
   },"Kittens transfer expiry");
   expiry.setDaemon(true);expiry.start();
   return "{\"state\":\"success\",\"url\":\""+esc(transferUrl)+"\",\"expiresSeconds\":"+(TRANSFER_TTL_MS/1000)+"}";
  }catch(Throwable e){
   stopTransfer();
   return errorJson("transfer-start",e,"Could not start temporary LAN transfer server.");
  }
 }
 private synchronized void stopTransfer(){
  ServerSocket s=transferSocket;
  transferSocket=null;transferToken=null;transferExport=null;transferUrl=null;transferExpires=0;
  pendingImport=null;pendingImportId=0;
  if(s!=null)try{s.close();}catch(IOException ignored){}
 }
 private String transferStatus(){
  boolean active=transferSocket!=null&&!transferSocket.isClosed()&&transferToken!=null&&System.currentTimeMillis()<transferExpires;
  if(!active){
   if(transferSocket!=null)stopTransfer();
   return "{\"state\":\"idle\",\"active\":false}";
  }
  String p=pendingImport;
  long remaining=Math.max(0,(transferExpires-System.currentTimeMillis()+999)/1000);
  return "{\"state\":\"success\",\"active\":true,\"url\":\""+esc(transferUrl)+"\",\"remainingSeconds\":"+remaining+",\"pending\":"+(p!=null)+",\"pendingCharacters\":"+(p==null?0:p.length())+",\"pendingId\":"+pendingImportId+"}";
 }
 private byte[] transferQr()throws Exception{
  String url=transferUrl;
  if(url==null||transferSocket==null||transferSocket.isClosed())throw new IllegalStateException("Transfer server is not active.");
  BitMatrix matrix=new QRCodeWriter().encode(url,BarcodeFormat.QR_CODE,360,360);
  int w=matrix.getWidth(),h=matrix.getHeight();int[] pixels=new int[w*h];
  for(int y=0;y<h;y++)for(int x=0;x<w;x++)pixels[y*w+x]=matrix.get(x,y)?0xff000000:0xffffffff;
  Bitmap bitmap=Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888);
  ByteArrayOutputStream out=new ByteArrayOutputStream();
  if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,out))throw new IOException("Could not encode transfer QR.");
  bitmap.recycle();return out.toByteArray();
 }
 private String getPendingImport(){
  String p=pendingImport;
  if(p==null)return "{\"state\":\"empty\"}";
  return "{\"state\":\"success\",\"id\":"+pendingImportId+",\"characters\":"+p.length()+",\"text\":\""+esc(p)+"\"}";
 }
 private void serveTransfer(Socket socket){
  try(Socket s=socket){
   s.setSoTimeout(20000);
   InputStream in=new BufferedInputStream(s.getInputStream());
   String[] request=line(in).split(" ");if(request.length<2)return;
   int length=0;String h;
   while(!(h=line(in)).isEmpty())if(h.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(h.substring(15).trim());
   if(length<0||length>MAX_BODY){transferReply(s,413,"text/plain","Save is too large.".getBytes(StandardCharsets.UTF_8));return;}
   String rawPath=request[1].split("\\?")[0];
   String token=transferToken;
   if(token==null||System.currentTimeMillis()>=transferExpires){transferReply(s,410,"text/plain","Transfer session expired.".getBytes(StandardCharsets.UTF_8));return;}
   String prefix="/t/"+token+"/";
   if(!rawPath.startsWith(prefix)){transferReply(s,403,"text/plain","Invalid transfer token.".getBytes(StandardCharsets.UTF_8));return;}
   String action=rawPath.substring(prefix.length());
   if(request[0].equals("OPTIONS")){
    transferReply(s,200,"text/plain",new byte[0]);
   }else if(request[0].equals("GET")&&action.equals("download")){
    String save=transferExport;
    if(save==null)throw new IllegalStateException("No watch export is available.");
    byte[] bytes=save.getBytes(StandardCharsets.UTF_8);
    Map<String,String> headers=new LinkedHashMap<>();
    headers.put("X-Kittens-Length",String.valueOf(bytes.length));
    headers.put("X-Kittens-SHA256",sha256Hex(bytes));
    transferReply(s,200,"text/plain",bytes,headers);
   }else if(request[0].equals("POST")&&action.equals("import")){
    byte[] body=in.readNBytes(length);
    if(body.length!=length)throw new IOException("Import upload was incomplete.");
    String text=new String(body,StandardCharsets.UTF_8);
    if(text.trim().isEmpty())throw new IOException("Uploaded save is empty.");
    synchronized(this){pendingImport=text;pendingImportId++;}
    transferReply(s,200,"application/json",("{\"state\":\"success\",\"characters\":"+text.length()+",\"bytes\":"+body.length+",\"sha256\":\""+sha256Hex(body)+"\",\"id\":"+pendingImportId+"}").getBytes(StandardCharsets.UTF_8));
   }else{
    transferReply(s,404,"text/plain","Not found".getBytes(StandardCharsets.UTF_8));
   }
  }catch(Exception e){
   try{transferReply(socket,500,"application/json",errorJson("transfer",e,"LAN transfer request failed").getBytes(StandardCharsets.UTF_8));}catch(Exception ignored){}
  }
 }
 private static String randomToken(){
  byte[] b=new byte[8];new SecureRandom().nextBytes(b);
  StringBuilder s=new StringBuilder();
  for(byte x:b)s.append(String.format(Locale.US,"%02x",x&0xff));
  return s.toString();
 }
 private static List<String> findLanAddresses()throws SocketException{
  class C {String address,name;int score;C(String a,String n,int s){address=a;name=n;score=s;}}
  List<C> found=new ArrayList<>();
  Enumeration<NetworkInterface> nets=NetworkInterface.getNetworkInterfaces();
  while(nets.hasMoreElements()){
   NetworkInterface ni=nets.nextElement();
   try{if(!ni.isUp()||ni.isLoopback())continue;}catch(Exception e){continue;}
   String n=ni.getName()==null?"":ni.getName().toLowerCase(Locale.ROOT);
   Enumeration<InetAddress> addrs=ni.getInetAddresses();
   while(addrs.hasMoreElements()){
    InetAddress a=addrs.nextElement();
    if(!(a instanceof Inet4Address)||a.isLoopbackAddress()||a.isLinkLocalAddress())continue;
    String ip=a.getHostAddress();int score=0;
    if(n.contains("wlan")||n.contains("wifi"))score+=100;
    if(a.isSiteLocalAddress())score+=50;
    if(n.contains("rmnet")||n.contains("cell"))score-=100;
    found.add(new C(ip,n,score));
   }
  }
  found.sort((a,b)->Integer.compare(b.score,a.score));
  LinkedHashSet<String> unique=new LinkedHashSet<>();
  for(C c:found)unique.add(c.address);
  return new ArrayList<>(unique);
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
 private void transferReply(Socket s,int status,String type,byte[] data)throws IOException{transferReply(s,status,type,data,Collections.emptyMap());}
 private void transferReply(Socket s,int status,String type,byte[] data,Map<String,String> extra)throws IOException{
  Map<String,String> headers=new LinkedHashMap<>(extra);
  headers.put("Access-Control-Allow-Origin","*");
  headers.put("Access-Control-Allow-Methods","GET, POST, OPTIONS");
  headers.put("Access-Control-Allow-Headers","Content-Type");
  headers.put("Access-Control-Expose-Headers","X-Kittens-SHA256, X-Kittens-Length");
  reply(s,status,type,data,headers);
 }
 private void reply(Socket s,int status,String type,byte[] data)throws IOException{reply(s,status,type,data,Collections.emptyMap());}
 private void reply(Socket s,int status,String type,byte[] data,Map<String,String> extra)throws IOException{
  OutputStream o=s.getOutputStream();String csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'";
  StringBuilder h=new StringBuilder("HTTP/1.1 ").append(status).append(" OK\r\nContent-Type: ").append(type).append("; charset=utf-8\r\nContent-Length: ").append(data.length).append("\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Security-Policy: ").append(csp);
  for(Map.Entry<String,String> e:extra.entrySet())h.append("\r\n").append(e.getKey()).append(": ").append(e.getValue());
  h.append("\r\n\r\n");
  o.write(h.toString().getBytes(StandardCharsets.UTF_8));o.write(data);o.flush();
 }
}


final class SecureGithubConfig {
 private static final String PREFS="kittens_plan_a_secure";
 private static final String AES_ALIAS="kittens_plan_a_github_aes_v1";
 private static final String RSA_ALIAS="kittens_plan_a_pair_rsa_v1";
 private static final String PREF_IV="github_iv",PREF_DATA="github_data";

 private static KeyStore ks()throws Exception{
  KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);return ks;
 }
 private static SecretKey aesKey()throws Exception{
  KeyStore store=ks();
  if(store.containsAlias(AES_ALIAS))return (SecretKey)store.getKey(AES_ALIAS,null);
  KeyGenerator kg=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
  kg.init(new KeyGenParameterSpec.Builder(AES_ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
   .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
  return kg.generateKey();
 }
 private static java.security.KeyPair rsaPair()throws Exception{
  KeyStore store=ks();
  if(store.containsAlias(RSA_ALIAS)){
   java.security.PrivateKey priv=(java.security.PrivateKey)store.getKey(RSA_ALIAS,null);
   java.security.PublicKey pub=store.getCertificate(RSA_ALIAS).getPublicKey();
   return new java.security.KeyPair(pub,priv);
  }
  KeyPairGenerator kpg=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA,"AndroidKeyStore");
  kpg.initialize(new KeyGenParameterSpec.Builder(RSA_ALIAS,KeyProperties.PURPOSE_DECRYPT)
   .setDigests(KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA1)
   .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP).setKeySize(3072).build());
  return kpg.generateKeyPair();
 }
 static String publicKeyBase64()throws Exception{
  return android.util.Base64.encodeToString(rsaPair().getPublic().getEncoded(),android.util.Base64.NO_WRAP);
 }
 static String decryptPairingPayload(String ciphertextB64)throws Exception{
  byte[] cipherBytes=android.util.Base64.decode(ciphertextB64,android.util.Base64.DEFAULT);
  Cipher cipher=Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
  OAEPParameterSpec spec=new OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA256,PSource.PSpecified.DEFAULT);
  cipher.init(Cipher.DECRYPT_MODE,rsaPair().getPrivate(),spec);
  return new String(cipher.doFinal(cipherBytes),StandardCharsets.UTF_8);
 }
 static void save(Context context,org.json.JSONObject config)throws Exception{
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,aesKey());
  byte[] encrypted=cipher.doFinal(config.toString().getBytes(StandardCharsets.UTF_8));
  context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit()
   .putString(PREF_IV,android.util.Base64.encodeToString(cipher.getIV(),android.util.Base64.NO_WRAP))
   .putString(PREF_DATA,android.util.Base64.encodeToString(encrypted,android.util.Base64.NO_WRAP)).apply();
 }
 static org.json.JSONObject load(Context context)throws Exception{
  android.content.SharedPreferences p=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
  String iv=p.getString(PREF_IV,null),data=p.getString(PREF_DATA,null);
  if(iv==null||data==null)return null;
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
  cipher.init(Cipher.DECRYPT_MODE,aesKey(),new GCMParameterSpec(128,android.util.Base64.decode(iv,android.util.Base64.DEFAULT)));
  byte[] plain=cipher.doFinal(android.util.Base64.decode(data,android.util.Base64.DEFAULT));
  return new org.json.JSONObject(new String(plain,StandardCharsets.UTF_8));
 }
}
