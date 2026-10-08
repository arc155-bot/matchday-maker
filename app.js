(async () => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('storyCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const W = 1080;
  const H = 1920;

  // Originale Generatorwerte aus config.py / renderer.py / video.py
  const PRIMARY = '#12051F';
  const ACCENT = '#A855F7';
  const ELECTRIC = mixHex(ACCENT, '#FFFFFF', 0.52);
  const MATCH_SECONDS = 5.4;
  const TRANSITION_SECONDS = 1.4;
  const ROSTER_SECONDS = 4.4;
  const ROSTER_HOLD_SECONDS = 2.7;
  const TOTAL_SECONDS = MATCH_SECONDS + TRANSITION_SECONDS + ROSTER_SECONDS;

  const BACKGROUND_SRC = 'assets/backgrounds/Halle.png';
  const BASE_MATCH_SRC = 'assets/backgrounds/base_match.png';
  const BASE_ROSTER_SRC = 'assets/backgrounds/base_roster.png';
  const PROFILE_LOGO_SRC = 'assets/logos/instagram_herren1.png';
  const OWN_LOGO_SRC = 'assets/logos/vbc_frauenfeld.png';

  const Data = globalThis.MatchdayData;
  const DATA_URL = 'data/app-data.json';
  let projectData = await loadProjectData();
  let BUILTIN_LOGOS = projectData.logos;
  let selectedEventId = localStorage.getItem('md_selectedEventId') || '';
  let scheduleSource = { ...projectData.source };

  // v4.2 typography:
  // Oswald = headlines, date/time, VS and jersey numbers.
  // Montserrat = match type, team names, roster, coach, league and venue.
  const FONT_DISPLAY = '"Oswald", "Arial Narrow", Arial, sans-serif';
  const FONT_TEXT = '"Montserrat", "Segoe UI", Arial, sans-serif';

  const imageCache = new Map();
  let baseMatch = null;
  let baseRoster = null;
  let previewMode = 'match';
  let installPrompt = null;
  let parsedEvents = readStorage('md_events', projectData.matches).map(event => ({ ...event }));
  let renderedVideoBlob = null;
  let renderedVideoName = '';
  let renderedVideoUrl = '';
  let sceneRevision = 0;
  let sceneCache = null;
  let sceneCacheRevision = -1;

  let players = readStorage('md_players', projectData.players).map(player => ({ ...player }));
  let captain = localStorage.getItem('md_captain') ?? projectData.team.captain;
  let libero = localStorage.getItem('md_libero') ?? projectData.team.libero;
  let customLogos = readStorage('md_teamLogos', projectData.logoOverrides);

  const matchFields = ['homeTeam', 'awayTeam', 'date', 'time', 'venue', 'address', 'competition', 'ownTeam', 'coach', 'matchType'];

  function readStorage(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch (_) { return fallback; }
  }

  async function loadProjectData() {
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Data.validateData(await response.json());
      localStorage.setItem('md_projectData', JSON.stringify(data));
      $('dataStatus').textContent = `${data.matches.length} gemeinsame Spiele geladen`;
      return data;
    } catch (error) {
      const cached = readStorage('md_projectData', null);
      if (cached) {
        $('dataStatus').textContent = 'Zuletzt geladene gemeinsame Daten werden verwendet.';
        return Data.validateData(cached);
      }
      $('dataStatus').textContent = 'Gemeinsame Daten konnten nicht geladen werden. Bitte eine Datendatei importieren.';
      return Data.validateData({ version: 1, timezone: 'Europe/Zurich', team: { name: $('ownTeam').value, competition: $('competition').value, coach: $('coach').value }, players: [], matches: [], logos: [] });
    }
  }

  function applyTeamDefaults() {
    $('ownTeam').value = projectData.team.name;
    $('competition').value = projectData.team.competition;
    $('coach').value = projectData.team.coach;
    if (projectData.source.url) $('feedUrl').value = projectData.source.url;
  }

  function persistEvents() {
    localStorage.setItem('md_events', JSON.stringify(parsedEvents));
    localStorage.setItem('md_selectedEventId', selectedEventId);
    localStorage.setItem('md_scheduleSource', JSON.stringify(scheduleSource));
    $('feedStatus').textContent = `${parsedEvents.length} Spiele`;
  }

  function saveCurrentEvent(notify = true) {
    const event = Data.normalizeMatch({
      id: selectedEventId || `manual-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
      ...Object.fromEntries(['homeTeam', 'awayTeam', 'date', 'time', 'venue', 'address', 'competition', 'matchType'].map(key => [key, $(key).value]))
    });
    const existing = parsedEvents.findIndex(item => item.id === event.id);
    if (existing >= 0) parsedEvents[existing] = event;
    else parsedEvents.push(event);
    parsedEvents = Data.sortMatches(parsedEvents);
    selectedEventId = event.id;
    persistEvents();
    populateEvents({ apply: false });
    saveState();
    if (notify) $('dataStatus').textContent = 'Spiel auf diesem Gerät gespeichert. Exportiere die Daten für die gemeinsame Datei.';
    return event;
  }

  function currentData() {
    return Data.validateData({
      ...projectData, source: scheduleSource,
      team: { name: $('ownTeam').value, competition: $('competition').value, coach: $('coach').value, captain, libero },
      players, matches: parsedEvents, logos: BUILTIN_LOGOS, logoOverrides: customLogos
    });
  }

  function useData(data) {
    projectData = Data.validateData(data);
    BUILTIN_LOGOS = projectData.logos;
    players = projectData.players.map(player => ({ ...player }));
    captain = projectData.team.captain;
    libero = projectData.team.libero;
    customLogos = { ...projectData.logoOverrides };
    parsedEvents = projectData.matches.map(event => ({ ...event }));
    selectedEventId = '';
    scheduleSource = { ...projectData.source };
    applyTeamDefaults();
    if (!parsedEvents.length) {
      ['homeTeam', 'awayTeam', 'date', 'time', 'venue', 'address'].forEach(key => { $(key).value = ''; });
      $('homeTeam').value = projectData.team.name;
      $('matchType').value = 'auto';
    }
    populateEvents();
    persistEvents();
    renderRosterControls();
    saveState();
    invalidateScene();
    draw();
  }

  function invalidateScene() {
    sceneRevision += 1;
    sceneCache = null;
  }

  function saveState() {
    const obj = {};
    matchFields.forEach(id => obj[id] = $(id).value);
    localStorage.setItem('md_match', JSON.stringify(obj));
    localStorage.setItem('md_players', JSON.stringify(players));
    localStorage.setItem('md_captain', captain);
    localStorage.setItem('md_libero', libero);
    localStorage.setItem('md_teamLogos', JSON.stringify(customLogos));
  }

  function restore() {
    const obj = readStorage('md_match', null);
    if (obj) {
      matchFields.forEach(id => {
        if (obj[id] != null) $(id).value = obj[id];
      });
    }
    $('feedUrl').value = localStorage.getItem('md_feed') || $('feedUrl').value;

    // Migration aus v2/v3: bisher wurden Logos nur pro Seite gespeichert.
    const legacyHome = localStorage.getItem('md_homeLogo');
    const legacyAway = localStorage.getItem('md_awayLogo');
    if (legacyHome) {
      const key = normalizeTeamKey($('homeTeam').value);
      if (key && !customLogos[key]) customLogos[key] = legacyHome;
    }
    if (legacyAway) {
      const key = normalizeTeamKey($('awayTeam').value);
      if (key && !customLogos[key]) customLogos[key] = legacyAway;
    }
    localStorage.setItem('md_teamLogos', JSON.stringify(customLogos));
  }

  function normalizeRoles() {
    const selected = players.filter(p => p.selected);
    if (!selected.some(p => p.name === captain)) captain = selected[0]?.name || '';
    if (libero && (!selected.some(p => p.name === libero) || libero === captain)) {
      libero = selected.find(p => p.name !== captain)?.name || '';
    }
  }

  function applyRosterRemovals() {
    const applied = readStorage('md_appliedRosterRemovals', []);
    const pending = projectData.removedPlayers.filter(name => !applied.includes(name));
    if (!pending.length) return;
    players = players.filter(player => !pending.includes(player.name));
    normalizeRoles();
    saveState();
    localStorage.setItem('md_appliedRosterRemovals', JSON.stringify([...new Set([...applied, ...pending])]));
  }

  function orderedRoster() {
    const selected = players.filter(p => p.selected);
    const result = [];
    const c = selected.find(p => p.name === captain);
    const l = selected.find(p => p.name === libero);
    if (c) result.push({ ...c, role: 'C' });
    if (l && (!c || l.name !== c.name)) result.push({ ...l, role: 'L' });
    selected
      .filter(p => (!c || p.name !== c.name) && (!l || p.name !== l.name))
      .sort((a, b) => numberValue(a.number) - numberValue(b.number))
      .forEach(p => result.push({ ...p, role: '' }));
    return result;
  }

  function numberValue(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits ? Number(digits) : 999;
  }

  function renderRosterControls() {
    const wrap = $('rosterList');
    wrap.innerHTML = '';
    players.forEach((p, i) => {
      const lab = document.createElement('label');
      lab.className = 'player-chip';
      lab.innerHTML = `<input type="checkbox" data-i="${i}" ${p.selected ? 'checked' : ''}><span>${escapeHtml(p.name)} <strong>#${escapeHtml(p.number)}</strong></span>`;
      wrap.appendChild(lab);
      lab.querySelector('input').addEventListener('change', e => {
        players[i].selected = e.target.checked;
        normalizeRoles();
        saveState();
        invalidateScene();
        renderRoleSelects();
        draw();
      });
    });

    const editor = $('playerEditor');
    editor.innerHTML = '';
    players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<label>Name<input data-k="name" value="${escapeAttr(p.name)}"></label><label>Nr.<input data-k="number" type="number" min="0" max="99" value="${escapeAttr(p.number)}"></label><button type="button" aria-label="Spieler löschen">×</button>`;
      row.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
        p[inp.dataset.k] = inp.dataset.k === 'number' ? Number(inp.value) : inp.value.trim();
        normalizeRoles();
        saveState();
        invalidateScene();
        renderRosterControls();
        draw();
      }));
      row.querySelector('button').addEventListener('click', () => {
        players.splice(i, 1);
        normalizeRoles();
        saveState();
        invalidateScene();
        renderRosterControls();
        draw();
      });
      editor.appendChild(row);
    });
    renderRoleSelects();
  }

  function renderRoleSelects() {
    normalizeRoles();
    const selected = players.filter(p => p.selected);
    [['captainSelect', captain], ['liberoSelect', libero]].forEach(([id, value]) => {
      const select = $(id);
      select.innerHTML = '';
      if (id === 'liberoSelect') {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Kein Libero';
        option.selected = !value;
        select.appendChild(option);
      }
      selected.forEach(p => {
        const option = document.createElement('option');
        option.value = p.name;
        option.textContent = `${p.name} (#${p.number})`;
        option.selected = p.name === value;
        select.appendChild(option);
      });
    });
  }

  function normalizeText(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function normalizeTeamKey(s) {
    return normalizeText(s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sameTeam(a, b) {
    const aa = normalizeTeamKey(a);
    const bb = normalizeTeamKey(b);
    if (!aa || !bb) return false;
    if (aa === bb) return true;
    // Die App ist für Herren 1 gebaut; VolleyManager kann das Team als "1" oder "H1" schreiben.
    if (aa.includes('vbc frauenfeld') && bb.includes('vbc frauenfeld')) return true;
    return false;
  }

  function isOwnHome() {
    if ($('matchType').value === 'home') return true;
    if ($('matchType').value === 'away') return false;
    return sameTeam($('homeTeam').value, $('ownTeam').value);
  }

  function updateHomeAway() {
    $('homeAwayBadge').textContent = isOwnHome() ? 'HEIMSPIEL' : 'AUSWÄRTSSPIEL';
  }

  function displayTeamName(name) {
    if (sameTeam(name, $('ownTeam').value)) {
      const key = normalizeTeamKey(name);
      if (/vbc frauenfeld( h?1| 1)?$/.test(key)) return 'VBC FRAUENFELD H1';
    }
    return (name || '').toUpperCase();
  }

  function builtinLogoSrc(teamName) {
    const key = normalizeTeamKey(teamName);
    for (const item of BUILTIN_LOGOS) {
      if (item.keys.some(k => key.includes(k))) return item.src;
    }
    return '';
  }

  function teamLogoSrc(teamName) {
    const key = normalizeTeamKey(teamName);
    return customLogos[key] || builtinLogoSrc(teamName) || '';
  }

  async function getImage(src) {
    if (!src) return null;
    if (imageCache.has(src)) return imageCache.get(src);
    const promise = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, promise);
    return promise;
  }

  function newCanvas() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  }

  function rgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
  }

  function hexToRgb(hex) {
    const raw = hex.replace('#', '');
    const n = parseInt(raw.length === 3 ? raw.split('').map(x => x + x).join('') : raw, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function mixHex(a, b, ratio) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const r = Math.round(A.r * (1 - ratio) + B.r * ratio);
    const g = Math.round(A.g * (1 - ratio) + B.g * ratio);
    const bl = Math.round(A.b * (1 - ratio) + B.b * ratio);
    return `#${[r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  function drawCover(context, img, width, height, centerX = 0.5, centerY = 0.5) {
    const scale = Math.max(width / img.width, height / img.height);
    const sw = width / scale;
    const sh = height / scale;
    const maxX = Math.max(0, img.width - sw);
    const maxY = Math.max(0, img.height - sh);
    const sx = maxX * centerX;
    const sy = maxY * centerY;
    context.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  }

  async function buildBase(roster) {
    const bg = await getImage(BACKGROUND_SRC);
    const profile = await getImage(PROFILE_LOGO_SRC);
    const c = newCanvas();
    const g = c.getContext('2d');

    g.save();
    g.filter = `contrast(1.15) saturate(0.82) brightness(${roster ? 0.88 : 0.84})`;
    if (bg) drawCover(g, bg, W, H, 0.50, roster ? 0.48 : 0.50);
    else { g.fillStyle = PRIMARY; g.fillRect(0, 0, W, H); }
    g.restore();

    // Violetter Original-Tint.
    g.fillStyle = rgba(PRIMARY, (roster ? 72 : 82) / 255);
    g.fillRect(0, 0, W, H);

    // Originale obere / untere Abschattung.
    const shade = g.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(4,0,10,.282)');
    shade.addColorStop(.25, 'rgba(4,0,10,0)');
    shade.addColorStop(.64, 'rgba(4,0,10,0)');
    shade.addColorStop(1, 'rgba(4,0,10,.376)');
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);

    // Atmosphäre aus renderer.py.
    drawBlurredEllipse(g, 620, -180, 1260, 490, rgba(ACCENT, 86 / 255));
    drawBlurredEllipse(g, -260, 1320, 360, 2020, rgba(ACCENT, 54 / 255));
    if (roster) drawBlurredEllipse(g, 740, 760, 1260, 1410, rgba(ACCENT, 38 / 255));

    g.strokeStyle = rgba(ELECTRIC, 12 / 255);
    g.lineWidth = 2;
    for (let offset = -H; offset < W + H; offset += 170) {
      g.beginPath();
      g.moveTo(offset, 0);
      g.lineTo(offset - H, H);
      g.stroke();
    }

    g.strokeStyle = rgba(ELECTRIC, 105 / 255);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(58, 204);
    g.lineTo(W - 58, 204);
    g.stroke();
    g.fillStyle = rgba(ELECTRIC, 225 / 255);
    g.beginPath();
    g.arc(58, 204, 4, 0, Math.PI * 2);
    g.fill();

    const lightning = [[980, -20], [890, 125], [925, 190], [798, 326], [842, 390], [720, 520]];
    g.lineJoin = 'round';
    drawPolyline(g, lightning, rgba(ACCENT, 45 / 255), 15);
    drawPolyline(g, lightning, rgba(ELECTRIC, 180 / 255), 3);

    g.font = fontSpec('displayLight', 315);
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillStyle = rgba(ELECTRIC, 12 / 255);
    g.fillText('H1', W - 76, roster ? 1170 : 1030);

    // Rundes Instagram-H1-Logo inkl. Glow.
    if (profile) {
      const glow = g.createRadialGradient(W / 2, 214, 10, W / 2, 214, 110);
      glow.addColorStop(0, rgba(ACCENT, 95 / 255));
      glow.addColorStop(.55, rgba(ACCENT, 35 / 255));
      glow.addColorStop(1, rgba(ACCENT, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(W / 2, 214, 112, 0, Math.PI * 2);
      g.fill();

      g.save();
      g.beginPath();
      g.arc(W / 2, 212, 72, 0, Math.PI * 2);
      g.clip();
      drawCoverInto(g, profile, W / 2 - 72, 140, 144, 144);
      g.restore();
    }

    return c;
  }

  function drawBlurredEllipse(g, left, top, right, bottom, color) {
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = (right - left) / 2;
    const ry = (bottom - top) / 2;
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    const grad = g.createRadialGradient(0, 0, rx * 0.05, 0, 0, rx * 1.15);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(168,85,247,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, rx * 1.15, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawPolyline(g, points, stroke, width) {
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.beginPath();
    points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.stroke();
  }

  function drawCoverInto(g, img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const sw = w / scale;
    const sh = h / scale;
    g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  function layer(drawFn, bbox) {
    const c = newCanvas();
    drawFn(c.getContext('2d'));
    return { canvas: c, bbox };
  }

  function fontSpec(kind, size) {
    if (kind === 'displayLight') return `300 ${size}px ${FONT_DISPLAY}`;
    if (kind === 'display') return `400 ${size}px ${FONT_DISPLAY}`;
    if (kind === 'displayMedium') return `500 ${size}px ${FONT_DISPLAY}`;
    if (kind === 'strong') return `700 ${size}px ${FONT_TEXT}`;
    if (kind === 'bold') return `600 ${size}px ${FONT_TEXT}`;
    if (kind === 'medium') return `500 ${size}px ${FONT_TEXT}`;
    return `400 ${size}px ${FONT_TEXT}`;
  }

  function fitFont(g, text, kind, maximum, minimum, maxWidth) {
    for (let size = maximum; size >= minimum; size -= 2) {
      g.font = fontSpec(kind, size);
      if (g.measureText(text).width <= maxWidth) return size;
    }
    return minimum;
  }

  function outlinedText(g, text, x, y, kind, size, fill, stroke, strokeWidth, align = 'center') {
    g.font = fontSpec(kind, size);
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    if (strokeWidth > 0) {
      g.strokeStyle = stroke;
      g.lineWidth = strokeWidth * 2;
      g.strokeText(text, x, y);
    }
    g.fillStyle = fill;
    g.fillText(text, x, y);
  }

  function roundedPanel(g, x, y, w, h, radius, fill, outline, width = 2) {
    g.beginPath();
    g.roundRect(x, y, w, h, radius);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (outline) { g.strokeStyle = outline; g.lineWidth = width; g.stroke(); }
  }

  function drawWhiteLogo(g, img, centerX, centerY, maxW, maxH) {
    if (!img) return;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    const temp = document.createElement('canvas');
    temp.width = Math.max(1, Math.ceil(w));
    temp.height = Math.max(1, Math.ceil(h));
    const t = temp.getContext('2d');
    t.drawImage(img, 0, 0, temp.width, temp.height);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = '#fff';
    t.fillRect(0, 0, temp.width, temp.height);
    g.drawImage(temp, centerX - temp.width / 2, centerY - temp.height / 2);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return dateStr.toUpperCase();
    const days = ['SONNTAG', 'MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG'];
    const date = new Date(Date.UTC(y, m - 1, d));
    return `${days[date.getUTCDay()]}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
  }

  function venueLines() {
    const joined = [$('venue').value.trim(), $('address').value.trim()].filter(Boolean).join(' · ');
    const parts = joined.replace(/\|/g, '·').split('·').map(x => x.trim().toUpperCase()).filter(Boolean);
    if (parts.length >= 3) return [parts[0], parts.slice(1).join(' · ')];
    if (parts.length === 2) return parts;
    return [joined.toUpperCase()];
  }

  function buildMatchLayers(homeLogo, awayLogo) {
    const home = displayTeamName($('homeTeam').value);
    const away = displayTeamName($('awayTeam').value);
    const matchType = isOwnHome() ? 'HEIMSPIEL' : 'AUSWÄRTSSPIEL';
    const league = ($('competition').value || '').toUpperCase();

    const header = layer(g => {
      const title = 'MATCHDAY';
      const titleSize = fitFont(g, title, 'displayLight', 128, 90, 952);
      outlinedText(g, title, W / 2, 390, 'displayLight', titleSize, 'rgba(255,255,255,.094)', 'rgba(255,255,255,.902)', 1.5);

      const kindSize = fitFont(g, matchType, 'strong', 70, 48, 910);
      outlinedText(g, matchType, W / 2, 502, 'strong', kindSize, '#fff', 'rgba(0,0,0,0)', 0);
      g.font = fontSpec('strong', kindSize);
      const lineWidth = Math.min(540, g.measureText(matchType).width + 94);
      g.fillStyle = rgba(ELECTRIC, 235 / 255);
      g.beginPath();
      g.roundRect(W / 2 - lineWidth / 2, 553, lineWidth, 7, 3);
      g.fill();

      const leagueSize = fitFont(g, league, 'regular', 33, 24, 850);
      outlinedText(g, league, W / 2, 597, 'regular', leagueSize, 'rgba(230,218,240,.882)', 'rgba(0,0,0,0)', 0);
    }, [45, 305, 1035, 625]);

    const logos = layer(g => {
      const frames = [[117, 704, 387, 974], [693, 704, 963, 974]];
      for (const [left, top, right, bottom] of frames) {
        roundedPanel(g, left, top, right - left, bottom - top, 28, 'rgba(5,1,12,.274)', 'rgba(255,255,255,.886)', 4);
        roundedPanel(g, left + 12, top + 12, right - left - 24, bottom - top - 24, 19, null, rgba(ELECTRIC, 105 / 255), 2);
      }
      drawWhiteLogo(g, homeLogo, 252, 839, 174, 174);
      drawWhiteLogo(g, awayLogo, 828, 839, 174, 174);
    }, [105, 692, 975, 986]);

    const versus = layer(g => {
      const size = fitFont(g, 'VS', 'displayMedium', 77, 48, 210);
      outlinedText(g, 'VS', W / 2, 839, 'displayMedium', size, rgba(ELECTRIC, 1), 'rgba(10,2,18,.863)', 1);
    }, [440, 770, 640, 910]);

    const teamNames = layer(g => {
      const longest = home.length >= away.length ? home : away;
      const size = fitFont(g, longest, 'bold', 51, 36, 470);
      outlinedText(g, home, 248, 1085, 'bold', size, '#fff', 'rgba(6,1,12,.745)', .5);
      outlinedText(g, away, 832, 1085, 'bold', size, '#fff', 'rgba(6,1,12,.745)', .5);
    }, [0, 1020, 1080, 1145]);

    const datePanel = layer(g => {
      roundedPanel(g, 54, 1195, W - 108, 340, 38, 'rgba(7,2,14,.439)', rgba(ACCENT, 126 / 255), 2);
    }, [52, 1193, 1028, 1537]);

    const dateText = layer(g => {
      const date = formatDate($('date').value).toUpperCase();
      const sharedSize = fitFont(g, date, 'displayMedium', 100, 70, 900);
      outlinedText(g, date, W / 2, 1300, 'displayMedium', sharedSize, '#fff', 'rgba(6,1,12,.745)', .5);
      g.strokeStyle = rgba(ELECTRIC, 130 / 255);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(210, 1375);
      g.lineTo(W - 210, 1375);
      g.stroke();
      const timeText = `${$('time').value || ''} UHR`.trim();
      outlinedText(g, timeText, W / 2, 1465, 'displayMedium', sharedSize, rgba(ELECTRIC, 1), 'rgba(6,1,12,.745)', .5);
    }, [120, 1230, 960, 1525]);

    const venue = layer(g => {
      const lines = venueLines();
      const longest = lines.reduce((a, b) => a.length >= b.length ? a : b, '');
      const size = fitFont(g, longest, 'bold', 42, 33, 900);
      g.font = fontSpec('bold', size);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(240,232,247,.973)';
      g.strokeStyle = 'rgba(6,1,12,.706)';
      g.lineWidth = 2;
      const lineGap = size + 14;
      const total = (lines.length - 1) * lineGap;
      lines.forEach((lineText, i) => {
        const y = 1625 - total / 2 + i * lineGap;
        g.strokeText(lineText, W / 2, y);
        g.fillText(lineText, W / 2, y);
      });
    }, [50, 1550, 1030, 1710]);

    return { header, logos, versus, teamNames, datePanel, dateText, venue };
  }

  function rosterLayout(roster) {
    if (!roster.length) return { rows: [], panelBounds: null };
    const rows = roster.length;
    const innerLeft = 205;
    const innerRight = W - 205;
    const columnWidth = innerRight - innerLeft;
    const availableHeight = 1088;
    const rowHeight = Math.min(126, Math.floor(availableHeight / rows));
    const top = 548;
    const panelBounds = [170, 530, W - 170, top + rowHeight * rows + 24];
    return {
      panelBounds,
      rows: roster.map((player, index) => ({ player, x: innerLeft, y: top + index * rowHeight, width: columnWidth, height: rowHeight }))
    };
  }

  function buildRosterLayers(roster) {
    const { rows, panelBounds } = rosterLayout(roster);
    const title = layer(g => {
      const text = 'KADER';
      const size = fitFont(g, text, 'displayLight', 142, 76, 900);
      outlinedText(g, text, W / 2, 390, 'displayLight', size, 'rgba(255,255,255,.094)', 'rgba(255,255,255,.902)', 1.5);
    }, [175, 305, 905, 465]);

    const coach = layer(g => {
      const label = 'COACH';
      const labelSize = fitFont(g, label, 'strong', 28, 20, 135);
      outlinedText(g, label, 202, 485, 'strong', labelSize, rgba(ELECTRIC, 245 / 255), 'rgba(0,0,0,0)', 0, 'left');
      const name = ($('coach').value || '').toUpperCase();
      const nameSize = fitFont(g, name, 'bold', 42, 31, 520);
      outlinedText(g, name, 346, 485, 'bold', nameSize, 'rgba(255,255,255,.98)', 'rgba(0,0,0,0)', 0, 'left');
    }, [180, 445, 920, 525]);

    const panel = panelBounds ? layer(g => {
      const [left, top, right, bottom] = panelBounds;
      roundedPanel(g, left, top, right - left, bottom - top, 38, 'rgba(5,1,12,.376)', rgba(ACCENT, 105 / 255), 2);
    }, panelBounds.map((value, index) => value + (index < 2 ? -2 : 2))) : null;

    const playerLayers = rows.map(({ player, x, y, width, height }) => layer(g => {
      const centerY = y + height / 2;
      g.strokeStyle = 'rgba(255,255,255,.118)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y + height - 4);
      g.lineTo(x + width, y + height - 4);
      g.stroke();

      const label = `${player.name.toUpperCase()}${player.role ? ` (${player.role})` : ''}`;
      const nameX = x + 24;
      const numberX = x + width - 24;
      const nameSizeMax = Math.max(31, Math.min(57, Math.round(height * 0.50)));
      const numberSizeMax = Math.max(32, Math.min(58, Math.round(height * 0.52)));
      const maxNameWidth = numberX - nameX - 150;
      const nameSize = fitFont(g, label, 'bold', nameSizeMax, 29, maxNameWidth);
      outlinedText(g, label, nameX, centerY, 'bold', nameSize, 'rgba(255,255,255,.98)', 'rgba(0,0,0,0)', 0, 'left');
      const nr = String(player.number);
      const nrSize = fitFont(g, nr, 'displayMedium', numberSizeMax, 32, 90);
      outlinedText(g, nr, numberX, centerY, 'displayMedium', nrSize, '#fff', 'rgba(6,1,12,.706)', .5, 'right');
    }, [x, y, x + width, y + height]));

    return { title, coach, panel, panelBounds, playerLayers };
  }

  async function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.all([
        document.fonts.load('300 128px "Oswald"'),
        document.fonts.load('400 100px "Oswald"'),
        document.fonts.load('500 100px "Oswald"'),
        document.fonts.load('400 42px "Montserrat"'),
        document.fonts.load('500 42px "Montserrat"'),
        document.fonts.load('600 57px "Montserrat"'),
        document.fonts.load('700 70px "Montserrat"')
      ]);
    } catch (_) {
      // Fallback fonts remain available if the web fonts cannot load.
    }
  }

  async function getScene() {
    await ensureFonts();
    if (sceneCache && sceneCacheRevision === sceneRevision) return sceneCache;
    if (!baseMatch || !baseRoster) {
      [baseMatch, baseRoster] = await Promise.all([getImage(BASE_MATCH_SRC), getImage(BASE_ROSTER_SRC)]);
    }
    const homeLogo = await getImage(teamLogoSrc($('homeTeam').value));
    const awayLogo = await getImage(teamLogoSrc($('awayTeam').value));
    const roster = orderedRoster();
    const scene = {
      baseMatch,
      baseRoster,
      match: buildMatchLayers(homeLogo, awayLogo),
      roster: buildRosterLayers(roster),
      rosterData: roster
    };
    sceneCache = scene;
    sceneCacheRevision = sceneRevision;
    return scene;
  }

  function compositeLayer(target, item, opacity = 1) {
    if (!item || opacity <= 0) return;
    target.save();
    target.globalAlpha = clamp(opacity);
    target.drawImage(item.canvas, 0, 0);
    target.restore();
  }

  function compositeAllMatch(target, scene) {
    const m = scene.match;
    [m.header, m.logos, m.versus, m.teamNames, m.datePanel, m.dateText, m.venue].forEach(x => compositeLayer(target, x, 1));
  }

  function compositeAllRoster(target, scene) {
    const r = scene.roster;
    compositeLayer(target, r.title, 1);
    compositeLayer(target, r.coach, 1);
    compositeLayer(target, r.panel, 1);
    r.playerLayers.forEach(x => compositeLayer(target, x, 1));
  }

  function drawLayerSmooth(target, item, progress, { fromDy = 0, fromScale = 1, gentle = false } = {}) {
    if (!item || progress <= 0) return;
    const [x1, y1, x2, y2] = item.bbox;
    const w = x2 - x1;
    const h = y2 - y1;
    const eased = gentle ? easeInOut(progress) : easeOut(progress);
    const scale = fromScale + (1 - fromScale) * eased;
    const dy = fromDy * (1 - eased);
    const opacity = gentle ? easeInOut(progress) : easeOut(segment(progress, 0, .72));
    const dw = w * scale;
    const dh = h * scale;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 + dy;
    target.save();
    target.globalAlpha = opacity;
    target.drawImage(item.canvas, x1, y1, w, h, cx - dw / 2, cy - dh / 2, dw, dh);
    target.restore();
  }

  function revealFromTop(target, item, progress, fromDy = 0) {
    if (!item || progress <= 0) return;
    const [x1, y1, x2, y2] = item.bbox;
    const w = x2 - x1;
    const h = y2 - y1;
    const eased = easeOut(progress);
    const visible = Math.max(1, h * eased);
    const opacity = easeOut(segment(progress, 0, .72));
    target.save();
    target.globalAlpha = opacity;
    target.drawImage(item.canvas, x1, y1, w, visible, x1, y1 + fromDy * (1 - eased), w, visible);
    target.restore();
  }

  function drawCinematicBase(target, base, phase) {
    const progress = easeInOut(segment(phase, 0, 4.50 / 5.40));
    const scale = 1.035 + (1 - 1.035) * progress;
    const dw = W * scale;
    const dh = H * scale;
    target.drawImage(base, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  function animateMatch(target, scene, phase) {
    target.clearRect(0, 0, W, H);
    drawCinematicBase(target, scene.baseMatch, phase);
    const m = scene.match;

    revealFromTop(target, m.header, segment(phase, 0.00, 1.20 / 5.40), 24);
    const matchupProgress = segment(phase, 1.30 / 5.40, 2.90 / 5.40);
    drawLayerSmooth(target, m.logos, matchupProgress, { fromScale: .97, gentle: true });
    drawLayerSmooth(target, m.versus, matchupProgress, { fromScale: .97, gentle: true });
    drawLayerSmooth(target, m.teamNames, matchupProgress, { fromDy: 10, gentle: true });

    const infoOpacity = easeInOut(segment(phase, 2.30 / 5.40, 3.70 / 5.40));
    compositeLayer(target, m.datePanel, infoOpacity);
    compositeLayer(target, m.dateText, infoOpacity);
    compositeLayer(target, m.venue, infoOpacity);

    const fadeEnd = .50 / 5.40;
    if (phase < fadeEnd) {
      const visible = easeOut(phase / fadeEnd);
      target.save();
      target.globalAlpha = 1 - visible;
      target.fillStyle = 'rgb(3,0,8)';
      target.fillRect(0, 0, W, H);
      target.restore();
    }
  }

  function morphPanel(target, progress, panelBounds) {
    const p = clamp(progress);
    const s = [54, 1195, W - 54, 1535];
    if (!panelBounds) {
      target.save();
      target.globalAlpha *= 1 - p;
      roundedPanel(target, s[0], s[1], s[2] - s[0], s[3] - s[1], 38, 'rgba(7,2,14,.439)', rgba(ACCENT, 126 / 255), 2);
      target.restore();
      return;
    }
    const t = panelBounds;
    const box = s.map((v, i) => lerp(v, t[i], p));
    const fillA = [7, 2, 14, 112 / 255];
    const fillB = [5, 1, 12, 96 / 255];
    const alphaOutlineA = 126 / 255;
    const alphaOutlineB = 105 / 255;
    const fill = `rgba(${Math.round(lerp(fillA[0], fillB[0], p))},${Math.round(lerp(fillA[1], fillB[1], p))},${Math.round(lerp(fillA[2], fillB[2], p))},${lerp(fillA[3], fillB[3], p)})`;
    const outline = rgba(ACCENT, lerp(alphaOutlineA, alphaOutlineB, p));
    roundedPanel(target, box[0], box[1], box[2] - box[0], box[3] - box[1], 38, fill, outline, 2);

    const energy = Math.max(0, 1 - Math.abs(p - .5) / .5);
    if (energy > .02) {
      target.save();
      target.shadowColor = rgba(ACCENT, 110 / 255 * energy);
      target.shadowBlur = 20;
      roundedPanel(target, box[0], box[1], box[2] - box[0], box[3] - box[1], 38, null, rgba(ACCENT, 110 / 255 * energy), 4);
      target.restore();
    }
  }

  function transitionFrame(target, scene, ratio) {
    target.clearRect(0, 0, W, H);
    const motion = segment(ratio, .16, .92);
    const sceneProgress = easeInOut(motion);
    target.drawImage(scene.baseMatch, 0, 0);
    target.save();
    target.globalAlpha = sceneProgress;
    target.drawImage(scene.baseRoster, 0, 0);
    target.restore();

    const matchOpacity = 1 - easeOut(segment(ratio, 0, .30));
    const m = scene.match;
    [m.header, m.logos, m.versus, m.teamNames, m.venue].forEach(x => compositeLayer(target, x, matchOpacity));

    morphPanel(target, motion, scene.roster.panelBounds);
    compositeLayer(target, m.dateText, matchOpacity);
    drawLayerSmooth(target, scene.roster.title, segment(ratio, .30, .92), { fromDy: 26, fromScale: .985 });
  }

  function rosterPhase(elapsed, total, hold) {
    total = Math.max(.2, total);
    hold = Math.max(0, Math.min(hold, total - .2));
    const animationSeconds = Math.max(.2, total - hold);
    if (elapsed >= animationSeconds - 1e-9) return 1;
    return clamp(elapsed / animationSeconds);
  }

  function animateRoster(target, scene, phase) {
    target.clearRect(0, 0, W, H);
    target.drawImage(scene.baseRoster, 0, 0);
    const r = scene.roster;
    compositeLayer(target, r.panel, 1);
    compositeLayer(target, r.title, 1);
    drawLayerSmooth(target, r.coach, segment(phase, 0, .16), { fromDy: 16 });
    r.playerLayers.forEach((row, index) => {
      const start = .06 + index * .076;
      const progress = segment(phase, start, start + .18);
      drawLayerSmooth(target, row, progress, { fromDy: 20, fromScale: .995 });
    });
  }

  async function draw() {
    updateHomeAway();
    const scene = await getScene();
    ctx.clearRect(0, 0, W, H);
    if (previewMode === 'match') {
      ctx.drawImage(scene.baseMatch, 0, 0);
      compositeAllMatch(ctx, scene);
    } else {
      ctx.drawImage(scene.baseRoster, 0, 0);
      compositeAllRoster(ctx, scene);
    }
  }

  function segment(value, start, end) {
    if (end <= start) return value >= end ? 1 : 0;
    return clamp((value - start) / (end - start));
  }

  function clamp(v, lo = 0, hi = 1) { return Math.min(hi, Math.max(lo, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(v) { v = clamp(v); return 1 - Math.pow(1 - v, 3); }
  function easeInOut(v) { v = clamp(v); return v * v * (3 - 2 * v); }

  function populateEvents({ apply = true } = {}) {
    const select = $('eventSelect');
    select.innerHTML = '<option value="">Manuelle Angaben / neues Spiel</option>';
    if (!parsedEvents.length) {
      selectedEventId = '';
      $('feedStatus').textContent = 'Keine Spiele gespeichert';
      return;
    }
    parsedEvents.forEach((e, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = `${e.date} ${e.time || ''} · ${e.homeTeam} – ${e.awayTeam}`;
      select.appendChild(o);
    });
    const now = Data.dateParts(new Date(), projectData.timezone);
    const key = now.date + now.time;
    let next = parsedEvents.findIndex(e => e.id === selectedEventId);
    if (next < 0 && !apply) next = parsedEvents.findIndex(e => e.date === $('date').value && e.homeTeam === $('homeTeam').value && e.awayTeam === $('awayTeam').value);
    if (next < 0 && !apply) {
      select.value = '';
      selectedEventId = '';
      $('feedStatus').textContent = `${parsedEvents.length} Spiele`;
      return;
    }
    if (next < 0) next = parsedEvents.findIndex(e => (e.date + (e.time || '23:59')) >= key);
    if (next < 0) next = Math.max(0, parsedEvents.length - 1);
    select.value = String(next);
    selectedEventId = parsedEvents[next].id;
    $('feedStatus').textContent = `${parsedEvents.length} Spiele`;
    if (apply) applyEvent(next);
  }

  function applyEvent(index) {
    if (index === '') { selectedEventId = ''; localStorage.removeItem('md_selectedEventId'); return; }
    const e = parsedEvents[Number(index)];
    if (!e) return;
    selectedEventId = e.id;
    localStorage.setItem('md_selectedEventId', e.id);
    ['homeTeam', 'awayTeam', 'date', 'time', 'venue', 'address'].forEach(key => { $(key).value = e[key] || ''; });
    $('matchType').value = e.matchType || 'auto';
    $('competition').value = e.competition || projectData.team.competition;
    saveState();
    invalidateScene();
    draw();
  }

  async function attemptFeed() {
    const url = $('feedUrl').value.trim();
    localStorage.setItem('md_feed', url);
    $('feedStatus').textContent = 'lade…';
    try {
      const r = await fetch(url, { cache: 'no-store', mode: 'cors' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      parsedEvents = Data.parseICS(t, projectData.timezone);
      selectedEventId = '';
      scheduleSource = { url, importedAt: new Date().toISOString() };
      populateEvents();
      persistEvents();
      $('dataStatus').textContent = 'VolleyManager-Spiele geladen. Exportiere die Daten, um den gemeinsamen Spielplan zu aktualisieren.';
      $('feedStatus').textContent = `${parsedEvents.length} Spiele`;
    } catch (err) {
      $('feedStatus').textContent = 'Abruf blockiert';
      $('icsFallback').open = true;
      $('renderStatus').textContent = 'VolleyManager blockiert den Direktabruf in diesem Browser. Tippe auf „Feed öffnen“, speichere die .ics-Datei und lies sie hier ein.';
    }
  }

  function canvasBlob(type = 'image/png', quality = .95) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
  }

  async function shareBlob(blob, name, title = 'Matchday') {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title, files: [file] });
      return true;
    }
    downloadBlob(blob, name);
    return false;
  }

  async function renderVideo() {
    const button = $('renderVideoBtn');
    button.disabled = true;
    $('videoResult').hidden = true;
    $('renderStatus').textContent = 'Original-Animation wird vorbereitet…';
    const name = `matchday-${$('date').value || 'story'}.mp4`;
    try {
      if (!globalThis.MatchdayVideo) throw new Error('Videoexport konnte nicht geladen werden. Bitte die App neu laden.');
      const scene = await getScene();
      const result = await MatchdayVideo.encodeCanvas({
        width: W, height: H, fps: 30, duration: TOTAL_SECONDS,
        onProgress: progress => {
          $('renderStatus').textContent = `Video wird erstellt · ${Math.round(progress * 100)} % · ${TOTAL_SECONDS.toFixed(1)} s…`;
        },
        drawFrame: (target, seconds) => {
          if (seconds < MATCH_SECONDS) {
            animateMatch(target, scene, seconds / MATCH_SECONDS);
          } else if (seconds < MATCH_SECONDS + TRANSITION_SECONDS) {
            transitionFrame(target, scene, (seconds - MATCH_SECONDS) / TRANSITION_SECONDS);
          } else {
            const elapsed = seconds - MATCH_SECONDS - TRANSITION_SECONDS;
            animateRoster(target, scene, rosterPhase(elapsed, ROSTER_SECONDS, ROSTER_HOLD_SECONDS));
          }
        }
      });
      if (renderedVideoUrl) URL.revokeObjectURL(renderedVideoUrl);
      renderedVideoBlob = result.blob;
      renderedVideoName = name;
      renderedVideoUrl = URL.createObjectURL(result.blob);
      $('videoPreview').src = renderedVideoUrl;
      $('videoResult').hidden = false;
      $('renderStatus').textContent = `Fertig – MP4 · ${result.duration.toFixed(1)} s. Tippe auf „Video speichern“ oder „Video teilen“.`;
    } catch (error) {
      $('renderStatus').textContent = `Video konnte nicht erstellt werden: ${error.message}`;
    } finally {
      button.disabled = false;
      draw();
    }
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function assignUploadedLogo(file, teamName) {
    if (!file || !teamName.trim()) return;
    const data = await readFileAsDataURL(file);
    customLogos[normalizeTeamKey(teamName)] = data;
    localStorage.setItem('md_teamLogos', JSON.stringify(customLogos));
    invalidateScene();
    draw();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  applyTeamDefaults();
  restore();
  scheduleSource = readStorage('md_scheduleSource', scheduleSource);
  populateEvents({ apply: !readStorage('md_match', null) });
  applyRosterRemovals();
  renderRosterControls();
  updateHomeAway();

  matchFields.forEach(id => $(id).addEventListener('input', () => {
    if (id === 'matchType') return;
    saveState();
    invalidateScene();
    draw();
  }));

  $('matchType').addEventListener('change', () => {
    const type = $('matchType').value;
    const ownHome = sameTeam($('homeTeam').value, $('ownTeam').value);
    const ownAway = sameTeam($('awayTeam').value, $('ownTeam').value);
    if ((type === 'home' && ownAway && !ownHome) || (type === 'away' && ownHome && !ownAway)) {
      [$('homeTeam').value, $('awayTeam').value] = [$('awayTeam').value, $('homeTeam').value];
    }
    saveState();
    invalidateScene();
    draw();
  });

  $('captainSelect').addEventListener('change', e => {
    captain = e.target.value;
    if (libero && libero === captain) libero = players.find(p => p.selected && p.name !== captain)?.name || '';
    saveState();
    invalidateScene();
    renderRoleSelects();
    draw();
  });
  $('liberoSelect').addEventListener('change', e => {
    libero = e.target.value;
    if (libero && captain === libero) captain = players.find(p => p.selected && p.name !== libero)?.name || captain;
    saveState();
    invalidateScene();
    renderRoleSelects();
    draw();
  });
  $('addPlayerBtn').addEventListener('click', () => {
    players.push({ name: 'Neuer Spieler', number: 0, selected: true });
    saveState();
    invalidateScene();
    renderRosterControls();
    draw();
  });
  $('selectAllBtn').addEventListener('click', () => {
    players.forEach(p => p.selected = true);
    normalizeRoles();
    saveState();
    invalidateScene();
    renderRosterControls();
    draw();
  });
  $('selectNoneBtn').addEventListener('click', () => {
    players.forEach(p => p.selected = false);
    normalizeRoles();
    saveState();
    invalidateScene();
    renderRosterControls();
    draw();
  });

  $('previewMatchBtn').addEventListener('click', () => {
    previewMode = 'match';
    $('previewLabel').textContent = 'MATCHDAY';
    $('previewMatchBtn').classList.add('active');
    $('previewRosterBtn').classList.remove('active');
    draw();
  });
  $('previewRosterBtn').addEventListener('click', () => {
    previewMode = 'roster';
    $('previewLabel').textContent = 'KADER';
    $('previewRosterBtn').classList.add('active');
    $('previewMatchBtn').classList.remove('active');
    draw();
  });

  $('exportPngBtn').addEventListener('click', async () => {
    await draw();
    downloadBlob(await canvasBlob(), previewMode === 'match' ? '01_matchdaten.png' : '02_kader.png');
  });
  $('sharePngBtn').addEventListener('click', async () => {
    await draw();
    const blob = await canvasBlob();
    const name = previewMode === 'match' ? '01_matchdaten.png' : '02_kader.png';
    try { await shareBlob(blob, name, 'Matchday'); } catch (_) { downloadBlob(blob, name); }
  });
  $('renderVideoBtn').addEventListener('click', renderVideo);
  $('saveVideoBtn').addEventListener('click', () => {
    if (!renderedVideoBlob || !renderedVideoName) {
      $('renderStatus').textContent = 'Bitte zuerst ein Video erstellen.';
      return;
    }
    downloadBlob(renderedVideoBlob, renderedVideoName);
    $('renderStatus').textContent = 'Download gestartet. Schau in Chrome → Downloads oder Eigene Dateien → Downloads.';
  });
  $('shareVideoBtn').addEventListener('click', async () => {
    if (!renderedVideoBlob || !renderedVideoName) {
      $('renderStatus').textContent = 'Bitte zuerst ein Video erstellen.';
      return;
    }
    try {
      const file = new File([renderedVideoBlob], renderedVideoName, { type: renderedVideoBlob.type || 'application/octet-stream' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: 'Matchday Video', files: [file] });
        $('renderStatus').textContent = 'Teilen-Menü geöffnet.';
      } else {
        downloadBlob(renderedVideoBlob, renderedVideoName);
        $('renderStatus').textContent = 'Teilen wird nicht unterstützt – Download wurde gestartet.';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        $('renderStatus').textContent = 'Teilen abgebrochen. Das Video bleibt unten verfügbar.';
      } else {
        $('renderStatus').textContent = 'Teilen fehlgeschlagen. Tippe auf „Video speichern“.';
      }
    }
  });

  $('loadFeedBtn').addEventListener('click', attemptFeed);
  $('openFeedBtn').addEventListener('click', () => {
    const u = $('feedUrl').value.trim();
    if (u) window.open(u, '_blank', 'noopener');
  });
  $('parseIcsBtn').addEventListener('click', async () => {
    try {
      let text = $('icsText').value;
      const file = $('icsFile').files[0];
      if (file) text = await file.text();
      parsedEvents = Data.parseICS(text, projectData.timezone);
      selectedEventId = '';
      scheduleSource = { url: $('feedUrl').value.trim(), importedAt: new Date().toISOString() };
      populateEvents();
      persistEvents();
      $('dataStatus').textContent = 'Spielplan importiert. Exportiere die Daten für die gemeinsame Datei.';
    } catch (error) { $('dataStatus').textContent = error.message; }
  });
  $('eventSelect').addEventListener('change', e => applyEvent(e.target.value));

  $('saveEventBtn').addEventListener('click', () => {
    try { saveCurrentEvent(); }
    catch (error) { $('dataStatus').textContent = error.message; }
  });
  $('newEventBtn').addEventListener('click', () => {
    selectedEventId = '';
    $('eventSelect').value = '';
    ['homeTeam', 'awayTeam', 'date', 'time', 'venue', 'address'].forEach(key => { $(key).value = ''; });
    $('homeTeam').value = $('ownTeam').value;
    $('matchType').value = 'auto';
    $('competition').value = projectData.team.competition;
    saveState();
    localStorage.removeItem('md_selectedEventId');
    invalidateScene();
    draw();
  });
  $('deleteEventBtn').addEventListener('click', () => {
    if (!selectedEventId) { $('dataStatus').textContent = 'Bitte zuerst ein gespeichertes Spiel auswählen.'; return; }
    parsedEvents = parsedEvents.filter(event => event.id !== selectedEventId);
    selectedEventId = '';
    populateEvents();
    persistEvents();
    $('dataStatus').textContent = 'Spiel auf diesem Gerät entfernt. Exportiere die Daten für die gemeinsame Datei.';
  });
  $('exportDataBtn').addEventListener('click', () => {
    try {
      const blob = new Blob([JSON.stringify(currentData(), null, 2) + '\n'], { type: 'application/json' });
      downloadBlob(blob, 'app-data.json');
      $('dataStatus').textContent = 'Datendatei exportiert: Spielplan, Kader und Teamangaben.';
    } catch (error) { $('dataStatus').textContent = error.message; }
  });
  $('importDataFile').addEventListener('change', async event => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      useData(JSON.parse(await file.text()));
      $('dataStatus').textContent = `${parsedEvents.length} Spiele und ${players.length} Spieler aus der Datei übernommen.`;
    } catch (error) { $('dataStatus').textContent = 'Import fehlgeschlagen: ' + error.message; }
    finally { event.target.value = ''; }
  });
  $('loadProjectDataBtn').addEventListener('click', async () => {
    try { useData(await loadProjectData()); }
    catch (error) { $('dataStatus').textContent = error.message; }
  });

  $('homeLogo').addEventListener('change', async e => assignUploadedLogo(e.target.files[0], $('homeTeam').value));
  $('awayLogo').addEventListener('change', async e => assignUploadedLogo(e.target.files[0], $('awayTeam').value));
  $('resetLogosBtn').addEventListener('click', () => {
    customLogos = {};
    localStorage.removeItem('md_teamLogos');
    localStorage.removeItem('md_homeLogo');
    localStorage.removeItem('md_awayLogo');
    invalidateScene();
    draw();
    $('renderStatus').textContent = 'Eigene Logo-Zuordnungen gelöscht. Bekannte Gegnerlogos werden wieder automatisch verwendet.';
  });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    $('installBtn').hidden = false;
  });
  $('installBtn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('installBtn').hidden = true;
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  Promise.all([getImage(BASE_MATCH_SRC), getImage(BASE_ROSTER_SRC)]).then(async ([matchBase, rosterBase]) => {
    baseMatch = matchBase;
    baseRoster = rosterBase;
    await ensureFonts();
    invalidateScene();
    draw();
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      invalidateScene();
      draw();
    }).catch(() => {});
  }
})();
