#!/usr/bin/env python3
"""Keep Live Sync six-digit pairing codes in decimal Arabic numerals.

Usage: python3 phone/patch-pairing-code-decimal.py <decoded-apk>/assets/public
Applies to the phone's mobile Export/Sync popup; game quantities remain dozenal.
"""
from pathlib import Path
import sys

REPLACEMENTS = [
    (
      "this.state.livePairCode?$r('p',{style:{fontSize:'26px',fontWeight:'bold'}},this.state.livePairCode):null",
      "this.state.livePairCode?$r('p',{'data-dozenal-skip':'pairing-code',style:{fontSize:'26px',fontWeight:'bold',fontFamily:'Roboto, sans-serif'}},this.state.livePairCode):null"
    ),
    (
      "$r('p',{style:{whiteSpace:'pre-wrap'}},this.state.liveStatus||st.message||'')",
      "$r('p',{'data-dozenal-skip':'pairing-status',style:{whiteSpace:'pre-wrap',fontFamily:'Roboto, sans-serif'}},this.state.liveStatus||st.message||'')"
    )
]
def main(public):
    path=Path(public)/"mobile/jsx/popups/export.jsx.js"
    data=path.read_text()
    for old,new in REPLACEMENTS:
        if new in data:continue
        if data.count(old)!=1:
            raise SystemExit("Expected exact pairing UI anchor missing: "+old[:45])
        data=data.replace(old,new)
    path.write_text(data)
    print("Pairing-code and status message excluded from base-12 renderer:",path)
if __name__=="__main__":
    if len(sys.argv)!=2:raise SystemExit("Usage: patch-pairing-code-decimal.py <assets/public>")
    main(sys.argv[1])
