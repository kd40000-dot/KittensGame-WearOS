#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-mobile-options-iwguard.py <options.jsx.js>")

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
needle = '                        $r(WSimpleOpt, {title: $I("opts.hideSell"), opt: "hideSell", desc: $I("opts.hideSell.desc")}),\n'
row = (
    '                        $r(WSimpleOpt, {'
    'title: "Hide Iron Will-irrelevant purchases", '
    'opt: "hideIronWillBreakers", '
    'desc: "While Iron Will is active, hides purchases that would break Iron Will or are useless without kittens."'
    '}),\n'
)

if 'opt: "hideIronWillBreakers"' in text:
    print("Iron Will protection option already present")
    raise SystemExit(0)
if needle not in text:
    raise SystemExit("expected Hide Sell row not found; refusing to patch unknown mobile Options layout")

path.write_text(text.replace(needle, needle + row, 1), encoding="utf-8")
print("Inserted Iron Will protection option after Hide Sell")
