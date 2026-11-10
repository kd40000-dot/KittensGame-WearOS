#!/usr/bin/env python3
"""Add native notification diagnostics to the decoded phone APK options UI.

Usage:
  python phone/patch-resource-tracker-diagnostics.py <decoded-apk>/assets/public

Run after injecting the tracker script with patch-resource-tracker-entry.py.
The resource-tracker-phone.js bundled into the APK must be from this branch.
"""
from pathlib import Path
import sys

def patch(public):
    ui = Path(public) / "mobile/jsx/popups/options.jsx.js"
    source = ui.read_text(encoding="utf-8")
    method_anchor = "    _openSettings: function(e){if(e&&e.preventDefault)e.preventDefault();if(window.KittensResourceTracker)KittensResourceTracker.openSettings();},"
    link_anchor = "                $r('a',{href:'#',onClick:this._openSettings},'Live Update settings'),"
    method = """    _testNotification: function(e){
        if(e&&e.preventDefault)e.preventDefault();
        var self=this;
        self.setState({busy:true,diagnostic:'Testing native notification…'});
        if(!window.KittensResourceTracker||!KittensResourceTracker.testNotification){
            self.setState({busy:false,diagnostic:'Test method missing from tracker JavaScript.'});return;
        }
        KittensResourceTracker.testNotification().then(function(){
            if(!self.isMounted||!self.isMounted())return;
            self.setState({busy:false,diagnostic:'Test posted: Android confirms active notification. Select Catnip to resume live tracking.'});
        }).catch(function(err){
            if(!self.isMounted||!self.isMounted())return;
            self.setState({busy:false,diagnostic:'Test failed: '+(err&&err.message||String(err))});
        });
    },
"""
    if "_testNotification: function" in source:
        print("UI already patched")
        return
    assert source.count(method_anchor) == 1, "Unexpected WResourceTrackerOpt method layout"
    assert source.count(link_anchor) == 1, "Unexpected WResourceTrackerOpt link layout"
    source = source.replace(method_anchor, method + method_anchor)
    source = source.replace(link_anchor, link_anchor + "\n                ' · ',\n                $r('a',{href:'#',onClick:this._testNotification},'Test notification'),")
    ui.write_text(source, encoding="utf-8")
    print("Patched", ui)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: patch-resource-tracker-diagnostics.py <assets/public>")
    patch(sys.argv[1])
