(() => {
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

  const BUILTIN_LOGOS = [
    { keys: ['vbc frauenfeld'], src: OWN_LOGO_SRC },
    { keys: ['volley amriswil'], src: 'assets/logos/volley_amriswil.png' },
    { keys: ['volley butschwil', 'volley buetschwil'], src: 'assets/logos/volley_buetschwil.png' },
    { keys: ['stadtturnverein wil', 'stv wil'], src: 'assets/logos/stadtturnverein_wil.png' },
    { keys: ['vbc seuzach'], src: 'assets/logos/vbc_seuzach.png' },
    { keys: ['tv felben wellhausen', 'felben wellhausen'], src: 'assets/logos/tv_felben_wellhausen.png' },
    { keys: ['vbr rickenbach', 'rickenbach'], src: 'assets/logos/vbr_rickenbach.png' },
    { keys: ['vc smash winterthur', 'smash winterthur'], src: 'assets/logos/vc_smash_winterthur.png' },
    { keys: ['tv warth weiningen', 'warth weiningen'], src: 'assets/logos/tv_warth_weiningen.png' },
    { keys: ['vbc schaffhausen'], src: 'assets/logos/vbc_schaffhausen.png' }
  ];

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
  let parsedEvents = [];
  let renderedVideoBlob = null;
  let renderedVideoName = '';
  let renderedVideoUrl = '';
  let sceneRevision = 0;
  let sceneCache = null;
  let sceneCacheRevision = -1;

  let players = JSON.parse(localStorage.getItem('md_players') || 'null') || [
    { name: 'Giovanni', number: 6, selected: true },
    { name: 'Kevin', number: 21, selected: true },
    { name: 'Matthäus', number: 2, selected: true },
    { name: 'Luan', number: 5, selected: true },
    { name: 'Mike', number: 7, selected: true },
    { name: 'Raschad', number: 8, selected: true },
    { name: 'Cameron', number: 9, selected: true },
    { name: 'Rohan', number: 10, selected: true },
    { name: 'Maurice', number: 12, selected: true },
    { name: 'Jan', number: 13, selected: true },
    { name: 'Zaki', number: 20, selected: true }
  ];
  let captain = localStorage.getItem('md_captain') || 'Giovanni';
  let libero = localStorage.getItem('md_libero') || 'Kevin';
  let customLogos = JSON.parse(localStorage.getItem('md_teamLogos') || '{}');

  const matchFields = ['homeTeam', 'awayTeam', 'date', 'time', 'venue', 'address', 'competition', 'ownTeam', 'coach'];

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
    const obj = JSON.parse(localStorage.getItem('md_match') || 'null');
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
    if (!selected.some(p => p.name === libero)) {
      libero = selected.find(p => p.name !== captain)?.name || selected[0]?.name || '';
    }
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
    const rows = Math.max(1, roster.length);
    const innerLeft = 205;
    const innerRight = W - 205;
    const columnWidth = innerRight - innerLeft;
    const availableHeight = 1088;
    const rowHeight = Math.min(126, Math.floor(availableHeight / rows));
    const top = 548 + Math.max(0, Math.floor((availableHeight - rowHeight * rows) / 2));
    return roster.map((player, index) => ({ player, x: innerLeft, y: top + index * rowHeight, width: columnWidth, height: rowHeight }));
  }

  function buildRosterLayers(roster) {
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

    const panel = layer(g => {
      roundedPanel(g, 170, 530, W - 340, 1130, 38, 'rgba(5,1,12,.376)', rgba(ACCENT, 105 / 255), 2);
    }, [168, 528, 912, 1662]);

    const playerLayers = rosterLayout(roster).map(({ player, x, y, width, height }) => layer(g => {
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

    return { title, coach, panel, playerLayers };
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

  function morphPanel(target, progress) {
    const p = clamp(progress);
    const s = [54, 1195, W - 54, 1535];
    const t = [170, 530, W - 170, 1660];
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

    morphPanel(target, motion);
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

  function parseICS(text) {
    const unfolded = (text || '').replace(/\r?\n[ \t]/g, '');
    const blocks = unfolded.split('BEGIN:VEVENT').slice(1).map(x => x.split('END:VEVENT')[0]);
    return blocks.map((b, idx) => {
      const get = key => {
        const m = b.match(new RegExp('^' + key + '(?:;[^:]*)?:(.*)$', 'mi'));
        return m ? m[1].trim() : '';
      };
      const summary = decodeIcs(get('SUMMARY'));
      const location = decodeIcs(get('LOCATION'));
      const dt = get('DTSTART');
      let date = '', time = '';
      const dm = dt.match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/);
      if (dm) {
        date = `${dm[1]}-${dm[2]}-${dm[3]}`;
        if (dm[4]) time = `${dm[4]}:${dm[5] || '00'}`;
      }
      let home = '', away = '';
      const clean = summary.replace(/\s+/g, ' ').trim();
      const separators = [' - ', ' – ', ' — ', ' vs. ', ' vs ', ' VS '];
      for (const sep of separators) {
        if (clean.includes(sep)) {
          const parts = clean.split(sep);
          if (parts.length >= 2) {
            home = parts[0].trim();
            away = parts.slice(1).join(sep).trim();
            break;
          }
        }
      }
      return { id: idx, summary, location, date, time, home, away };
    }).filter(e => e.summary || e.date).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }

  function decodeIcs(s) {
    return (s || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }

  function populateEvents() {
    const select = $('eventSelect');
    select.innerHTML = '';
    if (!parsedEvents.length) {
      select.innerHTML = '<option value="">Keine Spiele gefunden</option>';
      return;
    }
    parsedEvents.forEach((e, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = `${e.date || 'Datum?'} ${e.time || ''} · ${e.summary}`;
      select.appendChild(o);
    });
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let next = parsedEvents.findIndex(e => (e.date || '9999-99-99') >= key);
    if (next < 0) next = Math.max(0, parsedEvents.length - 1);
    select.value = String(next);
    applyEvent(next);
  }

  function splitLocation(loc) {
    const value = (loc || '').trim();
    if (!value) return ['', ''];
    const parts = value.split(/\s*[|;]\s*|\s+-\s+(?=\d{4}\b)/).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts.slice(1).join(' · ')];
    const dot = value.split('·').map(x => x.trim()).filter(Boolean);
    if (dot.length >= 2) return [dot[0], dot.slice(1).join(' · ')];
    return [value, ''];
  }

  function applyEvent(index) {
    const e = parsedEvents[Number(index)];
    if (!e) return;
    if (e.home) $('homeTeam').value = e.home;
    if (e.away) $('awayTeam').value = e.away;
    if (e.date) $('date').value = e.date;
    if (e.time) $('time').value = e.time;
    const [venue, address] = splitLocation(e.location);
    if (venue) $('venue').value = venue;
    if (address) $('address').value = address;
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
      parsedEvents = parseICS(t);
      populateEvents();
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
    $('renderStatus').textContent = 'Original-Animation wird vorbereitet…';

    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
      $('renderStatus').textContent = 'Dieser Browser unterstützt den Videoexport nicht.';
      button.disabled = false;
      return;
    }

    const scene = await getScene();
    const fps = 30;
    const stream = canvas.captureStream(fps);
    let mime = '';
    ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].some(type => {
      if (MediaRecorder.isTypeSupported(type)) { mime = type; return true; }
      return false;
    });
    if (!mime) {
      $('renderStatus').textContent = 'Auf diesem Handy wurde kein unterstütztes Videoformat gefunden.';
      button.disabled = false;
      return;
    }

    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9_000_000 });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const finished = new Promise(resolve => recorder.onstop = resolve);
    recorder.start(250);

    const start = performance.now();
    $('renderStatus').textContent = `Video wird erstellt · ${TOTAL_SECONDS.toFixed(1)} s…`;

    while (true) {
      const seconds = (performance.now() - start) / 1000;
      if (seconds >= TOTAL_SECONDS) break;
      if (seconds < MATCH_SECONDS) {
        animateMatch(ctx, scene, seconds / MATCH_SECONDS);
      } else if (seconds < MATCH_SECONDS + TRANSITION_SECONDS) {
        const ratio = (seconds - MATCH_SECONDS) / TRANSITION_SECONDS;
        transitionFrame(ctx, scene, ratio);
      } else {
        const elapsed = seconds - MATCH_SECONDS - TRANSITION_SECONDS;
        animateRoster(ctx, scene, rosterPhase(elapsed, ROSTER_SECONDS, ROSTER_HOLD_SECONDS));
      }
      await new Promise(r => requestAnimationFrame(r));
    }

    // Letzten vollständigen Kaderframe sicher aufnehmen.
    animateRoster(ctx, scene, 1);
    await new Promise(r => setTimeout(r, 80));
    recorder.stop();
    await finished;

    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: mime });
    const name = `matchday-${$('date').value || 'story'}.${ext}`;

    // Android/Chrome verliert während der 11.2-s-Generierung die ursprüngliche
    // Nutzeraktivierung. Ein automatischer Download oder Share-Aufruf kann dann
    // lautlos blockiert werden. Darum speichern wir das Ergebnis zunächst im
    // Speicher und zeigen anschließend explizite Buttons an, die der Nutzer
    // mit einem zweiten Tap auslöst.
    if (renderedVideoUrl) URL.revokeObjectURL(renderedVideoUrl);
    renderedVideoBlob = blob;
    renderedVideoName = name;
    renderedVideoUrl = URL.createObjectURL(blob);
    $('videoPreview').src = renderedVideoUrl;
    $('videoResult').hidden = false;
    $('renderStatus').textContent = `Fertig – ${ext.toUpperCase()} erstellt. Tippe jetzt auf „Video speichern“ oder „Video teilen“.`;
    button.disabled = false;
    draw();
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

  restore();
  renderRosterControls();
  updateHomeAway();

  matchFields.forEach(id => $(id).addEventListener('input', () => {
    saveState();
    invalidateScene();
    draw();
  }));

  $('captainSelect').addEventListener('change', e => {
    captain = e.target.value;
    if (libero === captain) libero = players.find(p => p.selected && p.name !== captain)?.name || libero;
    saveState();
    invalidateScene();
    renderRoleSelects();
    draw();
  });
  $('liberoSelect').addEventListener('change', e => {
    libero = e.target.value;
    if (captain === libero) captain = players.find(p => p.selected && p.name !== libero)?.name || captain;
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
    let text = $('icsText').value;
    const file = $('icsFile').files[0];
    if (file) text = await file.text();
    parsedEvents = parseICS(text);
    populateEvents();
    $('feedStatus').textContent = `${parsedEvents.length} Spiele`;
  });
  $('eventSelect').addEventListener('change', e => applyEvent(e.target.value));

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
