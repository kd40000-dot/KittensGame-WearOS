package com.balthazar.kittenswear;
public class HudIndustryPanelService extends HudPanelComplicationService { @Override protected String panelName(){return "Industry";} @Override protected String[] resourceNames(){return new String[]{"gold","oil","uranium","unobtainium"};} }
