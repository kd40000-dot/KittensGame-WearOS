#!/usr/bin/env python3
"""Install phone sync/tracker script tags in BOTH Capacitor and mobile entry pages.

Usage: python phone/patch-resource-tracker-entry.py <decoded-apk>/assets/public
Capacitor starts at index.html. index-mobile.html is a secondary dev entry point;
injecting scripts only into index-mobile.html leaves native options with
"Tracker JavaScript is missing" even when the JavaScript file exists in the APK.
"""
from pathlib import Path
import sys

SCRIPTS = (
    "sync/plan-a-core.js",
    "sync/plan-a-orchestrator.js",
    "sync/github-mailbox.js",
    "sync/plan-a-cloud.js",
    "sync/live-sync-client.js",
    "phone/plan-a-phone.js",
    "phone/live-sync-phone.js",
    "phone/resource-tracker-phone.js",
)
ENTRY_PAGES = ("index.html", "index-mobile.html")

def patch(public):
    public = Path(public)
    for source in SCRIPTS:
        if not (public / source).is_file():
            raise SystemExit("Missing required web asset: " + source)

    tags = "\n".join(
        '    <script type="text/javascript" src="' + source + '"></script>'
        for source in SCRIPTS
    )
    for entry in ENTRY_PAGES:
        dest = public / entry
        text = dest.read_text(encoding="utf-8")
        anchor = '<body class="theme-gray">'
        if text.count(anchor) != 1:
            raise SystemExit("Unexpected page template: " + entry)
        absent = [script for script in SCRIPTS if 'src="' + script + '"' not in text]
        if absent:
            fragment = "\n".join(
                '    <script type="text/javascript" src="' + script + '"></script>'
                for script in absent
            )
            text = text.replace(anchor, anchor + "\n" + fragment, 1)
            dest.write_text(text, encoding="utf-8")
        for script in SCRIPTS:
            if text.count('src="' + script + '"') != 1:
                raise SystemExit("Duplicate/missing script " + script + " in " + entry)
        print("Verified", entry, "contains all phone scripts")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: patch-resource-tracker-entry.py <assets/public directory>")
    patch(sys.argv[1])
