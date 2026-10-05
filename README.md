# Matchday Maker – Oswald + Montserrat

Gewählte Typografie:

- **Oswald Light** → MATCHDAY, KADER
- **Oswald Medium** → Datum, Uhrzeit, VS und Rückennummern
- **Montserrat Bold** → HEIMSPIEL / AUSWÄRTSSPIEL
- **Montserrat SemiBold** → Teamnamen, Coach, Spielernamen, Halle/Adresse
- **Montserrat Regular** → Liga / Label und kleinere Infos

Die Webfonts werden beim Öffnen geladen. Falls sie einmal nicht erreichbar sind,
bleibt die App mit Fallback-Schriften funktionsfähig.

Der Android-Download-Fix aus v4.1 bleibt erhalten:
Nach dem Rendern erscheinen **Video teilen** und **Video speichern**.

## Netlify

Die App wird in `arc155-bot/matchday-maker` auf dem Branch `main` verwaltet.
Sie besteht aus statischem HTML, CSS und JavaScript und benötigt keinen Build-Schritt.

Für die bestehende Netlify-Site:

1. `Project configuration > Developer settings > Continuous deployment > Repository` öffnen.
2. `Link repository` wählen, GitHub verbinden und `arc155-bot/matchday-maker` auswählen.
3. Den Production Branch auf `main` setzen.
4. Build command leer lassen und Publish directory auf `.` setzen.

Für eine neue Site: `Add new project > Import an existing project > GitHub`,
dann dasselbe Repository und dieselben Einstellungen wählen.

Nach der Verknüpfung veröffentlicht Netlify Änderungen an `main` automatisch.
Die Datei `netlify.toml` enthält das Veröffentlichungsverzeichnis und Cache-Regeln.

## Lokal starten

Im Projektordner `python -m http.server 8000` ausführen und
`http://localhost:8000` öffnen.

## Spielplan, Kader und Logos

Alle elf bisherigen Logo-Dateien liegen in `assets/logos/`. Seuzach,
Felben-Wellhausen, Rickenbach und Smash verwenden die freigestellten PNGs.

`data/app-data.json` ist die gemeinsame Datendatei. Sie enthält:

- Teamname, Liga, Coach, Captain und Libero unter `team`.
- Spielernamen, Trikotnummern und Aufgebot unter `players`.
- Die Zuordnung von Teamnamen zu Logo-Dateien unter `logos`.
- Spiele mit ID, Heimteam, Auswärtsteam, Datum, Uhrzeit, Halle und Adresse unter `matches`.
- Zeitzone und Zeitpunkt des letzten Spielplanimports unter `timezone` und `source`.

Der erste gespeicherte Spielplan enthält die 14 am 5. Oktober 2026 aus dem
bereits eingestellten VolleyManager-Feed abrufbaren Spiele. Er ist eine
Momentaufnahme; spätere Verschiebungen erscheinen erst nach einem neuen
Import und einer Aktualisierung der gemeinsamen Datei.

Die App lädt diese Datei beim Öffnen und hält sie mit dem Service Worker auch
offline bereit. Persönliche Bearbeitungen auf dem Gerät bleiben erhalten.
`Gemeinsame Daten laden` übernimmt die veröffentlichten Angaben erneut.

Zum Ändern ohne Codebearbeitung:

1. Ein Spiel auswählen oder `Neues Spiel` anklicken und die Angaben bearbeiten.
2. `Spiel im Spielplan speichern` anklicken. Spieler und Rollen wie bisher bearbeiten.
3. `Daten exportieren` lädt eine vollständige `app-data.json` herunter.
4. Diese Datei Codex geben, damit sie `data/app-data.json` im Repository ersetzt
   und auf `main` committet wird. Alternativ die Datei direkt auf GitHub ersetzen.

`Spiele laden` beziehungsweise ein ICS-Import aktualisiert den Spielplan zunächst
auf dem Gerät. Auch diese Daten können anschließend exportiert und ins
Repository übernommen werden. Der JSON-Import prüft die Angaben vor dem Übernehmen.
Ein direktes Schreiben vom Browser nach GitHub ist nicht eingerichtet.

Prüfung der Datenverarbeitung: `node --test tests/data-store.test.cjs`.

## Änderungen mit Codex

Codex soll dieses Repository und den Branch `main` verwenden. Änderungen zuerst
prüfen, dann committen und direkt nach `main` schreiben, sofern die Anfrage
keinen anderen Branch vorgibt. Die Arbeitsanweisungen stehen in `AGENTS.md`.
