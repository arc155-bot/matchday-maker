const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Data = require('../data-store.js');

function calendar(start, extra = '') {
  return `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:fixture-one\r\nSUMMARY:VBC Frauenfeld 1 - VBR Rickenbach 1 (3L)\r\n${start}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR`;
}

test('the committed shared data resolves every logo and role to existing content', () => {
  const raw = JSON.parse(fs.readFileSync(require.resolve('../data/app-data.json'), 'utf8'));
  const data = Data.validateData(raw);
  for (const logo of data.logos) assert.ok(fs.existsSync(require.resolve('../' + logo.src)));
  for (const role of ['captain', 'libero']) if (data.team[role]) assert.ok(data.players.some(player => player.name === data.team[role]));
});

test('VolleyManager folding and escaped text preserve hall, address and team names', () => {
  const [match] = Data.parseICS(calendar('DTSTART;TZID=Europe/Zurich:20261025T140000', 'DESCRIPTION:Halle: Turnhalle Ober\r\n wiesen\\nAdresse: Oberwiesenstrasse\\, 8500 Frauenfeld\\nLiga: #7100 | 3L | ♂\r\nBEGIN:VALARM\r\nDESCRIPTION:An unrelated alarm\r\nEND:VALARM\r\n'));
  assert.equal(match.homeTeam, 'VBC Frauenfeld 1');
  assert.equal(match.awayTeam, 'VBR Rickenbach 1');
  assert.equal(match.venue, 'Turnhalle Oberwiesen');
  assert.equal(match.address, 'Oberwiesenstrasse, 8500 Frauenfeld');
  assert.equal(match.competition, '3. Liga · Männer');
  assert.equal(match.id, 'fixture-one');
});

test('UTC games use Swiss summer and winter time, including date rollover', () => {
  assert.equal(Data.parseICS(calendar('DTSTART:20260901T120000Z'))[0].time, '14:00');
  assert.equal(Data.parseICS(calendar('DTSTART:20261101T120000Z'))[0].time, '13:00');
  const overnight = Data.parseICS(calendar('DTSTART:20260901T233000Z'))[0];
  assert.equal(overnight.date, '2026-09-02');
  assert.equal(overnight.time, '01:30');
});

test('a non-Swiss TZID is converted rather than interpreted as Swiss time', () => {
  assert.equal(Data.parseICS(calendar('DTSTART;TZID=America/New_York:20261107T100000'))[0].time, '16:00');
});

test('date-only games preserve the date without inventing a time', () => {
  const match = Data.parseICS(calendar('DTSTART;VALUE=DATE:20261025'))[0];
  assert.equal(match.date, '2026-10-25');
  assert.equal(match.time, '');
});

test('invalid dates and times are rejected before UTC rollover can hide them', () => {
  assert.throws(() => Data.parseICS(calendar('DTSTART:20260230T120000Z')), /Kalenderdatum/);
  assert.throws(() => Data.parseICS(calendar('DTSTART:20261107T260000Z')), /Kalenderuhrzeit/);
  assert.throws(() => Data.normalizeMatch({ homeTeam: 'A', awayTeam: 'B', date: '2026-02-29', time: '12:00' }), /Datum/);
  assert.equal(Data.normalizeMatch({ homeTeam: 'A', awayTeam: 'B', date: '2028-02-29', time: '12:00' }).date, '2028-02-29');
});

test('JSON import rejects duplicate fixture IDs and malformed roster data', () => {
  const original = JSON.parse(fs.readFileSync(require.resolve('../data/app-data.json'), 'utf8'));
  const duplicated = structuredClone(original);
  duplicated.matches.push({ ...duplicated.matches[0] });
  assert.throws(() => Data.validateData(duplicated), /eindeutig/);
  const invalid = structuredClone(original);
  invalid.players[0].number = 'not-a-number';
  assert.throws(() => Data.validateData(invalid), /Trikotnummer/);
});

test('export/import round trip retains shared data and additional uploaded logos', () => {
  const original = JSON.parse(fs.readFileSync(require.resolve('../data/app-data.json'), 'utf8'));
  original.logoOverrides = { 'a new opponent': 'data:image/png;base64,AA==' };
  const validated = Data.validateData(original);
  assert.deepEqual(Data.validateData(JSON.parse(JSON.stringify(validated))), validated);
});
