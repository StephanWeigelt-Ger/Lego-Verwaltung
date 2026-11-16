# Lego Verwaltung

Web-App (PWA) zur Verwaltung einer Lego-Sammlung. Läuft auf iPhone, iPad und Computer und lässt sich über „Zum Home-Bildschirm“ wie eine App installieren.

## Funktionen
- Sets mit Setnummer, Name, Thema, Erscheinungsjahr, UVP (Deutschland), Teilen, Minifiguren, Retired-Status und Marktwert
- Mehrere Exemplare pro Set mit Kaufdatum, Einkaufspreis, Händler, Zustand der Packung (1–10), Beschädigungen, Verpackungsstatus, Lagerort und Verkauf
- Fotos aus Kamera oder Mediathek, automatisch verbessert (Helligkeit, Kontrast, Spiegelungen) ohne Schäden wegzuretuschieren
- Online-Recherche von UVP und Erscheinungsjahr über die Brickset-API
- Excel-Import und -Export, JSON-Sicherung
- Speicherung und Abgleich zwischen Geräten über einen eigenen App-Ordner in Dropbox

## Technik
Reine statische Web-App ohne Build-Schritt (HTML, CSS, JavaScript-Module), gehostet über GitHub Pages.
Daten liegen lokal in IndexedDB und werden als `sammlung.json` plus `fotos/*.jpg` im Dropbox-App-Ordner abgelegt.

Lokal starten: `python3 -m http.server 8765` im Projektordner, dann http://localhost:8765 öffnen.
