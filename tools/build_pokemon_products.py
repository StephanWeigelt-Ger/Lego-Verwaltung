"""Baut pokemon/data/produkte.json aus den frei herunterladbaren Cardmarket-Daten
(Produktliste der versiegelten Produkte + Preisübersicht, Pokémon = Spiel 6).
Aufruf: python3 tools/build_pokemon_products.py pokemon/data/produkte.json
Format: {"stand": "...", "produkte": [[idProduct, Name, Kategorie, idExpansion, Trend, Durchschnitt30, Ab-Preis], ...]}
"""
import json, sys, urllib.request

BASE = 'https://downloads.s3.cardmarket.com/productCatalog'
out = sys.argv[1]


def get(path):
    req = urllib.request.Request(f'{BASE}/{path}', headers={'User-Agent': 'collector-catalog/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


products = get('productList/products_nonsingles_6.json')['products']
guide = get('priceGuide/price_guide_6.json')
prices = {p['idProduct']: p for p in guide['priceGuides']}
CAT = {
    'Pokémon Booster': 'Booster', 'Pokémon Display': 'Display', 'Pokémon Elite Trainer Boxes': 'Top-Trainer-Box',
    'Pokémon Box Set': 'Box / Kollektion', 'Pokémon Tins': 'Tin', 'Pokémon Blisters': 'Blister',
    'Pokémon Theme Decks': 'Themendeck', 'Pokémon Coins': 'Münze', 'Pokémon Trainer Kits': 'Trainer-Kit',
    'Pokémon Lot': 'Lot', 'PCG Set': 'Set',
}
rows = []
for p in products:
    pg = prices.get(p['idProduct']) or {}
    r = lambda v: round(v, 2) if isinstance(v, (int, float)) else None
    rows.append([p['idProduct'], p['name'], CAT.get(p.get('categoryName'), p.get('categoryName') or ''), p.get('idExpansion'),
                 r(pg.get('trend')), r(pg.get('avg30')), r(pg.get('low'))])
if len(rows) < 1000:
    sys.exit('Zu wenige Produkte geladen, Datei wird nicht überschrieben.')
with open(out, 'w', encoding='utf-8') as f:
    json.dump({'stand': guide.get('createdAt', ''), 'produkte': rows}, f, ensure_ascii=False, separators=(',', ':'))
print(len(rows), 'Produkte, Preisstand', guide.get('createdAt'))
