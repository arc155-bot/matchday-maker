/* Shared file format and VolleyManager import for the app and local tools. */
(() => {
  'use strict';

  const text = value => typeof value === 'string' ? value.trim() : '';
  const decodeICS = value => (value || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizeMatch(raw, index = 0) {
    if (!raw || typeof raw !== 'object') throw new Error(`Spiel ${index + 1}: Angaben fehlen.`);
    const match = {
      id: text(String(raw.id ?? '')),
      homeTeam: text(raw.homeTeam), awayTeam: text(raw.awayTeam),
      date: text(raw.date), time: text(raw.time),
      venue: text(raw.venue), address: text(raw.address), competition: text(raw.competition),
      matchType: text(raw.matchType) || 'auto'
    };
    if (!match.homeTeam || !match.awayTeam) throw new Error(`Spiel ${index + 1}: Heim- und Auswärtsteam fehlen.`);
    if (!validDate(match.date)) throw new Error(`Spiel ${index + 1}: Datum ist ungültig.`);
    if (match.time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(match.time)) throw new Error(`Spiel ${index + 1}: Uhrzeit ist ungültig.`);
    if (!['auto', 'home', 'away'].includes(match.matchType)) throw new Error(`Spiel ${index + 1}: Heim-/Auswärtsauswahl ist ungültig.`);
    match.id ||= `${match.date}-${match.homeTeam}-${match.awayTeam}`;
    return match;
  }

  function sortMatches(matches) {
    return [...matches].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }

  function validateData(raw) {
    if (!raw || raw.version !== 1) throw new Error('Die Datei muss Matchday-Daten der Version 1 enthalten.');
    const timezone = text(raw.timezone) || 'Europe/Zurich';
    new Intl.DateTimeFormat('de-CH', { timeZone: timezone }).format(new Date());
    if (!raw.team || !Array.isArray(raw.players) || !Array.isArray(raw.matches) || !Array.isArray(raw.logos)) throw new Error('Team, Spielerliste, Spielplan oder Logos fehlen.');
    const team = Object.fromEntries(['name', 'competition', 'coach', 'captain', 'libero'].map(key => [key, text(raw.team[key])]));
    if (!team.name) throw new Error('Der Teamname fehlt.');
    const players = raw.players.map((player, index) => {
      const name = text(player.name), number = Number(player.number);
      if (!name || !Number.isInteger(number) || number < 0 || number > 99) throw new Error(`Spieler ${index + 1}: Name oder Trikotnummer ist ungültig.`);
      return { name, number, selected: player.selected !== false };
    });
    const removedPlayers = raw.removedPlayers ?? [];
    if (!Array.isArray(removedPlayers) || removedPlayers.some(name => !text(name))) throw new Error('Eine gespeicherte Spielerentfernung ist ungültig.');
    const logos = raw.logos.map(logo => {
      if (!Array.isArray(logo.keys) || !logo.keys.length || logo.keys.some(key => !text(key)) || !/^assets\/logos\/[^/]+\.(?:png|jpg|jpeg|webp|svg)$/i.test(text(logo.src))) throw new Error('Eine Logo-Zuordnung ist ungültig.');
      return { keys: logo.keys.map(text), src: text(logo.src) };
    });
    const matches = sortMatches(raw.matches.map(normalizeMatch));
    if (new Set(matches.map(match => match.id)).size !== matches.length) throw new Error('Spiel-IDs müssen eindeutig sein.');
    const logoOverrides = {};
    for (const [key, src] of Object.entries(raw.logoOverrides || {})) {
      if (!key || typeof src !== 'string' || !/^(?:data:image\/|assets\/logos\/)/i.test(src)) throw new Error('Ein zusätzliches Logo ist ungültig.');
      Object.defineProperty(logoOverrides, key, { value: src, enumerable: true });
    }
    return { version: 1, timezone, source: raw.source && typeof raw.source === 'object' ? { url: text(raw.source.url), importedAt: text(raw.source.importedAt) } : { url: '', importedAt: '' }, team, players, removedPlayers: [...new Set(removedPlayers.map(text))], logos, matches, logoOverrides };
  }

  function dateParts(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}`, seconds: values.second };
  }

  function parseStart(value, parameters, timezone) {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
    if (!match) throw new Error('Ein Kalenderdatum ist ungültig.');
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    if (!validDate(date)) throw new Error('Ein Kalenderdatum ist ungültig.');
    if (!match[4]) return { date, time: '' };
    if (+match[4] > 23 || +match[5] > 59 || +(match[6] || 0) > 59) throw new Error('Eine Kalenderuhrzeit ist ungültig.');
    const sourceZone = (parameters.match(/TZID=([^;]+)/i)?.[1] || timezone).replace(/^"|"$/g, '');
    if (!match[7] && sourceZone === timezone) return { date, time: `${match[4]}:${match[5]}` };
    const desired = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] || 0));
    let instant = desired;
    if (!match[7]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const local = dateParts(new Date(instant), sourceZone);
        const represented = Date.parse(`${local.date}T${local.time}:${local.seconds}Z`);
        instant += desired - represented;
      }
    }
    const local = dateParts(new Date(instant), timezone);
    return { date: local.date, time: local.time };
  }

  function parseICS(input, timezone = 'Europe/Zurich') {
    if (!/BEGIN:VCALENDAR/i.test(input || '')) throw new Error('Diese Datei enthält keinen iCal-Spielplan.');
    const unfolded = input.replace(/\r?\n[ \t]/g, '');
    const blocks = unfolded.split('BEGIN:VEVENT').slice(1).map(block => block.split('END:VEVENT')[0].split('BEGIN:VALARM')[0]);
    return sortMatches(blocks.map((block, index) => {
      const property = key => {
        const result = block.match(new RegExp('^' + key + '([^:]*):(.*)$', 'mi'));
        return { parameters: result?.[1] || '', value: result?.[2].trim() || '' };
      };
      const get = key => decodeICS(property(key).value);
      const summary = get('SUMMARY').replace(/\s*\([^()]+\)\s*$/, '').replace(/\s+/g, ' ').trim();
      const teams = summary.split(/\s+(?:-|–|—|vs\.?)\s+/i);
      if (teams.length !== 2) throw new Error(`Kalendereintrag ${index + 1}: Die beiden Teams konnten nicht erkannt werden.`);
      const start = property('DTSTART');
      const dateTime = parseStart(start.value, start.parameters, timezone);
      const description = get('DESCRIPTION');
      const venue = description.match(/(?:^|\n)Halle:\s*([^\n]+)/)?.[1] || '';
      const address = description.match(/(?:^|\n)Adresse:\s*([^\n]+)/)?.[1] || get('LOCATION');
      const league = description.match(/(?:^|\n)Liga:\s*[^|\n]+\|\s*([^|\n]+)\|\s*([^\n]+)/);
      const competition = league ? `${league[1].trim().replace(/^(\d)L$/, '$1. Liga')} · ${league[2].trim() === '♂' ? 'Männer' : league[2].trim() === '♀' ? 'Frauen' : league[2].trim()}` : '';
      return normalizeMatch({ id: get('UID'), homeTeam: teams[0], awayTeam: teams[1], ...dateTime, venue, address, competition }, index);
    }));
  }

  const api = { validateData, normalizeMatch, sortMatches, parseICS, dateParts };
  globalThis.MatchdayData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
