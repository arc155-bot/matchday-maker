# Matchday Maker Mobile v4.2 – Oswald + Montserrat

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

## Änderungen mit Codex

Codex soll dieses Repository und den Branch `main` verwenden. Änderungen zuerst
prüfen, dann committen und direkt nach `main` schreiben, sofern die Anfrage
keinen anderen Branch vorgibt. Die Arbeitsanweisungen stehen in `AGENTS.md`.
