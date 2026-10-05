package com.balthazar.kittenswear;

import android.content.ComponentName;
import android.content.Context;
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester;

final class HudUpdateRequester {
 private HudUpdateRequester(){}

 @SuppressWarnings("unchecked")
 static void requestAll(Context c){
  Class<?>[] services=new Class<?>[]{
   KittensComplicationService.class,
   HudCatnipService.class,
   HudWoodService.class,
   HudScienceService.class,
   HudFaithService.class,
   HudMetalsPanelService.class,
   HudIndustryPanelService.class,
   HudVillagePanelService.class,
   HudMythicPanelService.class
  };
  for(Class<?> cls:services){
   try{
    ComplicationDataSourceUpdateRequester.create(c,new ComponentName(c,cls)).requestUpdateAll();
   }catch(Throwable ignored){}
  }
 }
}
