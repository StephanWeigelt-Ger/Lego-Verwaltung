"""Lädt deutsche UVP, Minifiguren und Verkaufsende von Brickset und speichert sie in data/uvp.json.
Aufruf: BRICKSET_KEY=... python3 tools/fetch_uvp.py data/uvp.json [voll]
Brickset erlaubt nur wenige Abfragen pro Tag; daher werden pro Abfrage 500 Sets eines Jahres geholt.
Ohne "voll" werden nur die letzten drei Jahre aktualisiert (ältere Preise ändern sich nicht).
"""
import datetime, json, os, sys, time, urllib.parse, urllib.request

key = os.environ.get('BRICKSET_KEY', '').strip()
out = sys.argv[1]
full = len(sys.argv) > 2 and sys.argv[2] == 'voll'
if not key:
    print('Kein BRICKSET_KEY gesetzt, UVP wird übersprungen.')
    sys.exit(0)

try:
    with open(out, encoding='utf-8') as f:
        data = json.load(f)
except FileNotFoundError:
    data = {}
    full = True

this_year = datetime.date.today().year
years = range(2000, this_year + 2) if full else range(this_year - 2, this_year + 2)
calls = 0

def get_sets(params):
    global calls
    calls += 1
    q = urllib.parse.urlencode({'apiKey': key, 'userHash': '', 'params': json.dumps(params)})
    req = urllib.request.Request('https://brickset.com/api/v3.asmx/getSets?' + q, headers={'User-Agent': 'lego-verwaltung-katalog'})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    if res.get('status') != 'success':
        raise RuntimeError(res.get('message', 'Brickset-Fehler'))
    return res.get('sets', [])

try:
    for year in years:
        page = 1
        while True:
            sets = get_sets({'year': str(year), 'pageSize': 500, 'pageNumber': page})
            for s in sets:
                de = (s.get('LEGOCom') or {}).get('DE') or {}
                num = f"{s.get('number')}-{s.get('numberVariant', 1)}"
                last = (de.get('dateLastAvailable') or s.get('exitDate') or '')[:10]
                data[num] = [de.get('retailPrice'), s.get('minifigs'), last]
            print(year, 'Seite', page, len(sets), 'Sets')
            if len(sets) < 500:
                break
            page += 1
            time.sleep(1)
        time.sleep(1)
except Exception as e:  # Tageslimit o. ä.: bisherigen Stand behalten
    print('Abbruch:', e)

with open(out, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
print(calls, 'Abfragen,', sum(1 for v in data.values() if v[0]), 'Sets mit deutscher UVP')
