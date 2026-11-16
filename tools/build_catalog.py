"""Baut data/katalog.json aus den frei verfügbaren Rebrickable-Datenbank-Exporten.
Aufruf: python3 tools/build_catalog.py sets.csv themes.csv data/katalog.json [data/uvp.json]
Format: {"10294-1": [Name, Jahr, Thema, Unterthema, Teile, UVP_DE, Minifiguren, Verkaufsende], ...}
"""
import csv, json, sys

sets_csv, themes_csv, out = sys.argv[1:4]
uvp = {}
if len(sys.argv) > 4:
    try:
        with open(sys.argv[4], encoding='utf-8') as f:
            uvp = json.load(f)
    except FileNotFoundError:
        pass
themes = {}
with open(themes_csv, newline='', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        themes[r['id']] = (r['name'], r['parent_id'] or None)

def theme_path(tid):
    names = []
    while tid and tid in themes and len(names) < 5:
        name, parent = themes[tid]
        names.append(name)
        tid = parent
    names.reverse()
    return (names[0] if names else ''), (names[-1] if len(names) > 1 else '')

cat = {}
with open(sets_csv, newline='', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        top, sub = theme_path(r['theme_id'])
        try:
            parts = int(r['num_parts'])
        except ValueError:
            parts = 0
        entry = [r['name'], int(r['year'] or 0), top, sub, parts]
        if r['set_num'] in uvp:
            entry += uvp[r['set_num']]
        cat[r['set_num']] = entry

with open(out, 'w', encoding='utf-8') as f:
    json.dump(cat, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
print(len(cat), 'Sets geschrieben')
