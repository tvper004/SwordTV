import {
  CATEGORIES,
  LIVE_SUBCATEGORIES,
  CHANNELS as BASE_CHANNELS,
  MOVIES as BASE_MOVIES,
  SERIES as BASE_SERIES,
  ANIME as BASE_ANIME,
  SPORTS_MATCHES as BASE_SPORTS,
  KIDS as BASE_KIDS,
  NOVELAS as BASE_NOVELAS,
  UHD_ITEMS as BASE_UHD,
  MUSIC_ITEMS as BASE_MUSIC,
  DOCS_ITEMS as BASE_DOCS
} from './data.js';
import {
  loadCachedCatalogs,
  syncAllCatalogs,
  getLastSyncInfo,
  generateLimaSportsMatches,
  findExactTitleMatch,
  getCatalogTitleVariants,
  formatSeriesSeasonList,
  parseM3UChannels,
  streamMatchesEpisode,
  canonicalizeCatalogPoster,
  syncPortalLiveChannels,
  mapPortalItem
} from './catalog_sync.js';

const IMPORTED_CHANNELS_KEY = 'swordtv_imported_channels_v1';
const CHANNEL_CHECKS_KEY = 'swordtv_channel_checks_v1';
const CHANNEL_CHECK_MAX_AGE = 24 * 60 * 60 * 1000;

// Dynamic catalogs that update on every application launch
export let CHANNELS = [...BASE_CHANNELS];
export let MOVIES = [...BASE_MOVIES];
export let SERIES = [...BASE_SERIES];
export let ANIME = [...BASE_ANIME];
export let KIDS = [...BASE_KIDS];
export let NOVELAS = [...(BASE_NOVELAS || [])];
export let UHD_ITEMS = [...(BASE_UHD || [])];
export let SPORTS_MATCHES = generateLimaSportsMatches();
export let MUSIC_ITEMS = [...BASE_MUSIC];
export let DOCS_ITEMS = [...BASE_DOCS];

// Mutable container for sync engine
export const dynamicCatalogs = {
  movies: MOVIES,
  series: SERIES,
  anime: ANIME,
  kids: KIDS,
  novelas: NOVELAS,
  uhd: UHD_ITEMS,
  sports: SPORTS_MATCHES,
  music: MUSIC_ITEMS,
  docs: DOCS_ITEMS
};

function canonicalizeCatalogPosters(items) {
  items.forEach(canonicalizeCatalogPoster);
}

export function logAppAction(action, details = {}, category = 'UI') {
  const ts = new Date().toISOString();
  console.log(`[${category}] ${action}`, details);
  try {
    fetch('http://127.0.0.1:11472/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, action, details, timestamp: ts })
    }).catch(() => {});
  } catch (_) {}
}

function channelUrlKey(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function readChannelChecks() {
  try {
    return JSON.parse(localStorage.getItem(CHANNEL_CHECKS_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function getRecentChannelChecks(now = Date.now()) {
  return Object.fromEntries(Object.entries(readChannelChecks()).filter(([, check]) =>
    check && now - check.checkedAt <= CHANNEL_CHECK_MAX_AGE
  ));
}

function refreshChannelMetrics() {
  const checks = getRecentChannelChecks();
  const checked = CHANNELS.filter(channel => checks[channel.id]);
  const online = checked.filter(channel => checks[channel.id].ok).length;
  const offline = checked.length - online;
  const totalEl = document.getElementById('val-metric-total');
  const onlineEl = document.getElementById('val-metric-online');
  const offlineEl = document.getElementById('val-metric-offline');
  const badgeText = document.getElementById('val-badge-text');
  if (totalEl) totalEl.textContent = CHANNELS.length.toLocaleString();
  if (onlineEl) onlineEl.textContent = online.toLocaleString();
  if (offlineEl) offlineEl.textContent = offline.toLocaleString();
  if (badgeText) badgeText.textContent = `${checked.length.toLocaleString()}/${CHANNELS.length.toLocaleString()} canales revisados`;
  const filterText = document.getElementById('btn-filter-text');
  if (filterText) {
    filterText.textContent = localStorage.getItem('swordtv_filter_offline') === 'true'
      ? `Ocultando ${offline.toLocaleString()} canales sin respuesta`
      : `Ocultar ${offline.toLocaleString()} canales sin respuesta`;
  }
}

async function reviewChannels() {
  if (!window.__TAURI__?.core?.invoke) {
    showToast('La revisión de señales está disponible en la aplicación instalada.');
    return;
  }
  const buttons = ['btn-run-validator', 'btn-validate-channels']
    .map(id => document.getElementById(id)).filter(Boolean);
  const progressBox = document.getElementById('validator-progress-box');
  const progressFill = document.getElementById('val-progress-fill');
  const progressLabel = document.getElementById('val-progress-label');
  const channelStatus = document.getElementById('channel-validator-progress');
  const checks = readChannelChecks();
  let done = 0;
  let online = 0;
  let offline = 0;
  const total = CHANNELS.length;

  buttons.forEach(button => {
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = '⏳ Revisando señales…';
  });
  if (progressBox) progressBox.style.display = 'block';
  if (channelStatus) channelStatus.style.display = 'block';

  const update = () => {
    const percent = total ? Math.round((done / total) * 100) : 100;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressLabel) progressLabel.textContent = `Revisados ${done.toLocaleString()}/${total.toLocaleString()} • Responden ${online.toLocaleString()} • Sin respuesta ${offline.toLocaleString()}`;
    if (channelStatus) channelStatus.textContent = `Progreso real: ${done.toLocaleString()}/${total.toLocaleString()} canales • ${online.toLocaleString()} responden • ${offline.toLocaleString()} sin respuesta.`;
    refreshChannelMetrics();
  };

  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < total) {
      const channel = CHANNELS[nextIndex++];
      let check;
      try {
        check = await invoke('validate_channel_url', { url: channel.streamUrl });
      } catch (err) {
        check = { ok: false, reason: String(err) };
      }
      const result = { ...check, ok: check?.ok === true, checkedAt: Date.now() };
      checks[channel.id] = result;
      if (result.ok) online++;
      else offline++;
      done++;
      if (done % 20 === 0 || done === total) {
        try { localStorage.setItem(CHANNEL_CHECKS_KEY, JSON.stringify(checks)); } catch (err) { console.warn('[IPTV] Could not save check results:', err); }
        update();
      }
    }
  };

  try {
    update();
    await Promise.all(Array.from({ length: Math.min(16, total) }, worker));
    try { localStorage.setItem(CHANNEL_CHECKS_KEY, JSON.stringify(checks)); } catch (err) { console.warn('[IPTV] Could not save check results:', err); }
    update();
    renderLiveChannels();
    showToast(`Revisión terminada: ${online} responden y ${offline} no respondieron ahora.`);
  } finally {
    buttons.forEach(button => {
      button.disabled = false;
      button.textContent = button.dataset.label || 'Revisar canales';
      delete button.dataset.label;
    });
  }
}

function recordChannelPlayback(channel, ok, reason = '') {
  if (!channel?.id) return;
  const checks = readChannelChecks();
  checks[channel.id] = { ok, reason, checkedAt: Date.now(), playback: true };
  try { localStorage.setItem(CHANNEL_CHECKS_KEY, JSON.stringify(checks)); } catch (_) {}
  refreshChannelMetrics();
}

function loadImportedChannels() {
  try {
    const imported = JSON.parse(localStorage.getItem(IMPORTED_CHANNELS_KEY) || '[]');
    const knownUrls = new Set(CHANNELS.map(channel => channelUrlKey(channel.streamUrl)).filter(Boolean));
    for (const channel of imported) {
      const key = channelUrlKey(channel.streamUrl);
      if (!key || typeof channel.name !== 'string' || !channel.name.trim() || knownUrls.has(key)) continue;
      knownUrls.add(key);
      CHANNELS.push(channel);
    }
  } catch (err) {
    console.warn('[IPTV] Could not restore imported channels:', err);
  }
}

function canonicalizeAllCatalogPosters() {
  canonicalizeCatalogPosters([
    ...MOVIES, ...SERIES, ...ANIME, ...KIDS, ...NOVELAS, ...UHD_ITEMS, ...MUSIC_ITEMS, ...DOCS_ITEMS
  ]);
}

// Application State
const state = {
  currentCategory: 'live',
  currentLiveSubcat: 'all',
  currentChannel: null,
  activeVodItem: null,
  hlsLive: null,
  hlsVod: null,
  favorites: [],
  history: [],
  settings: {
    language: 'es',
    aspect_ratio: 'auto',
    preferred_quality: '1080p',
    parental_control_enabled: false,
    parental_control_pin: '0000',
    hardware_acceleration: true,
    auto_sync_catalog: true,
  },
  aspectRatios: ['auto', '16:9', '4:3', 'fill'],
  currentAspectIndex: 0,
  osdHideTimeout: null,
  vodOsdHideTimeout: null,
  isAdultUnlocked: false,
  isSyncingCatalog: false,
  windowFullscreen: false,
  liveFrameWatchdog: null,
};

// Tauri Bridge helper
const invoke = async (cmd, args = {}) => {
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    try {
      return await window.__TAURI__.core.invoke(cmd, args);
    } catch (e) {
      console.warn(`Tauri invoke '${cmd}' failed:`, e);
    }
  }
  return fallbackInvoke(cmd, args);
};

const fallbackInvoke = (cmd, args) => {
  switch (cmd) {
    case 'get_settings': {
      const saved = localStorage.getItem('swordtv_settings');
      return saved ? JSON.parse(saved) : state.settings;
    }
    case 'save_settings': {
      localStorage.setItem('swordtv_settings', JSON.stringify(args.newSettings));
      return true;
    }
    case 'get_favorites': {
      const saved = localStorage.getItem('swordtv_favs');
      return saved ? JSON.parse(saved) : [];
    }
    case 'toggle_favorite': {
      const favs = JSON.parse(localStorage.getItem('swordtv_favs') || '[]');
      const idx = favs.findIndex(f => f.id === args.item.id);
      let isFav = false;
      if (idx >= 0) {
        favs.splice(idx, 1);
      } else {
        favs.push(args.item);
        isFav = true;
      }
      localStorage.setItem('swordtv_favs', JSON.stringify(favs));
      return isFav;
    }
    case 'get_history': {
      const hist = localStorage.getItem('swordtv_hist');
      return hist ? JSON.parse(hist) : [];
    }
    case 'save_history': {
      const hist = JSON.parse(localStorage.getItem('swordtv_hist') || '[]');
      const idx = hist.findIndex(h => h.id === args.item.id);
      if (idx >= 0) hist.splice(idx, 1);
      hist.unshift(args.item);
      if (hist.length > 50) hist.pop();
      localStorage.setItem('swordtv_hist', JSON.stringify(hist));
      return true;
    }
    case 'toggle_fullscreen': {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
      return true;
    }
    default:
      return null;
  }
};

async function saveHistoryItem(item) {
  if (!item?.id) return;
  const entry = { ...item, last_watched: Date.now() };
  state.history = [entry, ...state.history.filter(saved => saved.id !== entry.id)].slice(0, 50);
  await invoke('save_history', { item: entry });
}

async function toggleFullscreen() {
  await invoke('toggle_fullscreen');
  if (window.__TAURI__?.core?.invoke) {
    state.windowFullscreen = !state.windowFullscreen;
    document.documentElement.classList.toggle('player-fullscreen', state.windowFullscreen);
  }
}

// Toast notification helper
function showToast(text, duration = 2400) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// Clock updater
function startClock() {
  const clockEl = document.getElementById('clock-display');
  const update = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  update();
  setInterval(update, 1000);
}

// Initialize Application
async function initApp() {
  try { startClock(); } catch (e) { console.error('Clock error:', e); }
  try { await loadStoredData(); } catch (e) { console.error('Storage error:', e); }
  try { loadCachedCatalogs(dynamicCatalogs); } catch (e) { console.error('Cache load error:', e); }
  try {
    const cachedLive = JSON.parse(localStorage.getItem('swordtv_portal_live_channels_v2') || '[]');
    if (Array.isArray(cachedLive) && cachedLive.length > 0) {
      const existing = new Set(CHANNELS.map(c => c.channelCode || c.id));
      const toAdd = cachedLive.filter(c => !existing.has(c.channelCode));
      CHANNELS.push(...toAdd);
      CHANNELS.sort((a, b) => (Number(a.num) || 9999) - (Number(b.num) || 9999));
    }
  } catch (_) {}
  try { canonicalizeAllCatalogPosters(); loadImportedChannels(); } catch (e) { console.error('Catalog repair error:', e); }
  try { setupNavigation(); } catch (e) { console.error('Nav error:', e); }
  try { setupLiveSection(); } catch (e) { console.error('Live section error:', e); }
  try { setupMoviesSection(); } catch (e) { console.error('Movies error:', e); }
  try { setupSeriesSection(); } catch (e) { console.error('Series error:', e); }
  try { setupAnimeSection(); } catch (e) { console.error('Anime error:', e); }
  try { setupKidsSection(); } catch (e) { console.error('Kids error:', e); }
  try { setupNovelasSection(); } catch (e) { console.error('Novelas error:', e); }
  try { setupUhdSection(); } catch (e) { console.error('UHD error:', e); }
  try { setupSportsSection(); } catch (e) { console.error('Sports error:', e); }
  try { setupMusicSection(); } catch (e) { console.error('Music error:', e); }
  try { setupDocsSection(); } catch (e) { console.error('Docs error:', e); }
  try { setupFavoritesSection(); } catch (e) { console.error('Fav error:', e); }
  try { setupSettingsSection(); } catch (e) { console.error('Settings error:', e); }
  try { setupCatalogSyncUI(); } catch (e) { console.error('Catalog sync UI error:', e); }
  try { setupVideoPlayers(); } catch (e) { console.error('Video players error:', e); }
  try { setupGlobalShortcuts(); } catch (e) { console.error('Shortcuts error:', e); }
  try { setupSearch(); } catch (e) { console.error('Search error:', e); }
  try { setupWindowDrag(); } catch (e) { console.error('Drag error:', e); }
  try { setupTrackControls(); } catch (e) { console.error('Track controls error:', e); }

  // Play default channel
  if (CHANNELS.length > 0) {
    try {
      playLiveChannel(CHANNELS[0], true);
    } catch (e) {
      console.error('Initial channel play error:', e);
    }
  }

  // Auto-update catalogs every time the app opens (background non-blocking)
  setTimeout(() => {
    triggerStartupCatalogSync(false);
  }, 400);

  // Global click anywhere unmutes audio if it was blocked by autoplay
  document.body.addEventListener('click', () => {
    const liveVideo = document.getElementById('live-video');
    const banner = document.getElementById('audio-unlock-banner');
    if (liveVideo && liveVideo.muted && banner && banner.style.display !== 'none') {
      liveVideo.muted = false;
      banner.style.display = 'none';
      document.getElementById('live-mute-btn').textContent = '🔊';
    }
  }, { once: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Load settings, favorites and history
async function loadStoredData() {
  try {
    const loadedSettings = await invoke('get_settings');
    if (loadedSettings) state.settings = { ...state.settings, ...loadedSettings };
    state.favorites = (await invoke('get_favorites')) || [];
    state.history = (await invoke('get_history')) || [];
  } catch (err) {
    console.error('Error loading stored data:', err);
  }
}

// Setup Two-Row Navigation Bar (Dos Filas en la Parte Superior)
function setupNavigation() {
  const row1 = document.getElementById('nav-row-1');
  const row2 = document.getElementById('nav-row-2');
  row1.innerHTML = '';
  row2.innerHTML = '';

  const r1Cats = CATEGORIES.filter(c => c.row === 1).length > 0 
    ? CATEGORIES.filter(c => c.row === 1) 
    : CATEGORIES.slice(0, 6);
  const r2Cats = CATEGORIES.filter(c => c.row === 2).length > 0 
    ? CATEGORIES.filter(c => c.row === 2) 
    : CATEGORIES.slice(6, 12);

  r1Cats.forEach(cat => {
    row1.appendChild(createNavButton(cat));
  });

  r2Cats.forEach(cat => {
    row2.appendChild(createNavButton(cat));
  });

  // Brand logo click goes to Live
  document.getElementById('brand-logo-btn')?.addEventListener('click', () => {
    switchCategory('live');
  });

  // Fullscreen button
  document.getElementById('btn-fullscreen-toggle')?.addEventListener('click', () => {
    toggleFullscreen();
  });

  // Mobile collapsible top category panel (starts collapsed on mobile for maximum space)
  if (window.innerWidth <= 900) {
    document.body.classList.add('mobile-nav-collapsed');
  }
  document.getElementById('mobile-nav-toggle-btn')?.addEventListener('click', () => {
    document.body.classList.toggle('mobile-nav-collapsed');
  });

  updateFavCounterBadge();
}

function createNavButton(cat) {
  const btn = document.createElement('button');
  btn.className = `nav-cat-btn ${cat.id === state.currentCategory ? 'active' : ''}`;
  btn.id = `nav-btn-${cat.id}`;
  
  if (cat.id === 'favorites') {
    btn.innerHTML = `
      <span class="cat-icon">${cat.icon}</span>
      <span>${cat.name}</span>
      <span class="nav-fav-badge" id="nav-fav-count-pill">${state.favorites.length}</span>
    `;
  } else {
    btn.innerHTML = `<span class="cat-icon">${cat.icon}</span> <span>${cat.name}</span>`;
  }

  btn.addEventListener('click', () => switchCategory(cat.id));
  return btn;
}

function updateFavCounterBadge() {
  const pill = document.getElementById('nav-fav-count-pill');
  if (pill) pill.textContent = state.favorites.length;
}

// Switch Main Category View
function switchCategory(catId, targetChannel = null) {
  logAppAction('NAV_TAB_CHANGED', { tab: catId }, 'NAV');
  if (window.innerWidth <= 900) document.body.classList.add('mobile-nav-collapsed');
  // If VOD player is open, close it cleanly
  const overlay = document.getElementById('vod-player-overlay');
  if (overlay && (overlay.classList.contains('open') || overlay.classList.contains('active'))) {
    closeVodPlayer();
  }

  // Also close VOD detail modal if open
  const detailModal = document.getElementById('vod-detail-modal');
  if (detailModal) {
    detailModal.classList.remove('open');
    detailModal.classList.remove('active');
  }

  // Manage Live TV playback: pause when navigating away so sound does not play in background
  const liveVideo = document.getElementById('live-video');
  if (catId !== 'live') {
    if (liveVideo && !liveVideo.paused) {
      liveVideo.pause();
      const playBtn = document.getElementById('live-play-btn');
      if (playBtn) playBtn.textContent = '▶';
    }
  } else {
    // Returning to Live TV or tuning to target channel
    if (targetChannel) {
      playLiveChannel(targetChannel);
    } else if (state.currentChannel) {
      if (liveVideo && !liveVideo.paused) {
        // already playing
      } else {
        playLiveChannel(state.currentChannel);
      }
    }
  }

  state.currentCategory = catId;

  // Update tabs visual state
  document.querySelectorAll('.nav-cat-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`nav-btn-${catId}`);
  if (activeBtn) activeBtn.classList.add('active');

  // Switch view containers
  document.querySelectorAll('.view-container').forEach(view => {
    view.classList.remove('active');
  });

  const activeView = document.getElementById(`view-${catId === 'history' ? 'favorites' : catId}`);
  if (activeView) {
    activeView.classList.add('active');
    activeView.scrollTop = 0;
  }

  if (catId === 'favorites') {
    renderFavoritesView('all');
  } else if (catId === 'history') {
    renderFavoritesView('history');
  } else if (catId === 'novelas') {
    renderNovelasGrid(state.currentNovelasFilter || null);
  } else if (catId === 'uhd') {
    renderUhdGrid(state.currentUhdFilter || null);
  }
}

// ================= CHANNEL BADGE & STYLING HELPER ================= //
function getChannelBadge(ch) {
  const name = (ch.name || '').toLowerCase();
  let bg = 'linear-gradient(135deg, #0284c7, #0369a1)';
  let label = (ch.name || 'TV').substring(0, 3).toUpperCase();

  // 1. Canales Nacionales del Perú
  if (name.includes('panamericana')) {
    bg = 'linear-gradient(135deg, #d97706, #b45309)';
    label = 'P5';
  } else if (name.includes('américa') || name.includes('america')) {
    bg = 'linear-gradient(135deg, #ea580c, #c2410c)';
    label = 'A4';
  } else if (name.includes('latina') && !name.includes('clasicos')) {
    bg = 'linear-gradient(135deg, #9333ea, #6b21a8)';
    label = 'L2';
  } else if (name.includes('atv+')) {
    bg = 'linear-gradient(135deg, #dc2626, #991b1b)';
    label = 'ATV+';
  } else if (name.includes('atv')) {
    bg = 'linear-gradient(135deg, #0284c7, #0369a1)';
    label = 'ATV';
  } else if (name.includes('tv perú') || name.includes('tv peru')) {
    bg = 'linear-gradient(135deg, #e11d48, #be123c)';
    label = '7';
  } else if (name.includes('willax')) {
    bg = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
    label = 'W';
  } else if (name.includes('exitosa')) {
    bg = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    label = 'EX';
  } else if (name.includes('rpp')) {
    bg = 'linear-gradient(135deg, #eab308, #ca8a04)';
    label = 'RPP';
  // 2. Canales Premium Cable (HBO, Universal, Star, Warner, Sony, AXN, etc.)
  } else if (name.includes('hbo')) {
    bg = 'linear-gradient(135deg, #1e3a8a, #000000)';
    label = 'HBO';
  } else if (name.includes('universal') || name.includes('studio universal')) {
    bg = 'linear-gradient(135deg, #0284c7, #1e3a8a)';
    label = 'UNI';
  } else if (name.includes('star channel') || name.includes('star+')) {
    bg = 'linear-gradient(135deg, #ff007f, #7928ca)';
    label = 'STAR';
  } else if (name.includes('warner')) {
    bg = 'linear-gradient(135deg, #0284c7, #0f172a)';
    label = 'WB';
  } else if (name.includes('sony')) {
    bg = 'linear-gradient(135deg, #374151, #111827)';
    label = 'SONY';
  } else if (name.includes('axn')) {
    bg = 'linear-gradient(135deg, #dc2626, #450a0a)';
    label = 'AXN';
  } else if (name.includes('cinemax')) {
    bg = 'linear-gradient(135deg, #eab308, #ca8a04)';
    label = 'MAX';
  } else if (name.includes('cinecanal')) {
    bg = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
    label = 'CC';
  } else if (name.includes('tnt')) {
    bg = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    label = 'TNT';
  } else if (name.includes('space')) {
    bg = 'linear-gradient(135deg, #475569, #0f172a)';
    label = 'SPC';
  } else if (name.includes('fx')) {
    bg = 'linear-gradient(135deg, #ca8a04, #78350f)';
    label = 'FX';
  } else if (name.includes('espn')) {
    bg = 'linear-gradient(135deg, #dc2626, #991b1b)';
    label = 'ESPN';
  } else if (name.includes('dsports') || name.includes('directv sports')) {
    bg = 'linear-gradient(135deg, #2563eb, #1e3a8a)';
    label = 'DSP';
  } else if (name.includes('disney')) {
    bg = 'linear-gradient(135deg, #0284c7, #0369a1)';
    label = 'DISN';
  } else if (name.includes('cartoon') || name.includes('cartoonito')) {
    bg = 'linear-gradient(135deg, #000000, #374151)';
    label = 'CN';
  } else if (name.includes('nick') || name.includes('nickelodeon')) {
    bg = 'linear-gradient(135deg, #ea580c, #c2410c)';
    label = 'NICK';
  } else if (name.includes('discovery')) {
    bg = 'linear-gradient(135deg, #0284c7, #0f172a)';
    label = 'DISC';
  } else if (name.includes('history')) {
    bg = 'linear-gradient(135deg, #ca8a04, #78350f)';
    label = 'HIST';
  } else if (name.includes('nat geo') || name.includes('national geo')) {
    bg = 'linear-gradient(135deg, #eab308, #ca8a04)';
    label = 'NG';
  // 3. Canales Nacionales de España (24h debe comprobarse antes de tve 2)
  } else if (name.includes('24h') || name.includes('24 horas')) {
    bg = 'linear-gradient(135deg, #ff2a2a, #b30000)';
    label = '24h';
  } else if (name.includes('la 1') || name.includes('tve 1')) {
    bg = 'linear-gradient(135deg, #ff7a00, #ff4d00)';
    label = '1';
  } else if (name.includes('la 2') || (name.includes('tve 2') && !name.includes('tve 24'))) {
    bg = 'linear-gradient(135deg, #00c6ff, #0072ff)';
    label = '2';
  } else if (name.includes('teledeporte') || name.includes('tdp')) {
    bg = 'linear-gradient(135deg, #ff6a00, #ee0979)';
    label = 'tdp';
  } else if (name.includes('clan')) {
    bg = 'linear-gradient(135deg, #8a2387, #e94057)';
    label = 'clan';
  } else if (name.includes('dw ') || name.includes('deutsche')) {
    bg = 'linear-gradient(135deg, #1f2937, #111827)';
    label = 'DW';
  } else if (name.includes('toro')) {
    bg = 'linear-gradient(135deg, #991b1b, #450a0a)';
    label = '🐂';
  } else if (name.includes('antena 3') || name.includes('a3')) {
    bg = 'linear-gradient(135deg, #ff8c00, #e65100)';
    label = 'A3';
  } else if (name.includes('cuatro')) {
    bg = 'linear-gradient(135deg, #b71c1c, #880e4f)';
    label = 'C4';
  } else if (name.includes('telecinco') || name.includes('t5')) {
    bg = 'linear-gradient(135deg, #0288d1, #01579b)';
    label = '5';
  } else if (name.includes('lasexta') || name.includes('la sexta')) {
    bg = 'linear-gradient(135deg, #2e7d32, #1b5e20)';
    label = '6';
  // 4. Categorías Especiales
  } else if (ch.subcat === 'peru') {
    bg = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    label = 'PE';
  } else if (ch.subcat === 'deportes') {
    bg = 'linear-gradient(135deg, #10b981, #047857)';
    label = 'DEP';
  } else if (ch.subcat === 'noticias') {
    bg = 'linear-gradient(135deg, #ef4444, #b91c1c)';
    label = 'NOT';
  } else if (ch.subcat === 'musica') {
    bg = 'linear-gradient(135deg, #ec4899, #be185d)';
    label = 'MUS';
  } else if (ch.subcat === 'infantil') {
    bg = 'linear-gradient(135deg, #f59e0b, #d97706)';
    label = 'KID';
  } else if (ch.subcat === 'cultura') {
    bg = 'linear-gradient(135deg, #8b5cf6, #6d28d9)';
    label = 'CUL';
  }
  return { bg, label };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

// ================= LIVE TV CONTROLLER ================= //
function setupLiveSection() {
  const subnavContainer = document.getElementById('live-subnav-container');
  if (subnavContainer) {
    subnavContainer.innerHTML = '';
    LIVE_SUBCATEGORIES.forEach(sub => {
      const pill = document.createElement('button');
      pill.className = `subcat-pill ${sub.id === state.currentLiveSubcat ? 'active' : ''}`;
      pill.textContent = sub.label || sub.name || sub.id;
      pill.addEventListener('click', () => {
        if (sub.id === 'adultos' && state.settings.parental_control_enabled && !state.isAdultUnlocked) {
          showParentalPinModal(() => {
            state.isAdultUnlocked = true;
            selectLiveSubcat(sub.id);
          });
          return;
        }
        selectLiveSubcat(sub.id);
      });
      subnavContainer.appendChild(pill);
    });
  }

  // Quick filter tabs (Todos, Favoritos, Recientes)
  const tabAll = document.getElementById('filter-tab-all');
  const tabFavs = document.getElementById('filter-tab-favs');
  const tabRecents = document.getElementById('filter-tab-recents');

  const setFilterTab = (tab, mode) => {
    [tabAll, tabFavs, tabRecents].forEach(t => t?.classList.remove('active'));
    tab?.classList.add('active');
    state.currentLiveSubcat = mode;
    renderLiveChannels();
  };

  tabAll?.addEventListener('click', () => setFilterTab(tabAll, 'all'));
  tabFavs?.addEventListener('click', () => setFilterTab(tabFavs, 'favs'));
  tabRecents?.addEventListener('click', () => setFilterTab(tabRecents, 'recents'));

  // Sidebar Channel Search
  const chSearch = document.getElementById('channel-search-input');
  chSearch?.addEventListener('input', (e) => {
    state.channelSearchQuery = e.target.value.toLowerCase().trim();
    renderLiveChannels();
  });

  // Category toggle button (≡) — starts collapsed on mobile to maximize channel list space
  const catToggle = document.getElementById('channel-cat-toggle-btn');
  const subnavEl = document.getElementById('live-subnav-container');
  if (subnavEl && window.innerWidth <= 900) {
    subnavEl.classList.add('subnav-collapsed');
  }
  catToggle?.addEventListener('click', () => {
    if (!subnavEl) return;
    if (window.innerWidth <= 900) {
      subnavEl.classList.toggle('subnav-collapsed');
    } else {
      const isHidden = subnavEl.style.display === 'none';
      subnavEl.style.display = isHidden ? 'flex' : 'none';
    }
  });

  renderLiveChannels();
}

function selectLiveSubcat(subId) {
  logAppAction('SUBCAT_CHANGED', { subcategory: subId }, 'NAV');
  state.currentLiveSubcat = subId;
  document.querySelectorAll('.subcat-pill').forEach((pill, idx) => {
    pill.classList.toggle('active', LIVE_SUBCATEGORIES[idx]?.id === subId);
  });
  if (subId !== 'all' && subId !== 'favs' && subId !== 'recents') {
    document.querySelectorAll('.live-filter-tab').forEach(t => t?.classList.remove('active'));
  }
  renderLiveChannels();
}

// RENDER CHANNELS WITH FAVORITE PRIORITY SORTING & BRANDED LOGOS
function renderLiveChannels() {
  const listEl = document.getElementById('live-channels-container');
  if (!listEl) return;
  listEl.innerHTML = '';

  let channelsToShow = [];

  if (state.currentLiveSubcat === 'favs') {
    // Show only favorite channels
    channelsToShow = CHANNELS.filter(c => state.favorites.some(f => f.id === c.id));
    if (channelsToShow.length === 0) {
      listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px 10px; font-size: 13px;">No tienes canales marcados en Favoritos.<br><br>Haz clic en la estrella ☆ de cualquier canal para agregarlo aquí.</div>`;
      return;
    }
  } else if (state.currentLiveSubcat === 'recents') {
    // Show recently watched channels from history
    const liveHistIds = state.history.filter(h => h.category === 'live').map(h => h.id);
    channelsToShow = CHANNELS.filter(c => liveHistIds.includes(c.id));
    if (channelsToShow.length === 0) {
      channelsToShow = CHANNELS.slice(0, 15);
    }
  } else if (state.currentLiveSubcat === 'all' || state.currentLiveSubcat === 'todos') {
    // Sort channels so favorites come FIRST (PREFERENCIA)
    const favChannels = CHANNELS.filter(c => state.favorites.some(f => f.id === c.id));
    const otherChannels = CHANNELS.filter(c => !state.favorites.some(f => f.id === c.id));
    channelsToShow = [...favChannels, ...otherChannels];
  } else if (state.currentLiveSubcat === 'peru') {
    // Show Peruvian channels
    const subChannels = CHANNELS.filter(c => c.country === 'Perú' || c.subcat === 'peru');
    const favSub = subChannels.filter(c => state.favorites.some(f => f.id === c.id));
    const otherSub = subChannels.filter(c => !state.favorites.some(f => f.id === c.id));
    channelsToShow = [...favSub, ...otherSub];
  } else if (state.currentLiveSubcat === 'espana') {
    // Show Spanish TDT channels
    const subChannels = CHANNELS.filter(c => c.country === 'España');
    const favSub = subChannels.filter(c => state.favorites.some(f => f.id === c.id));
    const otherSub = subChannels.filter(c => !state.favorites.some(f => f.id === c.id));
    channelsToShow = [...favSub, ...otherSub];
  } else if (state.currentLiveSubcat === 'cine' || state.currentLiveSubcat === 'peliculas') {
    // Cine & Series (HBO, Universal, Star Channel, Warner, Sony, etc.)
    const subChannels = CHANNELS.filter(c => c.subcat === 'cine' || c.subcat === 'series' || c.subcat === 'peliculas');
    const favSub = subChannels.filter(c => state.favorites.some(f => f.id === c.id));
    const otherSub = subChannels.filter(c => !state.favorites.some(f => f.id === c.id));
    channelsToShow = [...favSub, ...otherSub];
  } else {
    // Subcategory: sort favorites first within subcategory
    const subChannels = CHANNELS.filter(c => c.subcat === state.currentLiveSubcat);
    const favSub = subChannels.filter(c => state.favorites.some(f => f.id === c.id));
    const otherSub = subChannels.filter(c => !state.favorites.some(f => f.id === c.id));
    channelsToShow = [...favSub, ...otherSub];
  }

  // Hide only recently checked failures; untested channels remain available.
  const isFilterOffline = localStorage.getItem('swordtv_filter_offline') === 'true';
  if (isFilterOffline) {
    const checks = getRecentChannelChecks();
    channelsToShow = channelsToShow.filter(channel => checks[channel.id]?.ok !== false);
  }

  // Filter by search query if typing in sidebar
  if (state.channelSearchQuery) {
    const q = state.channelSearchQuery;
    channelsToShow = channelsToShow.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.currentShow && c.currentShow.toLowerCase().includes(q)) ||
      String(c.num) === q
    );
  }

  if (channelsToShow.length === 0) {
    listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px 10px;">No se encontraron canales</div>`;
    return;
  }

  channelsToShow.forEach(ch => {
    const isFav = state.favorites.some(f => f.id === ch.id);
    const badge = getChannelBadge(ch);
    const card = document.createElement('div');
    card.className = `channel-card ${state.currentChannel?.id === ch.id ? 'active' : ''} ${isFav ? 'is-priority' : ''}`;
    card.id = `channel-card-${ch.id}`;
    card.innerHTML = `
      <div class="channel-num-badge">${escapeHtml(ch.num)}</div>
      <div class="channel-logo-badge" style="background: ${badge.bg};">${escapeHtml(badge.label)}</div>
      <div class="channel-info">
        <div class="channel-title-row">
          <span class="channel-title">${escapeHtml(ch.name)}</span>
          ${isFav ? '<span class="priority-tag">★ PREFERIDO</span>' : ''}
          <span class="channel-quality-badge">${escapeHtml(ch.quality || '1080p HD')}</span>
        </div>
        <div class="channel-show-now">▶ ${escapeHtml(ch.currentShow || 'Emisión en directo')}</div>
      </div>
      <button class="fav-btn ${isFav ? 'is-fav' : ''}" title="${isFav ? 'Quitar de Favoritos' : 'Añadir a Favoritos'}">
        ${isFav ? '★' : '☆'}
      </button>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.fav-btn')) return;
      playLiveChannel(ch);
    });

    const favBtn = card.querySelector('.fav-btn');
    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleFav({
        id: ch.id,
        title: ch.name,
        category: 'live',
        logo: ch.logo,
        stream_url: ch.streamUrl
      });
      renderLiveChannels();
      updateFavCounterBadge();
      updateOsdFavButton();
    });

    listEl.appendChild(card);
  });
}

let liveSwitchTimeout = null;
let liveSessionGen = 0;
let liveAbortController = null;

// PLAY LIVE CHANNEL WITH DEBOUNCE, SESSION GUARD & NATIVE WEBKIT HLS
function playLiveChannel(ch, immediate = false) {
  if (!ch) return;
  state.currentChannel = ch;

  // 1. Update UI selection immediately
  document.querySelectorAll('.channel-card').forEach(c => c.classList.remove('active'));
  const cardEl = document.getElementById(`channel-card-${ch.id}`);
  if (cardEl) {
    cardEl.classList.add('active');
    cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Update Now Playing Banner under video
  const npTitle = document.getElementById('now-playing-title');
  const npShow = document.getElementById('now-playing-show');
  const npLogo = document.getElementById('now-playing-logo');
  if (npTitle) npTitle.textContent = ch.name;
  if (npShow) npShow.textContent = ch.currentShow || 'Emisión en Directo';
  if (npLogo) {
    const badge = getChannelBadge(ch);
    npLogo.style.background = badge.bg;
    npLogo.textContent = badge.label;
  }

  // Update OSD info
  const osdName = document.getElementById('osd-channel-name');
  if (osdName) osdName.textContent = `${ch.num || ''}. ${ch.name}`;
  const osdShow = document.getElementById('osd-channel-show');
  if (osdShow) osdShow.textContent = `Ahora: ${ch.currentShow || 'En vivo'} • Siguiente: ${ch.nextShow || 'Transmisión continua'}`;
  updateOsdFavButton();

  // Cancel any pending debounced tune
  if (liveSwitchTimeout) {
    clearTimeout(liveSwitchTimeout);
    liveSwitchTimeout = null;
  }

  if (immediate) {
    executePlayLiveChannel(ch);
  } else {
    liveSwitchTimeout = setTimeout(() => {
      liveSwitchTimeout = null;
      executePlayLiveChannel(ch);
    }, 200);
  }
}

function normalizeChannelName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(?:hd|fhd|uhd|4k|sd|directo|en vivo|tv|canal|\+)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findBackupLiveChannel(failedCh, triedIds) {
  const targetNorm = normalizeChannelName(failedCh?.name);
  if (!targetNorm || targetNorm.length < 3) return null;
  const candidates = CHANNELS.filter(c => {
    if (!c || c.id === failedCh.id || triedIds.has(c.id)) return false;
    if (!c.channelCode && !c.code && !c.portal && !c.streamUrl) return false;
    const candNorm = normalizeChannelName(c.name);
    return candNorm === targetNorm || (candNorm.length >= 4 && (candNorm.includes(targetNorm) || targetNorm.includes(candNorm)));
  });
  // Prefer portal channels first as they resolve fresh CDN tokens
  candidates.sort((a, b) => Number(!!(b.channelCode || b.portal)) - Number(!!(a.channelCode || a.portal)));
  return candidates[0] || null;
}

async function executePlayLiveChannel(ch, triedIds = new Set()) {
  if (!ch) return;
  triedIds.add(ch.id);
  const currentGen = ++liveSessionGen;

  if (state.liveFrameWatchdog) clearInterval(state.liveFrameWatchdog);

  // Abort any prior in-flight live fetch
  if (liveAbortController) {
    try { liveAbortController.abort(); } catch (_) {}
  }
  liveAbortController = new AbortController();
  const signal = liveAbortController.signal;

  // Mutual exclusion: stop and close any VOD video completely if active
  if (state.activeVodItem || vodSession) {
    closeVodPlayer(false);
  }

  // Cleanly flush previous live video pipeline before loading new one
  const video = document.getElementById('live-video');
  const unlockBanner = document.getElementById('audio-unlock-banner');
  const idleEl = document.getElementById('live-player-idle');

  if (state.liveConnectionTimeout) {
    clearTimeout(state.liveConnectionTimeout);
    state.liveConnectionTimeout = null;
  }

  if (video) {
    video.pause();
    video.onplaying = null;
    video.onerror = null;
    video.onpause = null;
  }

  if (state.hlsLive) {
    try {
      state.hlsLive.stopLoad();
      state.hlsLive.detachMedia();
      state.hlsLive.destroy();
    } catch (_) {}
    state.hlsLive = null;
  }

  if (video) {
    video.removeAttribute('src');
    video.load();
  }
  window.__resetLiveTrackMenus?.();

  // Resolve channel stream via native portal engine if needed
  let code = ch.channelCode || ch.code || (ch.portal ? ch.id : null);
  const isPeruContext = ch.country === 'Perú' || ch.subcat === 'peru' || !ch.streamUrl;
  if (!code && ch.name && isPeruContext) {
    const norm = String(ch.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/^(?:america tv|america television)(?: (?:peru|hd)){0,2}$/.test(norm)) {
      code = 'cyx-AmericaTVHDPeru';
    }
    else if (norm.includes('latina')) code = 'cyx-LatinaHD';
    else if (norm.includes('panamericana')) code = 'cyx-Panamericana';
    else if (norm.includes('atv plus')) code = 'cyx_ATVPlusHD☆';
    else if (norm.includes('atv')) code = 'cyx-ATV';
    else if (norm.includes('willax')) code = 'cyx_79332479206523928186';
    else if (norm.includes('gol peru') || norm.includes('golperu')) code = 'cyx_FC0A2C7F15CA85B1B705152';
    else if (norm.includes('liga 1 max')) code = 'cyx_6033288258774519978098687511';
    else if (norm.includes('liga 1')) code = 'cyx_BD6B98AE72F0410A043A57B8';
    else if (norm.includes('canal n')) code = 'CanalN☆';
    else if (norm.includes('tv peru') || norm.includes('tvperu')) code = 'cyx-TVperu';
    else if (norm.includes('movistar deportes')) code = 'cyx-AD6412F44CA79ffe29A4CA4CA6CD';
    else if (norm.includes('tnt sports')) code = 'cyx-CDFHD';
    else if (norm.includes('win sports')) code = 'cyx_492310852366171011443815385';
    else if (norm.includes('rpp')) code = 'cyx_13E3C2E5BA362FB812E3EE';
    else if (norm.includes('exitosa')) code = 'cyx_3493777623654186599292010205';
  }

  logAppAction('CHANNEL_CLICKED', { id: ch.id, num: ch.num, name: ch.name, code: code || ch.channelCode }, 'LIVE');

  if (code) {
    try {
      logAppAction('CHANNEL_RESOLVING', { name: ch.name, code }, 'LIVE');
      const resp = await fetch(`http://127.0.0.1:11472/api/live/resolve?code=${encodeURIComponent(code)}`, { signal });
      const data = await resp.json();
      if (currentGen !== liveSessionGen) return; // User switched to another channel while resolving!
      if (data.ok && data.streamUrl) {
        logAppAction('CHANNEL_RESOLVED', { name: ch.name, streamUrl: data.streamUrl, relayUrl: data.relayUrl }, 'LIVE');
        ch.streamUrl = data.streamUrl;
        ch.relayUrl = data.relayUrl;
        ch.portal = true;
      } else {
        logAppAction('CHANNEL_RESOLVE_FAILED', { name: ch.name, error: data.error }, 'LIVE');
      }
    } catch (e) {
      if (e.name === 'AbortError' || currentGen !== liveSessionGen) return;
      logAppAction('CHANNEL_RESOLVE_NETWORK_ERROR', { name: ch.name, error: e.message }, 'LIVE');
      console.warn('[Live] Live stream resolve failed:', e);
    }
  } else if (ch.streamUrl && /^https?:\/\//i.test(ch.streamUrl) && !ch.streamUrl.startsWith('http://127.0.0.1:')) {
    // Route direct M3U/IPTV streams through local proxy (CORS, HTTP mixed-content, 302 redirects & relay fallback)
    try {
      const pResp = await fetch(`http://127.0.0.1:11472/api/live/proxy?url=${encodeURIComponent(ch.streamUrl)}`, { signal });
      const pData = await pResp.json();
      if (currentGen !== liveSessionGen) return;
      if (pData.ok && pData.streamUrl) {
        ch.rawStreamUrl = ch.rawStreamUrl || ch.streamUrl;
        ch.streamUrl = pData.streamUrl;
        ch.relayUrl = pData.relayUrl || '';
      }
    } catch (_) {}
  }

  if (currentGen !== liveSessionGen) return;

  if (!ch?.streamUrl || !channelUrlKey(ch.streamUrl)) {
    const backup = findBackupLiveChannel(ch, triedIds);
    if (backup) {
      logAppAction('CHANNEL_FAILOVER_BACKUP', { from: ch.name, to: backup.name }, 'LIVE');
      return executePlayLiveChannel(backup, triedIds);
    }
    logAppAction('CHANNEL_NO_STREAM_AVAILABLE', { name: ch.name }, 'LIVE');
    showToast(`La señal de ${ch.name} no está disponible.`);
    return;
  }

  if (!video) return;

  const isHlsUrl = /\.m3u8(?:$|[?#])/i.test(ch.streamUrl);
  const canUseHlsJs = !!(isHlsUrl && window.Hls && window.Hls.isSupported());
  let usedHlsJs = false;
  let usedRelay = false;
  let failureRecorded = false;
  let videoWatchdogTimer = null;
  let lastDecodedFrameCount = null;
  let lastDecodedFrameAt = Date.now();

  state.liveFrameWatchdog = setInterval(() => {
    if (currentGen !== liveSessionGen || video.paused) return;
    const frames = Number(video.webkitDecodedFrameCount);
    if (!Number.isFinite(frames)) return;
    if (lastDecodedFrameCount === null || frames !== lastDecodedFrameCount) {
      lastDecodedFrameCount = frames;
      lastDecodedFrameAt = Date.now();
      return;
    }
    if (Date.now() - lastDecodedFrameAt < 20000) return;

    clearInterval(state.liveFrameWatchdog);
    state.liveFrameWatchdog = null;
    const attempts = Number(ch.frameRecoveryAttempts) || 0;
    logAppAction('CHANNEL_VIDEO_FRAME_STALL', { name: ch.name, relay: usedRelay, attempts }, 'PLAYER');
    if (!usedRelay && ch.relayUrl) {
      playRelayMode();
    } else if (attempts < 1) {
      executePlayLiveChannel({ ...ch, relayUrl: '', frameRecoveryAttempts: attempts + 1 });
    } else {
      showToast(`El video de ${ch.name} se detuvo; vuelve a sintonizar el canal.`);
    }
  }, 5000);

  const playRelayMode = () => {
    if (usedRelay || !ch.relayUrl || currentGen !== liveSessionGen) return;
    usedRelay = true;
    logAppAction('CHANNEL_SWITCH_TO_RELAY_FMP4', { name: ch.name, relayUrl: ch.relayUrl }, 'PLAYER');
    if (state.hlsLive) {
      try {
        state.hlsLive.stopLoad();
        state.hlsLive.detachMedia();
        state.hlsLive.destroy();
      } catch (_) {}
      state.hlsLive = null;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.src = ch.relayUrl;
    video.load();
    const p = video.play();
    if (p !== undefined) p.catch(() => {});
  };

  const attachHlsJs = () => {
    usedHlsJs = true;
    const hls = new window.Hls({ enableWorker: true });
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      window.__refreshLiveTrackMenus?.();
      if (currentGen === liveSessionGen) video.play().catch(() => {});
    });
    hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, () => window.__refreshLiveTrackMenus?.());
    hls.on(window.Hls.Events.SUBTITLE_TRACKS_UPDATED, () => window.__refreshLiveTrackMenus?.());
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (currentGen !== liveSessionGen) return;
      if (!usedRelay && ch.relayUrl) {
        playRelayMode();
        return;
      }
      if (data?.fatal && data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
        return;
      }
      if (data?.fatal && data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      if (!data?.fatal || failureRecorded) return;
      failureRecorded = true;
      recordChannelPlayback(ch, false, data.details || 'Error HLS fatal');
      showToast(`La señal de ${ch.name} devolvió un error HLS.`);
    });
    hls.loadSource(ch.streamUrl);
    hls.attachMedia(video);
    state.hlsLive = hls;
  };

  const onChannelPlaying = () => {
    if (currentGen === liveSessionGen) {
      if (idleEl) idleEl.classList.add('hidden');
      recordChannelPlayback(ch, true);
      logAppAction('CHANNEL_PLAYING_ACTIVE', { name: ch.name, num: ch.num, width: video.videoWidth, height: video.videoHeight }, 'PLAYER');

      // HEVC Audio-Only Guard for WebKit:
      // If AVPlayer plays audio but videoWidth is 0 after 600ms, it is HEVC inside MPEG-TS.
      // Automatically switch to zero-copy fragmented MP4 relay!
      if (!usedRelay && ch.relayUrl) {
        if (videoWatchdogTimer) clearTimeout(videoWatchdogTimer);
        videoWatchdogTimer = setTimeout(() => {
          if (currentGen !== liveSessionGen) return;
          if (video.videoWidth === 0 && !video.paused) {
            logAppAction('CHANNEL_HEVC_AUDIO_ONLY_FALLBACK', { name: ch.name }, 'PLAYER');
            playRelayMode();
          }
        }, 600);
      }
    }
  };

  const onChannelError = () => {
    if (currentGen !== liveSessionGen) return;
    if (!usedRelay && ch.relayUrl) {
      logAppAction('CHANNEL_ERROR_FALLBACK_TO_RELAY', { name: ch.name }, 'PLAYER');
      playRelayMode();
      return;
    }
    if (!usedHlsJs && canUseHlsJs) {
      logAppAction('CHANNEL_FALLBACK_TO_HLSJS', { name: ch.name }, 'PLAYER');
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      attachHlsJs();
      return;
    }
    if (failureRecorded) return;
    failureRecorded = true;
    const errCode = video.error?.code;
    const reason = errCode ? `Error del reproductor ${errCode}` : 'El reproductor no pudo abrir la señal';
    logAppAction('CHANNEL_PLAYBACK_ERROR', { name: ch.name, reason, code: errCode }, 'PLAYER');
    recordChannelPlayback(ch, false, reason);

    const backup = triedIds.size < 3 ? findBackupLiveChannel(ch, triedIds) : null;
    if (backup && currentGen === liveSessionGen) {
      logAppAction('CHANNEL_FAILOVER_BACKUP', { from: ch.name, to: backup.name }, 'LIVE');
      showToast(`Cambiando a señal alternativa de ${ch.name}…`);
      executePlayLiveChannel(backup, triedIds);
      return;
    }
    if (currentGen === liveSessionGen) {
      showToast(`No se pudo reproducir ${ch.name}: ${reason}.`);
    }
  };

  const onChannelPause = () => {
    if (video.currentTime === 0 && idleEl) idleEl.classList.remove('hidden');
  };

  video.onplaying = onChannelPlaying;
  video.onerror = onChannelError;
  video.onpause = onChannelPause;
  video.muted = false;
  video.volume = 0.9;
  const liveMuteBtn = document.getElementById('live-mute-btn');
  if (liveMuteBtn) liveMuteBtn.textContent = '🔊';
  if (unlockBanner) unlockBanner.style.display = 'none';

  // Watchdog timer (5s)
  state.liveConnectionTimeout = setTimeout(() => {
    if (currentGen === liveSessionGen && video.readyState < 2) {
      if (!usedRelay && ch.relayUrl) {
        logAppAction('CHANNEL_CONNECTION_TIMEOUT_SWITCH_RELAY', { name: ch.name }, 'PLAYER');
        playRelayMode();
      } else {
        console.warn('Channel connection delayed:', ch.name);
      }
    }
  }, 5000);

  saveHistoryItem({
    id: ch.id,
    title: ch.name,
    category: 'live',
    logo: ch.logo,
    stream_url: ch.streamUrl,
    position_seconds: 0,
    duration_seconds: 0
  });
  showToast(`Sintonizando: ${ch.name}`);
  showLiveOsdTemporarily();

  // For portal channels, prioritize the fMP4 relay for hardware-accelerated HEVC & synchronized audio
  if (ch.portal && ch.relayUrl) {
    playRelayMode();
    return;
  }

  // Play using native Apple WebKit HLS (hardware-accelerated AVPlayer)
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = ch.streamUrl;
    video.load();
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        if (err.name === 'AbortError' || currentGen !== liveSessionGen) return;
        video.play().catch(() => {});
      });
    }
  } else if (canUseHlsJs) {
    attachHlsJs();
  } else {
    video.src = ch.streamUrl;
    video.play().catch(() => {});
  }

}

function switchLiveChannel(delta) {
  if (!CHANNELS || CHANNELS.length === 0) return;
  const curIdx = CHANNELS.findIndex(c => c.id === state.currentChannel?.id);
  const nextIdx = (curIdx + delta + CHANNELS.length) % CHANNELS.length;
  playLiveChannel(CHANNELS[nextIdx]);
}

function updateOsdFavButton() {
  const btn = document.getElementById('live-osd-fav-btn');
  if (!btn || !state.currentChannel) return;
  const isFav = state.favorites.some(f => f.id === state.currentChannel.id);
  btn.textContent = isFav ? '★ En Favoritos' : '☆ Añadir a Favoritos';
  btn.classList.toggle('is-fav', isFav);
}

async function toggleElementFullscreen(targetEl) {
  if (!targetEl) return;
  const isBoxFs = targetEl.classList.contains('is-fullscreen-box');
  const docFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (docFs || isBoxFs) {
    if (document.exitFullscreen) await document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen().catch(() => {});
    targetEl.classList.remove('is-fullscreen-box');
    document.documentElement.classList.remove('player-fullscreen');
    if (state.windowFullscreen || /Android/i.test(navigator.userAgent)) {
      await toggleFullscreen().catch(() => {});
    }
    return;
  }

  const reqFs = targetEl.requestFullscreen || targetEl.webkitRequestFullscreen;
  const isTouchMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isTouchMobile || typeof reqFs !== 'function') {
    targetEl.classList.add('is-fullscreen-box');
    document.documentElement.classList.add('player-fullscreen');
    if (/Android/i.test(navigator.userAgent)) {
      invoke('toggle_fullscreen').catch(() => {});
    }
    return;
  }

  try {
    await reqFs.call(targetEl);
  } catch (_) {
    targetEl.classList.add('is-fullscreen-box');
    await toggleFullscreen().catch(() => {});
  }
}

// Live OSD Controls Behavior
function setupVideoPlayers() {
  const liveVideo = document.getElementById('live-video');
  const liveOsd = document.getElementById('live-player-osd');
  const livePlayBtn = document.getElementById('live-play-btn');
  const liveMuteBtn = document.getElementById('live-mute-btn');
  const liveVolRange = document.getElementById('live-vol-range');
  const liveAspectBtn = document.getElementById('live-aspect-btn');
  const liveReloadBtn = document.getElementById('live-reload-btn');
  const liveFsBtn = document.getElementById('live-fs-btn');
  const livePipBtn = document.getElementById('live-pip-btn');
  const liveOsdFavBtn = document.getElementById('live-osd-fav-btn');
  const unlockBanner = document.getElementById('audio-unlock-banner');
  const unmuteBtn = document.getElementById('btn-unmute-overlay');

  const livePrevBtn = document.getElementById('live-prev-btn');
  const liveNextBtn = document.getElementById('live-next-btn');

  livePrevBtn?.addEventListener('click', () => switchLiveChannel(-1));
  liveNextBtn?.addEventListener('click', () => switchLiveChannel(1));

  unmuteBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    liveVideo.muted = false;
    liveVideo.volume = 0.9;
    unlockBanner.style.display = 'none';
    liveMuteBtn.textContent = '🔊';
    showToast('🔊 Audio Activado');
  });

  // OSD Favorite toggle button
  liveOsdFavBtn?.addEventListener('click', async () => {
    if (!state.currentChannel) return;
    await toggleFav({
      id: state.currentChannel.id,
      title: state.currentChannel.name,
      category: 'live',
      logo: state.currentChannel.logo,
      stream_url: state.currentChannel.streamUrl
    });
    renderLiveChannels();
    updateFavCounterBadge();
    updateOsdFavButton();
  });

  // Reload channel stream
  liveReloadBtn?.addEventListener('click', () => {
    if (state.currentChannel) {
      showToast('Reconectando transmisión...');
      playLiveChannel(state.currentChannel);
    }
  });

  // Mouse move and interactions over player box with precise idle detection
  const livePlayerBox = document.getElementById('live-player-box');
  const liveFloatControls = document.querySelector('.player-floating-top-right');
  let lastLiveX = -1;
  let lastLiveY = -1;
  const onLiveMouseMove = (e) => {
    if (e && Math.abs(e.clientX - lastLiveX) < 3 && Math.abs(e.clientY - lastLiveY) < 3) return;
    if (e) {
      lastLiveX = e.clientX;
      lastLiveY = e.clientY;
    }
    showLiveOsdTemporarily();
  };
  livePlayerBox?.addEventListener('mousemove', onLiveMouseMove);
  livePlayerBox?.addEventListener('pointermove', onLiveMouseMove);
  livePlayerBox?.addEventListener('click', (e) => {
    if (e.target.closest('.player-osd button') || e.target.closest('.player-osd input') || e.target.closest('.floating-ctrl-btn')) return;
    showLiveOsdTemporarily();
  });
  livePlayerBox?.addEventListener('mouseleave', () => {
    clearTimeout(state.osdHideTimeout);
    document.getElementById('live-player-osd')?.classList.remove('visible');
    livePlayerBox.classList.remove('osd-active');
    livePlayerBox.classList.add('mouse-idle');
    liveFloatControls?.classList.remove('visible');
  });
  livePlayerBox?.addEventListener('dblclick', (e) => {
    if (e.target.closest('.player-osd') || e.target.closest('.floating-ctrl-btn')) return;
    toggleElementFullscreen(livePlayerBox);
  });

  livePlayBtn?.addEventListener('click', () => {
    if (liveVideo.paused) {
      liveVideo.play().catch(() => {});
      livePlayBtn.textContent = '⏸';
    } else {
      liveVideo.pause();
      livePlayBtn.textContent = '▶';
    }
  });

  liveMuteBtn?.addEventListener('click', () => {
    liveVideo.muted = !liveVideo.muted;
    liveMuteBtn.textContent = liveVideo.muted ? '🔇' : '🔊';
    if (!liveVideo.muted && unlockBanner) unlockBanner.style.display = 'none';
  });

  liveVolRange?.addEventListener('input', (e) => {
    liveVideo.volume = parseFloat(e.target.value);
    liveVideo.muted = liveVideo.volume === 0;
    liveMuteBtn.textContent = liveVideo.muted ? '🔇' : '🔊';
    if (!liveVideo.muted && unlockBanner) unlockBanner.style.display = 'none';
  });

  liveAspectBtn?.addEventListener('click', () => {
    state.currentAspectIndex = (state.currentAspectIndex + 1) % state.aspectRatios.length;
    const aspect = state.aspectRatios[state.currentAspectIndex];
    applyAspectRatio(liveVideo, aspect);
    liveAspectBtn.textContent = `Aspecto: ${aspect.toUpperCase()}`;
    showToast(`Aspecto: ${aspect.toUpperCase()}`);
  });

  liveFsBtn?.addEventListener('click', () => {
    toggleElementFullscreen(document.getElementById('live-player-box'));
  });

  livePipBtn?.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await liveVideo.requestPictureInPicture();
      }
    } catch (e) {
      console.warn('PiP error:', e);
    }
  });

  liveVideo.addEventListener('playing', () => {
    if (state.liveConnectionTimeout) {
      clearTimeout(state.liveConnectionTimeout);
      state.liveConnectionTimeout = null;
    }
  });

  liveVideo.addEventListener('loadeddata', () => {
    if (state.liveConnectionTimeout) {
      clearTimeout(state.liveConnectionTimeout);
      state.liveConnectionTimeout = null;
    }
  });

  liveVideo.addEventListener('error', (e) => {
    if (state.liveConnectionTimeout) {
      clearTimeout(state.liveConnectionTimeout);
      state.liveConnectionTimeout = null;
    }
    console.warn('Live playback error:', e);
  });

  // Floating top-right controls
  const floatFavBtn = document.getElementById('live-float-fav-btn');
  const floatFsBtn = document.getElementById('live-float-fs-btn');
  const floatSidebarBtn = document.getElementById('live-float-sidebar-btn');

  floatFavBtn?.addEventListener('click', async () => {
    if (!state.currentChannel) return;
    await toggleFav({
      id: state.currentChannel.id,
      title: state.currentChannel.name,
      category: 'live',
      logo: state.currentChannel.logo,
      stream_url: state.currentChannel.streamUrl
    });
    renderLiveChannels();
    updateFavCounterBadge();
    updateOsdFavButton();
  });

  floatFsBtn?.addEventListener('click', () => {
    toggleElementFullscreen(document.getElementById('live-player-box'));
  });

  const mobileSidebarBtn = document.getElementById('mobile-channels-toggle-btn');
  const toggleLiveSidebar = () => {
    const viewLive = document.getElementById('view-live');
    if (!viewLive) return;
    const collapsed = viewLive.classList.toggle('sidebar-collapsed');
    if (floatSidebarBtn) floatSidebarBtn.textContent = collapsed ? '◻' : '◫';
    if (mobileSidebarBtn) mobileSidebarBtn.textContent = collapsed ? '📺 Mostrar canales ▴' : '📺 Ocultar canales ▾';
  };
  floatSidebarBtn?.addEventListener('click', toggleLiveSidebar);
  mobileSidebarBtn?.addEventListener('click', toggleLiveSidebar);

  // Rewind / Forward 10s
  document.getElementById('live-rewind-10')?.addEventListener('click', () => {
    liveVideo.currentTime = Math.max(0, liveVideo.currentTime - 10);
  });
  document.getElementById('live-forward-10')?.addEventListener('click', () => {
    liveVideo.currentTime = Math.min(liveVideo.duration || Infinity, liveVideo.currentTime + 10);
  });

  // Stream Settings Menu & Compact Icon Mode
  const liveSettingsBtn = document.getElementById('live-settings-btn');
  const liveSettingsMenu = document.getElementById('live-settings-menu');
  const liveCompactToggle = document.getElementById('live-compact-toggle');
  const liveOpenSettings = document.getElementById('live-open-settings');
  const npBanner = document.getElementById('now-playing-banner');
  const npCompactBtn = document.getElementById('np-compact-settings-btn');

  const applyCompactStreamBar = (compact) => {
    if (npBanner) npBanner.classList.toggle('is-compact', !!compact);
    if (liveCompactToggle) {
      liveCompactToggle.textContent = compact ? '✓ Solo icono (datos ocultos)' : 'Modo compacto (solo icono)';
      liveCompactToggle.classList.toggle('selected', !!compact);
    }
  };
  applyCompactStreamBar(localStorage.getItem('swordtv_compact_stream_bar') === '1');

  liveSettingsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('live-subs-menu')?.classList.remove('active');
    document.getElementById('live-audio-menu')?.classList.remove('active');
    liveSettingsMenu?.classList.toggle('active');
  });
  liveCompactToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = !(npBanner?.classList.contains('is-compact'));
    localStorage.setItem('swordtv_compact_stream_bar', next ? '1' : '0');
    applyCompactStreamBar(next);
    liveSettingsMenu?.classList.remove('active');
  });
  liveOpenSettings?.addEventListener('click', () => {
    liveSettingsMenu?.classList.remove('active');
    switchCategory('settings');
  });
  npCompactBtn?.addEventListener('click', () => switchCategory('settings'));
  document.addEventListener('click', () => liveSettingsMenu?.classList.remove('active'));

  // Window Controls
  document.getElementById('win-min-btn')?.addEventListener('click', () => {
    showToast('Minimizar ventana');
  });
  document.getElementById('win-max-btn')?.addEventListener('click', () => {
    toggleFullscreen();
  });
  document.getElementById('win-close-btn')?.addEventListener('click', () => {
    window.close();
  });

  // Notification Bell
  document.getElementById('btn-notification')?.addEventListener('click', () => {
    showToast('🔔 Tienes 1 notificación: Catálogo TDTChannels España HD listo.');
  });

  setupVodPlayer();
}

function showLiveOsdTemporarily() {
  const osd = document.getElementById('live-player-osd');
  const box = document.getElementById('live-player-box');
  const floatControls = document.querySelector('.player-floating-top-right');
  if (!osd) return;

  osd.classList.add('visible');
  if (box) {
    box.classList.remove('mouse-idle');
    box.classList.add('osd-active');
  }
  if (floatControls) {
    floatControls.classList.add('visible');
  }

  clearTimeout(state.osdHideTimeout);
  state.osdHideTimeout = setTimeout(() => {
    osd.classList.remove('visible');
    if (box) {
      box.classList.remove('osd-active');
      box.classList.add('mouse-idle');
    }
    if (floatControls) {
      floatControls.classList.remove('visible');
    }
  }, 2500);
}

function applyAspectRatio(videoEl, ratio) {
  videoEl.classList.remove('aspect-16-9', 'aspect-4-3', 'aspect-fill');
  if (ratio === '16:9') videoEl.classList.add('aspect-16-9');
  else if (ratio === '4:3') videoEl.classList.add('aspect-4-3');
  else if (ratio === 'fill') videoEl.classList.add('aspect-fill');
}

// ================= MOVIES CONTROLLER ================= //
function setupMoviesSection() {
  const heroContainer = document.getElementById('movies-hero-container');
  const featured = MOVIES[0];

  heroContainer.innerHTML = `
    <div class="hero-banner" style="background-image: url('${featured.backdrop}')">
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <div class="hero-badges">
          <span class="badge badge-4k">${featured.quality}</span>
          <span class="badge badge-hd">${featured.year}</span>
          <span class="badge badge-rating">⭐ ${featured.rating}</span>
          <span class="badge badge-hd">${featured.duration}</span>
        </div>
        <h1 class="hero-title">${featured.title}</h1>
        <p class="hero-synopsis">${featured.synopsis}</p>
        <div class="hero-actions">
          <button class="btn-primary" id="hero-movie-play-btn">▶ Reproducir Ahora</button>
          <button class="btn-secondary" id="hero-movie-detail-btn">ℹ Ver Detalles</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('hero-movie-play-btn')?.addEventListener('click', () => promptOrPlayVod(featured));
  document.getElementById('hero-movie-detail-btn')?.addEventListener('click', () => openVodDetailModal(featured, 'movie'));

  // Genres
  const genres = ['Todos', 'Acción', 'Ciencia Ficción', 'Aventura', 'Drama', 'Suspenso', 'Animación', 'Comedia', 'Crimen', 'Fantasía'];
  const genresBox = document.getElementById('movies-genres-container');
  genresBox.innerHTML = '';
  genres.forEach((g, idx) => {
    const pill = document.createElement('button');
    pill.className = `filter-pill ${idx === 0 ? 'active' : ''}`;
    pill.textContent = g;
    pill.addEventListener('click', () => {
      genresBox.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderMoviesGrid(g === 'Todos' ? null : g);
    });
    genresBox.appendChild(pill);
  });

  renderMoviesGrid();
}

function renderMoviesGrid(genreFilter = null) {
  const grid = document.getElementById('movies-grid');
  grid.innerHTML = '';

  const list = genreFilter 
    ? MOVIES.filter(m => (m.genre || '').toLowerCase().includes(genreFilter.toLowerCase())) 
    : MOVIES;

  list.forEach(mov => {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.innerHTML = `
      <div class="media-poster-box">
        <img src="${mov.poster}" alt="${mov.title}" loading="lazy" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        <div class="card-badge-top">
          <span class="badge badge-4k">${mov.quality}</span>
        </div>
        <div class="card-rating-badge">⭐ ${mov.rating}</div>
      </div>
      <div class="media-info-box">
        <div class="media-card-title">${mov.title}</div>
        <div class="media-card-meta">
          <span>${mov.year}</span>
          <span>${mov.duration}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => openVodDetailModal(mov, 'movie'));
    grid.appendChild(card);
  });
}

// ================= SERIES CONTROLLER ================= //
export function isMediaInEmission(item) {
  if (!item) return false;

  // 1. Direct status or airing flags on the item
  if (
    item.status === 'en_emision' ||
    item.status === 'airing' ||
    item.status === 'Returning Series' ||
    item.status === 'In Production' ||
    item.airing === true ||
    item.isAiring === true ||
    item.en_emision === true
  ) {
    return true;
  }
  if (item.subcat === 'en_emision') return true;

  // 2. Genre, badge, or tagline indicating emission
  const g = (item.genre || '').toLowerCase();
  const b = (item.badge || '').toLowerCase();
  const tag = (item.tagline || '').toLowerCase();
  if (
    /en emisi[oó]n|airing|ongoing/.test(g) ||
    /en emisi[oó]n|airing|ongoing/.test(b) ||
    /en emisi[oó]n|airing|ongoing/.test(tag)
  ) {
    return true;
  }

  // 3. Seasons inspection (any season marked as airing or in emission)
  if (Array.isArray(item.seasonList) && item.seasonList.length > 0) {
    const hasAiringSeason = item.seasonList.some(s =>
      s && (
        s.airing === true ||
        s.isAiring === true ||
        s.en_emision === true ||
        s.status === 'en_emision' ||
        s.status === 'airing' ||
        s.status === 'ongoing' ||
        (s.year && /[-–]\s*$/.test(String(s.year)))
      )
    );
    if (hasAiringSeason) return true;
  }

  // 4. Portal updateCount vs volumeCount (episodes currently releasing)
  if (typeof item.updateCount === 'number' && typeof item.volumeCount === 'number' && item.volumeCount > 0) {
    if (item.updateCount < item.volumeCount) return true;
  }

  // 5. Open-ended year (e.g. "2024-", "2026–", "2025–", "2023–", "2022-")
  const y = String(item.year || '').trim();
  if (/[-–]\s*$/.test(y)) {
    return true;
  }

  // 6. Current/future active broadcast year (2025, 2026 or ends in 2025/2026)
  if (/[-–]\s*(2025|2026)$/.test(y) || /^(2025|2026)$/.test(y)) {
    return true;
  }

  // 7. Portal ongoing seasons (e.g., T2, T3, T4, T10... from recent catalog)
  if (item.portal && (item.type === 'series' || item.category === 'series')) {
    const title = item.title || '';
    if (/\b(T[2-9]|T1[0-9]|Temp\.[2-9]|Temp\.1[0-9]|Temporada\s*[2-9]|Season\s*[2-9])\b/i.test(title)) {
      return true;
    }
  }

  return false;
}

function setupSeriesSection() {
  const heroContainer = document.getElementById('series-hero-container');
  const featured = SERIES[0];

  if (featured && heroContainer) {
    const seasonsNum = featured.seasons || (featured.seasonList ? featured.seasonList.length : 1);
    heroContainer.innerHTML = `
      <div class="hero-banner" style="background-image: url('${featured.backdrop || featured.poster}')">
        <div class="hero-overlay"></div>
        <div class="hero-content">
          <div class="hero-badges">
            <span class="badge badge-4k">${featured.quality || '4K UHD'}</span>
            <span class="badge badge-rating">⭐ ${featured.rating}</span>
            <span class="badge badge-hd">${seasonsNum} Temporadas</span>
          </div>
          <h1 class="hero-title">${featured.title}</h1>
          <p class="hero-synopsis">${featured.synopsis}</p>
          <div class="hero-actions">
            <button class="btn-primary" id="hero-series-play-btn">▶ Reproducir</button>
            <button class="btn-secondary" id="hero-series-detail-btn">ℹ Lista de Episodios</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('hero-series-play-btn')?.addEventListener('click', () => promptOrPlayVod(featured));

    document.getElementById('hero-series-detail-btn')?.addEventListener('click', () => openVodDetailModal(featured, 'series'));
  }

  // Series subcategories
  const seriesGenres = [
    { label: 'Todos', filter: null },
    { label: 'En emisión', filter: 'en_emision' },
    { label: 'Drama & Crimen', filter: 'drama' },
    { label: 'Ciencia Ficción & Fantasía', filter: 'scifi' },
    { label: 'Acción & Suspenso', filter: 'accion' },
    { label: 'Comedia', filter: 'comedia' },
    { label: 'Terror & Misterio', filter: 'terror' }
  ];
  const genresBox = document.getElementById('series-genres-container');
  if (genresBox) {
    genresBox.innerHTML = '';
    seriesGenres.forEach((g, idx) => {
      const pill = document.createElement('button');
      pill.className = `filter-pill ${idx === 0 ? 'active' : ''}`;
      pill.textContent = g.label;
      pill.addEventListener('click', () => {
        genresBox.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        renderSeriesGrid(g.filter);
      });
      genresBox.appendChild(pill);
    });
  }

  renderSeriesGrid(null);
}

function renderSeriesGrid(filter = null) {
  const grid = document.getElementById('series-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const list = filter
    ? SERIES.filter(s => {
        if (filter === 'en_emision') return isMediaInEmission(s);
        if (s.subcat === filter) return true;
        const g = (s.genre || '').toLowerCase();
        if (filter === 'drama' && (g.includes('drama') || g.includes('crimen') || g.includes('policial'))) return true;
        if (filter === 'scifi' && (g.includes('sci-fi') || g.includes('ciencia ficción') || g.includes('fantasía'))) return true;
        if (filter === 'accion' && (g.includes('acción') || g.includes('suspenso') || g.includes('aventura') || g.includes('guerra'))) return true;
        if (filter === 'comedia' && (g.includes('comedia') || g.includes('sitcom'))) return true;
        if (filter === 'terror' && (g.includes('terror') || g.includes('misterio') || g.includes('horror') || g.includes('sobrenatural'))) return true;
        return false;
      })
    : SERIES;

  list.forEach(ser => {
    const card = document.createElement('div');
    card.className = 'media-card';
    const seasonsCount = ser.seasons || (ser.seasonList ? ser.seasonList.length : 1);
    const inEmission = isMediaInEmission(ser);
    card.innerHTML = `
      <div class="media-poster-box">
        <img src="${ser.poster}" alt="${ser.title}" loading="lazy" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        <div class="card-badge-top">
          <span class="badge ${inEmission ? 'badge-airing' : 'badge-4k'}">${inEmission ? '🔴 EN EMISIÓN' : `${seasonsCount} Temp`}</span>
        </div>
        <div class="card-rating-badge">⭐ ${ser.rating}</div>
      </div>
      <div class="media-info-box">
        <div class="media-card-title">${ser.title}</div>
        <div class="media-card-meta">
          <span>${ser.genre}</span>
          <span>${ser.year}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => openVodDetailModal(ser, 'series'));
    grid.appendChild(card);
  });
}

// ================= ANIME CONTROLLER ================= //
function setupAnimeSection() {
  const heroContainer = document.getElementById('anime-hero-container');
  const featured = ANIME[0];

  if (featured && heroContainer) {
    heroContainer.innerHTML = `
      <div class="hero-banner" style="background-image: url('${featured.backdrop || featured.poster}')">
        <div class="hero-overlay"></div>
        <div class="hero-content">
          <div class="hero-badges">
            <span class="badge badge-4k">1080p HD</span>
            <span class="badge badge-hd">Japonés & Español</span>
            <span class="badge badge-rating">⭐ ${featured.rating}</span>
          </div>
          <h1 class="hero-title">${featured.title}</h1>
          <p class="hero-synopsis">${featured.synopsis}</p>
          <div class="hero-actions">
            <button class="btn-primary" id="hero-anime-play-btn">▶ Reproducir</button>
            <button class="btn-secondary" id="hero-anime-detail-btn">ℹ Lista de Episodios</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('hero-anime-play-btn')?.addEventListener('click', () => promptOrPlayVod(featured));

    document.getElementById('hero-anime-detail-btn')?.addEventListener('click', () => openVodDetailModal(featured, 'anime'));
  }

  // Anime subcategories: 100% of titles organized into pills
  const animeGenres = [
    { label: 'Todos', filter: null },
    { label: 'En emisión', filter: 'en_emision' },
    { label: 'Shonen & Acción', filter: 'shonen' },
    { label: 'Isekai & Fantasía', filter: 'isekai' },
    { label: 'Seinen & Psicológico', filter: 'seinen' },
    { label: 'Películas Anime', filter: 'peliculas_anime' },
    { label: 'Clásicos & Retro', filter: 'clasicos' },
    { label: 'Comedia & Romance', filter: 'comedia' }
  ];

  const genresBox = document.getElementById('anime-genres-container');
  if (genresBox) {
    genresBox.innerHTML = '';
    animeGenres.forEach((g, idx) => {
      const pill = document.createElement('button');
      pill.className = `filter-pill ${idx === 0 ? 'active' : ''}`;
      pill.textContent = g.label;
      pill.addEventListener('click', () => {
        genresBox.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        renderAnimeGrid(g.filter);
      });
      genresBox.appendChild(pill);
    });
  }

  renderAnimeGrid(null);
}

function renderAnimeGrid(filter = null) {
  const grid = document.getElementById('anime-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const list = filter
    ? ANIME.filter(ani => {
        if (filter === 'en_emision') return isMediaInEmission(ani);
        if (ani.subcat === filter) return true;
        const g = (ani.genre || '').toLowerCase();
        if (filter === 'shonen' && (g.includes('shonen') || g.includes('acción') || g.includes('ninja') || g.includes('superhéroes') || g.includes('piratas'))) return true;
        if (filter === 'isekai' && (g.includes('isekai') || g.includes('fantasía') || g.includes('magia') || g.includes('rpg'))) return true;
        if (filter === 'seinen' && (g.includes('seinen') || g.includes('psicológico') || g.includes('misterio') || g.includes('cyberpunk'))) return true;
        if (filter === 'peliculas_anime' && (g.includes('película anime') || g.includes('ghibli') || ani.subcat === 'peliculas_anime')) return true;
        if (filter === 'clasicos' && (g.includes('clásico') || g.includes('mecha') || ani.subcat === 'clasicos')) return true;
        if (filter === 'comedia' && (g.includes('comedia') || g.includes('romance') || g.includes('espías'))) return true;
        return false;
      })
    : ANIME;

  list.forEach(ani => {
    const card = document.createElement('div');
    card.className = 'media-card';
    const totalEps = ani.episodesCount || (ani.seasonList ? ani.seasonList[0]?.episodes?.length : 24);
    const seasonsCount = ani.seasons || (ani.seasonList ? ani.seasonList.length : 1);
    const isMovie = ani.subcat === 'peliculas_anime' || (seasonsCount === 1 && totalEps === 1);
    const inEmission = isMediaInEmission(ani);

    card.innerHTML = `
      <div class="media-poster-box">
        <img src="${ani.poster}" alt="${ani.title}" loading="lazy" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        <div class="card-badge-top">
          <span class="badge ${inEmission ? 'badge-airing' : (isMovie ? 'badge-live' : 'badge-hd')}">${inEmission ? '🔴 EN EMISIÓN' : (isMovie ? 'PELÍCULA' : `${totalEps} Eps`)}</span>
        </div>
        <div class="card-rating-badge">⭐ ${ani.rating}</div>
      </div>
      <div class="media-info-box">
        <div class="media-card-title">${ani.title}</div>
        <div class="media-card-meta">
          <span>${ani.genre}</span>
          <span>${ani.year || '2024'}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => openVodDetailModal(ani, 'anime'));
    grid.appendChild(card);
  });
}

// ================= KIDS CONTROLLER ================= //
function setupKidsSection() {
  const kidsGenres = [
    { label: 'Todos', filter: null },
    { label: 'Películas Animadas', filter: 'peliculas_infantiles' },
    { label: 'Disney & Pixar', filter: 'disney' },
    { label: 'Series Infantiles', filter: 'series_infantiles' },
    { label: 'Canales Infantiles 24/7', filter: 'channels' }
  ];

  const genresBox = document.getElementById('kids-genres-container');
  if (genresBox) {
    genresBox.innerHTML = '';
    kidsGenres.forEach((g, idx) => {
      const pill = document.createElement('button');
      pill.className = `filter-pill ${idx === 0 ? 'active' : ''}`;
      pill.textContent = g.label;
      pill.addEventListener('click', () => {
        genresBox.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        renderKidsGrid(g.filter);
      });
      genresBox.appendChild(pill);
    });
  }

  renderKidsGrid(null);
}

function renderKidsGrid(filter = null) {
  const grid = document.getElementById('kids-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const kidsChannels = CHANNELS.filter(c => c.subcat === 'infantil');
  let items = [];

  if (filter === 'channels') {
    items = kidsChannels;
  } else if (filter === 'disney') {
    items = KIDS.filter(k => k.subcat === 'disney' || (k.title + ' ' + k.genre).toLowerCase().includes('disney') || (k.title + ' ' + k.genre).toLowerCase().includes('pixar'));
  } else if (filter === 'series_infantiles') {
    items = KIDS.filter(k => k.subcat === 'series_infantiles');
  } else if (filter === 'peliculas_infantiles') {
    items = KIDS.filter(k => k.subcat === 'peliculas_infantiles' || !k.num);
  } else {
    items = [...KIDS, ...kidsChannels];
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'media-card';
    const isChannel = !!item.num;
    card.innerHTML = `
      <div class="media-poster-box">
        <img src="${isChannel ? 'assets/backdrop.png' : item.poster}" alt="${item.name || item.title}" loading="lazy" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        <div class="card-badge-top">
          <span class="badge badge-4k">${isChannel ? 'EN VIVO' : item.quality || '4K UHD'}</span>
        </div>
        ${item.rating ? `<div class="card-rating-badge">⭐ ${item.rating}</div>` : ''}
      </div>
      <div class="media-info-box">
        <div class="media-card-title">${item.name || item.title}</div>
        <div class="media-card-meta">
          <span>${isChannel ? 'Infantil 24/7' : item.duration}</span>
          <span>${isChannel ? 'En Vivo' : item.year}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => {
      if (isChannel) {
        switchCategory('live');
        playLiveChannel(item);
      } else {
        openVodDetailModal(item, 'movie');
      }
    });
    grid.appendChild(card);
  });
}

// ================= SPORTS CONTROLLER ================= //
function setupSportsSection() {
  const matchContainer = document.getElementById('sports-matches-container');
  if (matchContainer) {
    matchContainer.innerHTML = '';

    const availableMatches = SPORTS_MATCHES.filter(m => {
      const ch = CHANNELS.find(c => c.id === m.channelId) || (m.channelName && CHANNELS.find(c => c.name.toLowerCase().includes(m.channelName.toLowerCase().split(' ')[0])));
      return ch && m.status !== 'finished';
    });

    availableMatches.forEach(m => {
      const card = document.createElement('div');
      card.className = 'match-card';
      card.innerHTML = `
        <div class="match-thumb">
          <img src="${m.poster}" alt="${m.title}" loading="lazy" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
          <span class="badge ${m.status === 'live' ? 'badge-live' : 'badge-4k'}" style="position: absolute; top: 10px; right: 10px;">
            ${m.status === 'live' ? '🔴 EN VIVO' : '🕒 PRÓXIMO'}
          </span>
          <span class="badge" style="position: absolute; bottom: 10px; left: 10px; background: rgba(0,0,0,0.8); border: 1px solid #38bdf8; font-size: 10px; color: #38bdf8;">
            🇵🇪 GMT-5 LIMA
          </span>
        </div>
        <div class="match-body">
          <div class="match-league">${m.league}</div>
          <div class="match-title">${m.title}</div>
          <div class="match-meta">
            <span>🕒 ${m.time}</span>
            <span style="color: var(--accent-gold); font-weight: 700;">${m.score}</span>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
            🏟️ ${m.stadium || 'Estadio Principal'} • 📺 ${m.channelName || 'En Directo'}
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        let ch = CHANNELS.find(c => c.id === m.channelId);
        if (!ch && m.channelName) {
          const kw = m.channelName.toLowerCase().split(' ')[0];
          ch = CHANNELS.find(c => c.name.toLowerCase().includes(kw));
        }
        if (ch) {
          switchCategory('live', ch);
          showToast(`Sintonizando ${ch.name} - ${m.title}`);
        } else {
          showToast(`Canal no disponible para este partido`);
        }
      });
      matchContainer.appendChild(card);
    });
  }

  const spGrid = document.getElementById('sports-channels-grid');
  if (spGrid) {
    spGrid.innerHTML = '';
    CHANNELS.filter(c => c.subcat === 'deportes').slice(0, 40).forEach(ch => {
      const badge = getChannelBadge(ch);
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <div class="media-poster-box">
          <div class="channel-card-fallback-badge" style="background: ${badge.bg};">${badge.label}</div>
          <div class="card-badge-top">
            <span class="badge badge-4k">EN VIVO</span>
          </div>
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${ch.num}. ${ch.name}</div>
          <div class="media-card-meta">
            <span>${ch.currentShow}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        switchCategory('live');
        playLiveChannel(ch);
      });
      spGrid.appendChild(card);
    });
  }
}

// ================= MUSIC & DOCS CONTROLLERS ================= //
function setupMusicSection() {
  const musicGenres = [
    { label: 'Todos', filter: null },
    { label: 'Conciertos de Rock & Pop', filter: 'rock_pop' },
    { label: 'Música Latina & Urbana', filter: 'latina' },
    { label: 'Electrónica & EDM', filter: 'electronica' },
    { label: 'Canales de Música 24/7', filter: 'channels' }
  ];

  const genresBox = document.getElementById('music-genres-container');
  if (genresBox) {
    genresBox.innerHTML = '';
    musicGenres.forEach((g, idx) => {
      const pill = document.createElement('button');
      pill.className = `filter-pill ${idx === 0 ? 'active' : ''}`;
      pill.textContent = g.label;
      pill.addEventListener('click', () => {
        genresBox.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        renderMusicGrid(g.filter);
      });
      genresBox.appendChild(pill);
    });
  }

  renderMusicGrid(null);
}

function renderMusicGrid(filter = null) {
  const grid = document.getElementById('music-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const musicChannels = CHANNELS.filter(c => c.subcat === 'musica');
  let items = [];

  if (filter === 'channels') {
    items = musicChannels;
  } else if (filter) {
    items = MUSIC_ITEMS.filter(m => m.subcat === filter);
  } else {
    items = [...MUSIC_ITEMS, ...musicChannels];
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'media-card';
    const isChannel = !!item.num;
    if (!isChannel) {
      card.innerHTML = `
        <div class="media-poster-box">
          <img src="${item.poster}" alt="${item.title}" loading="lazy" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
          <div class="card-badge-top">
            <span class="badge badge-4k">CONCIERTO</span>
          </div>
          ${item.rating ? `<div class="card-rating-badge">⭐ ${item.rating}</div>` : ''}
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${item.title}</div>
          <div class="media-card-meta">
            <span>${item.artist || item.genre}</span>
            <span>${item.duration}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => openVodDetailModal(item, 'movie'));
    } else {
      const badge = getChannelBadge(item);
      card.innerHTML = `
        <div class="media-poster-box">
          <div class="channel-card-fallback-badge" style="background: ${badge.bg};">${badge.label}</div>
          <div class="card-badge-top">
            <span class="badge badge-live">CANAL EN VIVO</span>
          </div>
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${item.num}. ${item.name}</div>
          <div class="media-card-meta">
            <span>Música 24/7</span>
            <span>En Directo</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        switchCategory('live');
        playLiveChannel(item);
      });
    }
    grid.appendChild(card);
  });
}

function setupDocsSection() {
  const docsGenres = [
    { label: 'Todos', filter: null },
    { label: 'Naturaleza & Planeta', filter: 'naturaleza' },
    { label: 'Historia & Civilizaciones', filter: 'historia' },
    { label: 'Ciencia & Espacio', filter: 'ciencia' },
    { label: 'Crimen Real', filter: 'crimen' },
    { label: 'Canales de Documentales 24/7', filter: 'channels' }
  ];

  const genresBox = document.getElementById('docs-genres-container');
  if (genresBox) {
    genresBox.innerHTML = '';
    docsGenres.forEach((g, idx) => {
      const pill = document.createElement('button');
      pill.className = `filter-pill ${idx === 0 ? 'active' : ''}`;
      pill.textContent = g.label;
      pill.addEventListener('click', () => {
        genresBox.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        renderDocsGrid(g.filter);
      });
      genresBox.appendChild(pill);
    });
  }

  renderDocsGrid(null);
}

function renderDocsGrid(filter = null) {
  const grid = document.getElementById('docs-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const docsChannels = CHANNELS.filter(c => c.subcat === 'cultura');
  let items = [];

  if (filter === 'channels') {
    items = docsChannels;
  } else if (filter) {
    items = DOCS_ITEMS.filter(d => d.subcat === filter);
  } else {
    items = [...DOCS_ITEMS, ...docsChannels];
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'media-card';
    const isChannel = !!item.num;
    if (!isChannel) {
      card.innerHTML = `
        <div class="media-poster-box">
          <img src="${item.poster}" alt="${item.title}" loading="lazy" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
          <div class="card-badge-top">
            <span class="badge badge-4k">DOCUMENTAL</span>
          </div>
          ${item.rating ? `<div class="card-rating-badge">⭐ ${item.rating}</div>` : ''}
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${item.title}</div>
          <div class="media-card-meta">
            <span>${item.genre}</span>
            <span>${item.year}</span>
          </div>
        </div>
      `;
      const contentType = item.contentType || (Array.isArray(item.seasonList) || Array.isArray(item.seasons) ? 'series' : 'movie');
      card.addEventListener('click', () => openVodDetailModal(item, contentType));
    } else {
      const badge = getChannelBadge(item);
      card.innerHTML = `
        <div class="media-poster-box">
          <div class="channel-card-fallback-badge" style="background: ${badge.bg};">${badge.label}</div>
          <div class="card-badge-top">
            <span class="badge badge-live">CANAL EN VIVO</span>
          </div>
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${item.num}. ${item.name}</div>
          <div class="media-card-meta">
            <span>Cultura & Ciencia</span>
            <span>En Directo</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        switchCategory('live');
        playLiveChannel(item);
      });
    }
    grid.appendChild(card);
  });
}

// ================= TELENOVELAS SECTION (COLUMN_CODE_THEME) ================= //
function setupNovelasSection() {
  const novelasGenres = [
    { label: 'Todas las Novelas', filter: null },
    { label: 'Novelas Turcas', filter: 'turcas' },
    { label: 'Novelas Mexicanas', filter: 'mexicanas' },
    { label: 'Novelas Colombianas', filter: 'colombianas' },
    { label: 'Clásicos Inolvidables', filter: 'clasicos' }
  ];

  const genresBox = document.getElementById('novelas-genres-container');
  if (genresBox) {
    genresBox.innerHTML = '';
    novelasGenres.forEach((g, idx) => {
      const pill = document.createElement('button');
      pill.className = `filter-pill ${idx === 0 ? 'active' : ''}`;
      pill.textContent = g.label;
      pill.addEventListener('click', () => {
        genresBox.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.currentNovelasFilter = g.filter;
        renderNovelasGrid(g.filter);
      });
      genresBox.appendChild(pill);
    });
  }

  // Hero actions
  const sultan = NOVELAS.find(n => n.id === 'tt1984180') || NOVELAS[0];
  if (sultan) {
    document.getElementById('hero-novelas-play-btn')?.addEventListener('click', () => {
      openVodDetailModal(sultan, 'series');
    });
    document.getElementById('hero-novelas-info-btn')?.addEventListener('click', () => {
      openVodDetailModal(sultan, 'series');
    });
  }

  renderNovelasGrid(null);
}

function renderNovelasGrid(filter = null) {
  const grid = document.getElementById('novelas-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const items = filter ? NOVELAS.filter(n => n.subcat === filter) : NOVELAS;

  items.forEach(nov => {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.innerHTML = `
      <div class="media-poster-box">
        <img src="${nov.poster}" alt="${nov.title}" loading="lazy" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        <div class="card-badge-top">
          <span class="badge badge-series">${nov.seasons || 1} Temp.</span>
        </div>
        ${nov.rating ? `<div class="card-rating-badge">⭐ ${nov.rating}</div>` : ''}
      </div>
      <div class="media-info-box">
        <div class="media-card-title">${nov.title}</div>
        <div class="media-card-meta">
          <span>${nov.genre}</span>
          <span>${nov.year}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => openVodDetailModal(nov, 'series'));
    grid.appendChild(card);
  });
}

// ================= 4K UHD MASTER SECTION (COLUMN_CODE_UHD) ================= //
function setupUhdSection() {
  const uhdGenres = [
    { label: 'Todos en 4K UHD', filter: null },
    { label: 'Cine 4K HDR', filter: 'uhd_cine' },
    { label: 'Series 4K UHD', filter: 'uhd_series' },
    { label: 'Documentales 4K Naturaleza', filter: 'uhd_docs' }
  ];

  const genresBox = document.getElementById('uhd-genres-container');
  if (genresBox) {
    genresBox.innerHTML = '';
    uhdGenres.forEach((g, idx) => {
      const pill = document.createElement('button');
      pill.className = `filter-pill ${idx === 0 ? 'active' : ''}`;
      pill.textContent = g.label;
      pill.addEventListener('click', () => {
        genresBox.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.currentUhdFilter = g.filter;
        renderUhdGrid(g.filter);
      });
      genresBox.appendChild(pill);
    });
  }

  // Hero actions
  const dune = UHD_ITEMS.find(u => u.id === 'tt15239678') || UHD_ITEMS[0];
  if (dune) {
    document.getElementById('hero-uhd-play-btn')?.addEventListener('click', () => {
      promptOrPlayVod({
        ...dune,
        title: dune.title,
        subtitle: `${dune.genre} • 4K Dolby Vision HDR • Master`,
        streamUrl: dune.streamUrl
      });
    });
    document.getElementById('hero-uhd-info-btn')?.addEventListener('click', () => {
      openVodDetailModal(dune, 'movie');
    });
  }

  renderUhdGrid(null);
}

function renderUhdGrid(filter = null) {
  const grid = document.getElementById('uhd-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const items = filter ? UHD_ITEMS.filter(u => u.subcat === filter) : UHD_ITEMS;

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.innerHTML = `
      <div class="media-poster-box">
        <img src="${item.poster}" alt="${item.title}" loading="lazy" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        <div class="card-badge-top">
          <span class="badge badge-4k">4K UHD HDR</span>
        </div>
        ${item.rating ? `<div class="card-rating-badge">⭐ ${item.rating}</div>` : ''}
      </div>
      <div class="media-info-box">
        <div class="media-card-title">${item.title}</div>
        <div class="media-card-meta">
          <span>${item.genre}</span>
          <span>${item.year}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => openVodDetailModal(item, item.seasons ? 'series' : 'movie'));
    grid.appendChild(card);
  });
}

// ================= FAVORITES & PROFILE ================= //
function setupFavoritesSection() {
  document.getElementById('fav-tab-all')?.addEventListener('click', (e) => setFavTab(e, 'all'));
  document.getElementById('fav-tab-channels')?.addEventListener('click', (e) => setFavTab(e, 'live'));
  document.getElementById('fav-tab-vod')?.addEventListener('click', (e) => setFavTab(e, 'vod'));
  document.getElementById('fav-tab-history')?.addEventListener('click', (e) => setFavTab(e, 'history'));
}

function setFavTab(e, filter) {
  document.querySelectorAll('#view-favorites .filter-pill').forEach(p => p.classList.remove('active'));
  e.target.classList.add('active');
  renderFavoritesView(filter);
}

async function renderFavoritesView(filter = 'all') {
  const grid = document.getElementById('favorites-grid');
  grid.innerHTML = '';

  const activeFilterId = `fav-tab-${filter === 'live' ? 'channels' : filter === 'vod' ? 'vod' : filter === 'history' ? 'history' : 'all'}`;
  document.querySelectorAll('#view-favorites .filter-pill').forEach(pill => {
    pill.classList.toggle('active', pill.id === activeFilterId);
  });

  state.favorites = (await invoke('get_favorites')) || [];
  state.history = (await invoke('get_history')) || [];

  // Update stats counters
  const favChannelsCount = state.favorites.filter(f => f.category === 'live').length;
  const favVodCount = state.favorites.filter(f => f.category !== 'live').length;
  const statCh = document.getElementById('stat-fav-channels');
  const statVod = document.getElementById('stat-fav-vod');
  const statHist = document.getElementById('stat-history-count');
  if (statCh) statCh.textContent = favChannelsCount;
  if (statVod) statVod.textContent = favVodCount;
  if (statHist) statHist.textContent = state.history.length;
  updateFavCounterBadge();

  if (filter === 'history') {
    if (state.history.length === 0) {
      grid.innerHTML = `<div style="color: var(--text-muted); padding: 40px; text-align: center;">No hay historial de reproducción reciente</div>`;
      return;
    }
    state.history.forEach(item => {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <div class="media-poster-box">
          <img src="${item.logo || 'assets/icon.png'}" alt="${item.title}">
          <div class="card-badge-top">
            <span class="badge badge-4k">Visto</span>
          </div>
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${item.title}</div>
          <div class="media-card-meta">
            <span>${new Date(item.last_watched).toLocaleDateString('es-ES')}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        if (item.category === 'live') {
          const ch = CHANNELS.find(c => c.id === item.id) || item;
          switchCategory('live');
          playLiveChannel(ch);
        } else {
          promptOrPlayVod({
            ...item,
            parentId: item.parent_id || item.id,
            parentTitle: item.parent_title || item.title,
            seasonId: item.season_id || undefined,
            seasonNum: item.season_num || undefined,
            episodeNum: item.episode_num || undefined,
            episodeId: item.id,
            streamUrl: '',
            stream_url: '',
            poster: item.logo || item.poster || ''
          });
        }
      });
      grid.appendChild(card);
    });
    return;
  }

  let items = state.favorites;
  if (filter === 'live') items = items.filter(f => f.category === 'live');
  if (filter === 'vod') items = items.filter(f => f.category !== 'live');

  if (items.length === 0) {
    grid.innerHTML = `<div style="color: var(--text-muted); padding: 40px; text-align: center; grid-column: 1 / -1;">
      No has añadido favoritos todavía.<br><br>
      Haz clic en la estrella ☆ de cualquier canal o en "Favorito" dentro de una película para darle máxima preferencia.
    </div>`;
    return;
  }

  items.forEach(fav => {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.innerHTML = `
      <div class="media-poster-box">
        <img src="${fav.logo || 'assets/icon.png'}" alt="${fav.title}">
        <div class="card-badge-top">
          <span class="badge badge-rating">⭐ Favorito</span>
        </div>
      </div>
      <div class="media-info-box">
        <div class="media-card-title">${fav.title}</div>
        <div class="media-card-meta">
          <span>${fav.category === 'live' ? 'En Vivo' : 'Película / Serie'}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => {
      if (fav.category === 'live') {
        const ch = CHANNELS.find(c => c.id === fav.id) || fav;
        switchCategory('live');
        playLiveChannel(ch);
      } else {
        promptOrPlayVod(fav);
      }
    });
    grid.appendChild(card);
  });
}

async function toggleFav(item) {
  const isNowFav = await invoke('toggle_favorite', { item });
  showToast(isNowFav ? `★ ${item.title} añadido a Favoritos` : `☆ ${item.title} eliminado de Favoritos`);
  state.favorites = (await invoke('get_favorites')) || [];
}

// ================= STREMIO STREAM SOURCES RESOLVER ================= //

let activeSourcesItem = null;
let activeSourcesTargetEp = null;

function getStremioServerUrl() {
  return (localStorage.getItem('swordtv_stremio_server') || '').trim().replace(/\/+$/, '');
}

function getCleanSearchTitle(title) {
  if (!title) return '';
  return title
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\s*-\s*T\d+:E\d+.*$/i, '')
    .replace(/\s*Capítulo\s*\d+.*/i, '')
    .replace(/\s*Episodio\s*\d+.*/i, '')
    .trim();
}

async function resolveTitleId(title, type = 'movie', targetEp = null, allowKitsu = true, signal = null) {
  try {
    const cleanTitle = getCleanSearchTitle(title);
    const titleQueries = getCatalogTitleVariants(title);
    if (!cleanTitle || !titleQueries.length) return null;

    if (allowKitsu && type === 'anime' && (!targetEp || Number(targetEp.seasonNum || 1) === 1)) {
      try {
        const kData = await fetchVodResource(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(titleQueries[0])}`, signal);
        {
          const exactKitsuMatch = findExactTitleMatch(kData.data, cleanTitle);
          if (exactKitsuMatch) {
            return { kitsuId: exactKitsuMatch.id, type: 'anime' };
          }
        }
      } catch (ke) {}
    }

    const cinemetaType = (type === 'series' || type === 'anime' || type === 'novelas') ? 'series' : 'movie';
    const altType = (cinemetaType === 'series') ? 'movie' : 'series';
    for (const cinemetaKind of [cinemetaType, altType]) {
      for (const searchTitle of titleQueries.slice(0, 3)) {
        if (signal?.aborted) return null;
        const data = await fetchVodResource(`https://v3-cinemeta.strem.io/catalog/${cinemetaKind}/top/search=${encodeURIComponent(searchTitle)}.json`, signal);
        const exactMatch = findExactTitleMatch(data.metas, title);
        if (exactMatch?.id) {
          return { imdbId: exactMatch.id, type: cinemetaKind };
        }
      }
    }
  } catch (err) {
    console.warn('[Resolver] Failed to resolve title ID:', err);
  }
  return null;
}

function parseStreamSource(s) {
  const infoHash = /^[a-f0-9]{40}$/i.test(s.infoHash || '') ? s.infoHash.toLowerCase() : '';
  const fileIdx = Number.isInteger(s.fileIdx) && s.fileIdx >= 0 ? s.fileIdx : null;
  const directUrl = isUsableVodUrl(s.url) ? s.url : '';
  if (!directUrl && (!infoHash || fileIdx === null)) return null;

  const nameLines = (s.name || '').split('\n');
  const title = s.title || '';
  const releaseName = title.split('\n')[0] || s.behaviorHints?.filename || 'Fuente disponible';
  const filename = s.behaviorHints?.filename || releaseName;
  // Provider names such as Wolfmax4k are not video-resolution metadata.
  const qualityText = `${nameLines.slice(1).join(' ')} ${filename}`;
  const resolution = /\b(?:4k|2160p?)\b/i.test(qualityText) ? 2160
    : /\b1080p?\b/i.test(qualityText) ? 1080 : /\b720p?\b/i.test(qualityText) ? 720 : 0;
  const fullText = `${filename} ${title}`;
  const isSpanish = /\b(?:lat|latino|castellano|spanish|español|spa)\b|🇲🇽|🇪🇸/i.test(fullText);
  const isJapanese = /\b(?:jpn|jap|japanese)\b|🇯🇵/i.test(fullText);
  const isEnglish = /\b(?:eng|english)\b|🇬🇧|🇺🇸/i.test(fullText);
  const languages = [];
  if (isJapanese) languages.push('Japonés');
  if (isSpanish) languages.push('Español');
  if (isEnglish) languages.push('Inglés');
  if (!languages.length) languages.push('Audio de la fuente');
  const sizeMatch = title.match(/💾\s*([\d.]+\s*[KMGT]B)/i);
  const seedsMatch = title.match(/👤\s*(\d+)/);
  return {
    releaseName, filename, provider: nameLines[0] || 'Fuente',
    resolution, qualityLabel: resolution ? `${resolution}p` : 'Calidad sin confirmar',
    badgeClass: resolution === 2160 ? 'quality-4k' : resolution === 720 ? 'quality-720p' : 'quality-1080p',
    size: sizeMatch?.[1] || '', seeds: Number(seedsMatch?.[1] || s.seeds || 0),
    languages, isSpanish, isJapanese,
    compatibilityRisk: /\.avi$|\b(?:xvid|divx|av1|vp9|hi10p|h264[ ._-]*10bit)\b/i.test(filename) ? 1 : 0,
    streamUrl: directUrl || `http://127.0.0.1:11472/hls/${infoHash}/${fileIdx}/stream.m3u8`,
    infoHash: directUrl ? '' : infoHash, fileIdx, isDirect: !!directUrl
  };
}

let vodSession = null;
let vodAbortPending = Promise.resolve();

function isUsableVodUrl(value) {
  if (!channelUrlKey(value)) return false;
  if (/127\.0\.0\.1:11472\/hls\//i.test(value)) return false;
  return !/commondatastorage\.googleapis\.com|test-streams\.mux\.dev|clusters\.pluto\.tv|rtvelivestream\.akamaized\.net|cph-p2p-msl|bipbop|oceans\.mp4|sintel|tears-of-steel|jmp2\.uk/i.test(value);
}

async function fetchVodResource(url, signal, timeoutMs = 12000, asText = false) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`La fuente respondió HTTP ${response.status}.`);
    return await (asText ? response.text() : response.json());
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Reproducción cancelada', 'AbortError');
    if (controller.signal.aborted) throw new Error('La fuente no respondió a tiempo.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function showVodLoading(message, failed = false) {
  const overlay = document.getElementById('vod-buffering-overlay');
  const text = document.getElementById('vod-buffering-text');
  const elapsed = document.getElementById('vod-buffering-elapsed');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.toggle('failed', failed);
    overlay.setAttribute('aria-busy', String(!failed));
  }
  if (text) text.textContent = message;
  if (vodSession) {
    vodSession.failed = failed;
    const update = () => {
      if (elapsed) elapsed.textContent = failed ? 'Puedes reintentar o volver al catálogo.'
        : `Tiempo de espera: ${Math.floor((Date.now() - vodSession.startedAt) / 1000)} s`;
    };
    clearInterval(vodSession.loadingTimer);
    update();
    if (!failed) vodSession.loadingTimer = setInterval(update, 1000);
  }
  showVodOsdTemporarily();
}

function hideVodLoading() {
  const overlay = document.getElementById('vod-buffering-overlay');
  if (overlay) overlay.style.display = 'none';
  if (vodSession) clearInterval(vodSession.loadingTimer);
}

async function fetchStremioStreams(item, targetEp = null, customQueryId = null, signal = null) {
  const serverUrl = getStremioServerUrl();
  let rawId = (customQueryId && customQueryId.startsWith('tt')) ? customQueryId : (item.imdbId || (typeof item.id === 'string' && item.id.startsWith('tt') ? item.id : ''));
  const sNum = targetEp ? (targetEp.seasonNum || 1) : 1;
  const epNum = targetEp ? (targetEp.episodeNum || 1) : 1;
  const isSeriesOrAnime = !!(targetEp || item.seasons || item.seasonList || item.episodesCount);
  const type = isSeriesOrAnime ? 'series' : 'movie';
  const searchText = (customQueryId && !customQueryId.startsWith('tt')) ? customQueryId : item.title;

  const queries = [];

  if (rawId.startsWith('tt')) {
    const qId = isSeriesOrAnime ? `${rawId}:${sNum}:${epNum}` : rawId;
    queries.push(`https://torrentio.strem.fun/stream/${type}/${qId}.json`);
  }

  if (item.kitsuId && (!targetEp || sNum === 1)) {
    queries.push(`https://torrentio.strem.fun/stream/series/kitsu:${item.kitsuId}:${epNum}.json`);
  }

  if (rawId && serverUrl) {
    const addonId = isSeriesOrAnime ? `${rawId}:${sNum}:${epNum}` : rawId;
    queries.push(`${serverUrl}/addon/stream/${type}/${encodeURIComponent(addonId)}.json`);
  }

  let allStreams = [];
  for (const qUrl of queries) {
    try {
      if (signal?.aborted) return [];
      const data = await fetchVodResource(qUrl, signal);
      {
        if (Array.isArray(data.streams) && data.streams.length > 0) {
          allStreams.push(...data.streams.filter(stream => streamMatchesEpisode(stream, targetEp)));
          if (allStreams.length) break;
        }
      }
    } catch (e) {
      console.warn('[Stremio] Query failed for', qUrl, e.message);
    }
  }

  if (allStreams.length === 0) {
    const itemType = item.category === 'anime' || state.currentCategory === 'anime' ? 'anime' : 'series';
    if (signal?.aborted) return [];
    const resolved = await resolveTitleId(searchText, isSeriesOrAnime ? itemType : 'movie', targetEp, true, signal);
    if (resolved) {
      if (resolved.kitsuId && (!targetEp || sNum === 1)) {
        item.kitsuId = resolved.kitsuId;
        const kUrl = `https://torrentio.strem.fun/stream/series/kitsu:${resolved.kitsuId}:${epNum}.json`;
        try {
          const data = await fetchVodResource(kUrl, signal);
          {
            if (Array.isArray(data.streams)) allStreams.push(...data.streams.filter(stream => streamMatchesEpisode(stream, targetEp)));
          }
        } catch (e) {}
      }
      if (resolved.imdbId) {
        item.imdbId = resolved.imdbId;
        const qId = isSeriesOrAnime ? `${resolved.imdbId}:${sNum}:${epNum}` : resolved.imdbId;
        const iUrl = `https://torrentio.strem.fun/stream/${resolved.type || type}/${qId}.json`;
        try {
          const data = await fetchVodResource(iUrl, signal);
          {
            if (Array.isArray(data.streams)) allStreams.push(...data.streams.filter(stream => streamMatchesEpisode(stream, targetEp)));
          }
        } catch (e) {}
      }
    }
  }

  const seenHashes = new Set();
  const parsedStreams = [];

  for (const s of allStreams) {
    const key = s.infoHash ? `${s.infoHash}:${s.fileIdx}` : s.url;
    if (key && !seenHashes.has(key)) {
      seenHashes.add(key);
      const parsed = parseStreamSource(s);
      if (parsed?.streamUrl) {
        parsedStreams.push(parsed);
      }
    }
  }

  const prefersJapanese = item.category === 'anime' || state.currentCategory === 'anime';
  const preferredResolution = parseInt(state.settings.preferred_quality, 10) || 1080;
  parsedStreams.sort((a, b) => {
    const qualityRank = stream => stream.resolution === preferredResolution ? 0
      : stream.resolution === 1080 ? 1 : stream.resolution === 720 ? 2 : stream.resolution === 2160 ? 3 : 4;
    return a.compatibilityRisk - b.compatibilityRisk
      || Number(b.isDirect || b.seeds > 0) - Number(a.isDirect || a.seeds > 0)
      || qualityRank(a) - qualityRank(b)
      || Number(prefersJapanese ? b.isJapanese : b.isSpanish) - Number(prefersJapanese ? a.isJapanese : a.isSpanish)
      || b.seeds - a.seeds;
  });

  return parsedStreams;
}

async function autoResolveAndPlayVod(item, targetEp = null, startTime = 0, selectedStream = null) {
  closeVodPlayer(false);
  if (state.liveFrameWatchdog) {
    clearInterval(state.liveFrameWatchdog);
    state.liveFrameWatchdog = null;
  }
  const session = { item, targetEp, startTime, controller: new AbortController(), startedAt: Date.now(), starting: true };
  vodSession = session;
  state.activeVodItem = item;
  state.currentPlayingStream = null;
  document.getElementById('vod-audio-menu').innerHTML = '';
  document.getElementById('vod-subs-menu').innerHTML = '';
  state.vodSeekOffset = 0;
  state.vodTotalDuration = 0;
  document.getElementById('live-video')?.pause();
  const overlay = document.getElementById('vod-player-overlay');
  overlay?.classList.add('open', 'active');
  const title = document.getElementById('vod-osd-title');
  if (title) title.textContent = targetEp?.title || item.title;
  showVodLoading('Buscando fuentes para este título…');

  logAppAction('VOD_SELECT_PLAY', { id: item.id, title: item.title, kind: item.kind, episode: targetEp ? { id: targetEp.id, number: targetEp.number, title: targetEp.title } : null }, 'VOD');

  try {
    await vodAbortPending;
    if (vodSession !== session) return;
    if (selectedStream) {
      session.attemptLabel = 'Fuente seleccionada';
      await playSelectedStream(selectedStream, item, targetEp, startTime, session);
      return;
    }
    // 1. If portal item, resolve directly from high-speed streaming engine
    let contentId = targetEp?.id || item.episodeId || item.id;
    let seriesId = targetEp ? (targetEp.seasonId || targetEp.parentId || item.parentId || item.id) : (item.parentId || '');
    if (contentId === seriesId && (item.episodeNum || targetEp?.episodeNum)) {
      // If contentId accidentally matches seriesId, try resolving episode from seasons list
      const allSeasons = item.seasonList || (Array.isArray(item.seasons) ? item.seasons : []);
      for (const s of allSeasons) {
        if (Number(s.seasonNum || s.season || 1) !== Number(targetEp?.seasonNum || item.seasonNum || 1)) continue;
        const foundEp = (s.episodes || []).find(e => Number(e.episodeNum || e.number) === Number(item.episodeNum || targetEp?.episodeNum));
        if (foundEp?.id && foundEp.id !== seriesId) {
          contentId = foundEp.id;
          seriesId = foundEp.seasonId || s.id || s.seasonId || seriesId;
          break;
        }
      }
    }

    if (contentId && (item.portal || targetEp?.portal || /^[0-9a-fA-F]{32}$/.test(contentId))) {
      session.attemptLabel = 'Servidor de alta velocidad';
      showVodLoading('Conectando y resolviendo video en alta velocidad…');
      logAppAction('VOD_RESOLVING_DIRECT', { title: item.title, contentId, seriesId }, 'VOD');
      try {
        const resp = await fetch(`http://127.0.0.1:11472/api/vod/resolve?id=${encodeURIComponent(contentId)}&seriesId=${encodeURIComponent(seriesId || '')}`, { signal: session.controller.signal });
        const resData = await resp.json();
        if (vodSession !== session) return;
        if (resData.ok && resData.streamUrl) {
          logAppAction('VOD_RESOLVE_SUCCESS', { title: item.title, quality: resData.quality, streamUrl: resData.streamUrl }, 'VOD');
          const directStream = {
            streamUrl: resData.streamUrl,
            qualityLabel: resData.quality || '1080p HD',
            languages: ['Español / Original'],
            size: 'Directo',
            duration: resData.duration || 0,
            subtitles: resData.subtitles || [],
            audioTracks: resData.audioTracks || [],
            audioIndex: 0,
            relayUrl: resData.relayUrl,
            relayAudioSwitch: !!resData.relayAudioSwitch
          };
          await playSelectedStream(directStream, item, targetEp, startTime, session);
          return;
        } else {
          logAppAction('VOD_RESOLVE_FAILED', { title: item.title, error: resData.error }, 'VOD');
          throw new Error(resData.error || 'No se pudo resolver el enlace en el servidor de alta velocidad');
        }
      } catch (err) {
        if (vodSession !== session) return;
        logAppAction('VOD_RESOLVE_NETWORK_ERROR', { title: item.title, error: err.message }, 'VOD');
        console.warn('[VOD] Portal direct playback failed, trying alternate sources:', err.message);
        const video = document.getElementById('vod-video');
        if (video) {
          video.onwaiting = video.onplaying = video.onloadedmetadata = null;
          video.pause();
          if (state.hlsVod) { try { state.hlsVod.destroy(); } catch (_) {} state.hlsVod = null; }
          video.removeAttribute('src');
          video.load();
        }
      }
    }

    // 2. Title search fallback on high-speed portal for non-hex items
    if (!item.portal && !isUsableVodUrl(item.streamUrl || item.stream_url) && !/^[0-9a-fA-F]{32}$/.test(contentId || '')) {
      let portalFoundStream = null;
      try {
        const cleanTitle = (item.title || '').replace(/\s*\(\d{4}\).*$/, '').replace(/\s*-\s*T\d+:E\d+.*$/, '').trim();
        if (cleanTitle) {
          session.attemptLabel = 'Buscando en servidor de alta velocidad';
          showVodLoading(`Localizando "${cleanTitle}" en alta velocidad…`);
          logAppAction('VOD_SEARCH_FALLBACK', { title: cleanTitle }, 'VOD');
          const sResp = await fetch(`http://127.0.0.1:11472/api/vod/search?q=${encodeURIComponent(cleanTitle)}`, { signal: session.controller.signal });
          const sData = await sResp.json();
          if (sData.ok && sData.items && sData.items.length > 0) {
            const found = findExactTitleMatch(sData.items.filter(result =>
              !!(result.kind === 'serie' || result.type === 'teleplay' || result.type === 'series') === !!targetEp
            ), cleanTitle, targetEp?.seasonNum || item.seasonNum || null);
            if (!found) throw new Error('No se encontró una coincidencia exacta para este título.');
            let resolveId = found.id;
            let sid = '';
            if (found.kind === 'serie' || targetEp) {
              const series = { ...found, portal: true };
              await ensureSeriesEpisodes(series, 'series');
              const season = series.seasonList?.find(s => Number(s.seasonNum) === Number(targetEp?.seasonNum || 1));
              const episode = season?.episodes.find(e => Number(e.episodeNum) === Number(targetEp?.episodeNum || 1));
              if (!episode) throw new Error('Este episodio no está disponible en el servidor.');
              sid = episode.seasonId || season.id;
              resolveId = episode.id;
            }
            const rResp = await fetch(`http://127.0.0.1:11472/api/vod/resolve?id=${encodeURIComponent(resolveId)}&seriesId=${encodeURIComponent(sid)}`, { signal: session.controller.signal });
            const rData = await rResp.json();
            if (rData.ok && rData.streamUrl) {
              logAppAction('VOD_SEARCH_RESOLVED', { title: cleanTitle, foundId: found.id, streamUrl: rData.streamUrl }, 'VOD');
              portalFoundStream = {
                streamUrl: rData.streamUrl,
                qualityLabel: rData.quality || '1080p HD',
                languages: ['Español / Original'],
                size: 'Directo',
                duration: rData.duration || 0,
                subtitles: rData.subtitles || [],
                audioTracks: rData.audioTracks || [],
                audioIndex: 0,
                relayUrl: rData.relayUrl,
                relayAudioSwitch: !!rData.relayAudioSwitch
              };
            }
          }
        }
      } catch (searchErr) {
        console.warn('[VOD] Title search portal fallback skipped:', searchErr.message);
      }

      if (portalFoundStream) {
        try {
          await playSelectedStream(portalFoundStream, item, targetEp, startTime, session);
          return;
        } catch (streamErr) {
          if (vodSession !== session) return;
          console.warn('[VOD] Portal title fallback failed, trying Stremio sources:', streamErr.message);
          const video = document.getElementById('vod-video');
          if (video) {
            video.onwaiting = video.onplaying = video.onloadedmetadata = null;
            video.pause();
            if (state.hlsVod) { try { state.hlsVod.destroy(); } catch (_) {} state.hlsVod = null; }
            video.removeAttribute('src');
            video.load();
          }
        }
      }
    }

    const directUrl = item.streamUrl || item.stream_url;
    const localHls = directUrl?.match(/^http:\/\/127\.0\.0\.1:11472\/hls\/([a-f0-9]{40})\/(\d+)\//i);
    const streams = selectedStream ? [selectedStream] : isUsableVodUrl(directUrl)
      ? [{ ...item.streamMeta, ...(localHls ? { infoHash: localHls[1], fileIdx: Number(localHls[2]) } : {}), streamUrl: directUrl, qualityLabel: item.quality || '', languages: [], size: '' }]
      : await fetchStremioStreams(item, targetEp, null, session.controller.signal);
    if (vodSession !== session) return;
    if (!streams.length) throw new Error('No hay fuentes disponibles para este título en este momento.');
    // ponytail: try five sources per click; expose a source picker if a larger search becomes necessary.
    const candidates = streams.slice(0, 5);
    for (let i = 0; i < candidates.length; i++) {
      session.attemptLabel = `Fuente ${i + 1} de ${candidates.length}`;
      session.starting = true;
      showVodLoading(`${session.attemptLabel} · Comprobando disponibilidad…`);
      try {
        await playSelectedStream(candidates[i], item, targetEp, startTime, session);
        return;
      } catch (error) {
        if (vodSession !== session) return;
        const video = document.getElementById('vod-video');
        video.onwaiting = video.onplaying = video.onloadedmetadata = null;
        video.pause();
        if (state.hlsVod) { state.hlsVod.destroy(); state.hlsVod = null; }
        video.removeAttribute('src');
        video.load();
        console.warn(`[VOD] ${session.attemptLabel}:`, error.message);
        if (i === candidates.length - 1) throw error;
      }
    }
  } catch (error) {
    if (vodSession !== session) return;
    session.starting = false;
    showVodLoading(`No se pudo iniciar el video. ${error.message || 'Revisa la conexión e inténtalo de nuevo.'}`, true);
  }
}

async function openStremioSourcesModal(item, targetEp = null, customSearch = null) {
  activeSourcesItem = item;
  activeSourcesTargetEp = targetEp;

  const modal = document.getElementById('stremio-sources-modal');
  const titleEl = document.getElementById('sources-title');
  const subEl = document.getElementById('sources-subtitle');
  const listEl = document.getElementById('sources-list');
  const loadingEl = document.getElementById('sources-loading-state');
  const loadingText = document.getElementById('sources-loading-text');
  const searchInput = document.getElementById('sources-search-input');

  if (!modal) return;

  const displayTitle = targetEp ? (targetEp.title || `${item.title} - T${targetEp.seasonNum}:E${targetEp.episodeNum}`) : item.title;
  if (titleEl) titleEl.textContent = displayTitle;
  if (subEl) subEl.textContent = `Buscando fuentes para "${item.title}" con audio y subtítulos en español...`;
  if (searchInput) searchInput.value = customSearch || item.imdbId || (typeof item.id === 'string' && item.id.startsWith('tt') ? item.id : item.title);

  listEl.innerHTML = '';
  listEl.style.display = 'none';
  loadingEl.style.display = 'flex';
  if (loadingText) loadingText.textContent = `Conectando con Stremio y resolviendo fuentes para ${displayTitle}...`;

  modal.classList.add('open');
  modal.classList.add('active');

  const streams = await fetchStremioStreams(item, targetEp, customSearch);

  loadingEl.style.display = 'none';
  listEl.style.display = 'flex';

  if (streams.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <p style="font-size: 16px; margin-bottom: 8px; color: #fff;">No se encontraron fuentes automáticas directas</p>
        <p style="font-size: 13px; margin-bottom: 20px;">Puedes usar el buscador superior para ingresar el ID de IMDb (ej. tt9335498) o el nombre exacto.</p>
      </div>
    `;
    return;
  }

  if (subEl) subEl.textContent = `Se encontraron ${streams.length} fuentes disponibles en streaming. Elige tu opción:`;

  streams.forEach((stream) => {
    const card = document.createElement('div');
    card.className = `stream-source-card ${stream.isSpanish ? 'is-spanish' : ''}`;
    
    card.innerHTML = `
      <div class="stream-card-left">
        <div class="stream-badges-row">
          <span class="stream-badge-quality ${stream.badgeClass}">${stream.qualityLabel}</span>
          <span class="stream-badge-provider">${stream.provider}</span>
          ${stream.seeds > 0 ? `<span class="stream-badge-seeds">👤 ${stream.seeds} semillas</span>` : ''}
          ${stream.isSpanish ? `<span style="font-size: 11px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.15); padding: 2px 7px; border-radius: 4px;">🇪🇸 Español</span>` : ''}
        </div>
        <div class="stream-card-title" title="${stream.releaseName}">${stream.releaseName}</div>
        <div class="stream-card-tags">
          <span class="tag-audio">${stream.languages.join(' • ')}</span>
          <span class="tag-subs">💬 Subtítulos disponibles</span>
          <span class="tag-format">🎬 Streaming M4</span>
        </div>
      </div>
      <div class="stream-card-right">
        <div class="stream-card-size">💾 ${stream.size}</div>
        <button class="btn-play-source">▶ Reproducir</button>
      </div>
    `;

    card.onclick = () => {
      modal.classList.remove('open');
      modal.classList.remove('active');
      autoResolveAndPlayVod(item, targetEp, 0, stream);
    };

    listEl.appendChild(card);
  });
}

async function playSelectedStream(stream, item, targetEp, startTime, session) {
  const signal = session.controller.signal;
  let probeData = null;
  let streamUrl = stream.streamUrl;
  if (stream.infoHash) {
    try {
      await fetchVodResource('http://127.0.0.1:11472/ping', signal, 3000);
    } catch (error) {
      throw new Error('El motor multimedia local no está disponible. Cierra y abre la app.');
    }
    showVodLoading(`${session.attemptLabel} · Conectando y leyendo el video…`);
    probeData = await fetchVodResource(`http://127.0.0.1:11472/probe/${stream.infoHash}/${stream.fileIdx}`, signal, 30000);
    if (vodSession !== session) return;
    if (!probeData.ok) throw new Error('Esta fuente no entrega datos de video.');
    if (!['h264', 'hevc'].includes(probeData.videoCodec)) throw new Error('El formato de esta fuente no es compatible con el reproductor.');
    const tracks = probeData.audioTracks || [];
    const prefersJapanese = item.category === 'anime' || state.currentCategory === 'anime';
    const preferred = (prefersJapanese && tracks.find(track => track.isJapanese)) || tracks.find(track => track.isSpanish) || tracks[0];
    // probeAudio.index is the audio ordinal used by FFmpeg's 0:a:N mapping;
    // streamIndex is the global stream number and can point at the wrong track.
    probeData.recommendedAudioIndex = preferred?.index ?? 0;
    const hlsUrl = new URL(streamUrl);
    hlsUrl.searchParams.set('audio', preferred?.index ?? 'auto');
    hlsUrl.searchParams.set('t', Math.max(0, Math.floor(startTime)));
    streamUrl = hlsUrl.href;
    session.probeData = probeData;
    showVodLoading(`${session.attemptLabel} · Preparando los primeros segundos…`);
    const playlist = await fetchVodResource(streamUrl, signal, 45000, true);
    if (!playlist.startsWith('#EXTM3U') || !playlist.includes('#EXTINF')) throw new Error('La fuente todavía no ha entregado video reproducible.');
  }
  if (vodSession !== session) return;
  if (stream.relayAudioSwitch && startTime > 0) {
    const switched = await fetchVodResource(
      `http://127.0.0.1:11472/api/vod/switch_audio?audio=${stream.audioIndex || 0}&time=${startTime}&source=${encodeURIComponent(stream.relayUrl || '')}`,
      signal, 45000);
    if (!switched.ok || !switched.streamUrl) throw new Error(switched.error || 'No se pudo retomar el video.');
    if (vodSession !== session) return;
    streamUrl = switched.streamUrl;
    stream.relayUrl = streamUrl;
  }
  state.currentPlayingStream = stream;
  if (stream.infoHash && probeData) stream.audioIndex = probeData.recommendedAudioIndex;
  state.activeAudioStreamIndex = Number.isInteger(Number(stream.audioIndex))
    ? Number(stream.audioIndex)
    : (probeData?.recommendedAudioIndex ?? 0);
  state.vodSeekOffset = (stream.infoHash || stream.relayAudioSwitch) ? startTime : 0;
  state.vodTotalDuration = (probeData && probeData.duration) || stream.duration || 0;
  const playItem = {
    ...item, parentId: item.parentId || item.id, parentTitle: item.parentTitle || item.title,
    title: targetEp?.title || item.title,
    subtitle: [stream.qualityLabel, ...(stream.languages || []), stream.size].filter(Boolean).join(' • '),
    streamUrl, directPlay: true, streamMeta: stream,
    episodeNum: targetEp?.episodeNum || item.episodeNum,
    seasonNum: targetEp?.seasonNum || item.seasonNum,
    seasonId: targetEp?.seasonId || item.seasonId
  };
  showVodLoading(`${session.attemptLabel} · Iniciando reproducción…`);
  await openVodPlayer(playItem, (stream.infoHash || stream.relayAudioSwitch) ? 0 : startTime, session);
  if (vodSession !== session) return;

  // Setup dynamic audio tracks (probeData, stream.audioTracks, or native)
  setupVodAudioTracks(stream, probeData);

  // Setup dynamic subtitles (portal + OpenSubtitles + embedded)
  const imdbId = item.imdbId || (/^tt\d+$/.test(item.id || '') ? item.id : null);
  const type = targetEp || item.seasons || item.seasonList ? 'series' : 'movie';
  loadSubtitlesForPlayer(imdbId, targetEp?.seasonNum, targetEp?.episodeNum, type, stream, probeData, session);
}

function srtToVtt(srtText) {
  if (!srtText) return 'WEBVTT\n\n';
  let text = String(srtText).replace(/^\uFEFF/, '');
  if (text.startsWith('WEBVTT')) return text;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + text.trim() + '\n';
}

function parseVttCues(rawText) {
  const cues = [];
  if (!rawText || typeof rawText !== 'string') return cues;
  const clean = rawText.replace(/^\uFEFF/, '');
  const lines = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const timeRegex = /(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})/;

  let currentCue = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('WEBVTT') || line.startsWith('NOTE') || line.startsWith('STYLE')) continue;

    const match = timeRegex.exec(line);
    if (match) {
      if (currentCue && currentCue.text) cues.push(currentCue);
      const startH = parseInt(match[1] || '0', 10);
      const startM = parseInt(match[2], 10);
      const startS = parseInt(match[3], 10);
      const startMs = parseInt(match[4], 10);
      const start = startH * 3600 + startM * 60 + startS + startMs / 1000;

      const endH = parseInt(match[5] || '0', 10);
      const endM = parseInt(match[6], 10);
      const endS = parseInt(match[7], 10);
      const endMs = parseInt(match[8], 10);
      const end = endH * 3600 + endM * 60 + endS + endMs / 1000;

      currentCue = { start, end, text: '' };
    } else if (currentCue) {
      if (/^\d+$/.test(line)) continue;
      if (currentCue.text) currentCue.text += '<br>';
      currentCue.text += escapeHtml(line.replace(/<[^>]*>/g, ''));
    }
  }
  if (currentCue && currentCue.text) cues.push(currentCue);
  return cues;
}

function updateActiveSubtitleCue() {
  const customSubEl = document.getElementById('vod-custom-subtitles');
  const video = document.getElementById('vod-video');
  if (!customSubEl || !video) return;
  const cues = state.activeSubtitleCues;
  if (!cues || cues.length === 0) {
    if (customSubEl.classList.contains('visible')) {
      customSubEl.textContent = '';
      customSubEl.classList.remove('visible');
    }
    return;
  }
  const t = getVodEffectiveCurrentTime();
  const cue = cues.find(c => t >= c.start && t <= c.end);
  if (cue) {
    if (customSubEl.innerHTML !== cue.text) {
      customSubEl.innerHTML = cue.text;
    }
    customSubEl.classList.add('visible');
  } else {
    if (customSubEl.classList.contains('visible')) {
      customSubEl.textContent = '';
      customSubEl.classList.remove('visible');
    }
  }
}

function setupVodAudioTracks(stream, probeData) {
  const vodAudioMenu = document.getElementById('vod-audio-menu');
  const settingsAudioMenu = document.getElementById('vod-settings-audio-menu');
  const video = document.getElementById('vod-video');
  if (!vodAudioMenu || !video) return;

  const hlsTracks = Array.isArray(state.hlsVod?.audioTracks) ? state.hlsVod.audioTracks : [];
  const rawTracks = (stream?.audioTracks && stream.audioTracks.length > 0)
    ? stream.audioTracks
    : ((probeData?.audioTracks && probeData.audioTracks.length > 0)
        ? probeData.audioTracks
        : (hlsTracks.length ? hlsTracks : (video.audioTracks && video.audioTracks.length > 0 ? Array.from(video.audioTracks) : [])));
  const trackIndex = (track, index) => track.index != null && Number.isInteger(Number(track.index)) ? Number(track.index) : index;
  const trackLabel = track => track.label || track.name || track.language || track.lang || '';
  const trackLanguage = track => `${track.language || track.lang || ''} ${trackLabel(track)}`;

  const isAnime = state.currentCategory === 'anime' ||
    /anime|japon[eé]s|shonen|manga/i.test(`${state.activeVodItem?.category || ''} ${state.activeVodItem?.genre || ''}`);

  let preferredIdx = 0;
  if (rawTracks.length > 0) {
    if (isAnime) {
      const jpnIdx = rawTracks.findIndex(t => t.isJapanese || /\b(?:ja|jpn|japanese|japon[eé]s)\b/i.test(trackLanguage(t)));
      if (jpnIdx !== -1) preferredIdx = jpnIdx;
      else {
        const spaIdx = rawTracks.findIndex(t => t.isSpanish || /\b(?:es|spa|spanish|español)\b/i.test(trackLanguage(t)));
        if (spaIdx !== -1) preferredIdx = spaIdx;
      }
    } else {
      const spaIdx = rawTracks.findIndex(t => t.isSpanish || /\b(?:es|spa|spanish|español|latino)\b/i.test(trackLanguage(t)));
      if (spaIdx !== -1) preferredIdx = spaIdx;
    }
  }

  let selectedIdx = state.activeAudioStreamIndex !== undefined
    ? state.activeAudioStreamIndex
    : (Number.isInteger(Number(stream?.audioIndex)) ? Number(stream.audioIndex) : preferredIdx);
  state.activeAudioStreamIndex = selectedIdx;

  const renderAudioMenu = (menu) => {
    if (!menu) return;
    menu.innerHTML = '<div class="track-menu-header">Pistas de Audio (Idioma)</div>';
    if (rawTracks.length === 0) {
      menu.insertAdjacentHTML('beforeend', '<div class="track-menu-empty">Esta fuente no publica pistas alternativas.</div>');
      return;
    }

    rawTracks.forEach((t, idx) => {
      const selectedTrackIdx = trackIndex(t, idx);
      const isSelected = selectedTrackIdx === selectedIdx;
      const itemEl = document.createElement('div');
      itemEl.className = `track-menu-item ${isSelected ? 'selected' : ''}`;
      itemEl.setAttribute('data-track-idx', selectedTrackIdx);
      const label = trackLabel(t) || `Pista ${idx + 1}`;
      itemEl.textContent = label;
      if (isSelected) itemEl.insertAdjacentHTML('beforeend', '<span class="check-icon">✓</span>');

      itemEl.onclick = async (e) => {
        e.stopPropagation();
        selectedIdx = selectedTrackIdx;
        state.activeAudioStreamIndex = selectedTrackIdx;
        if (stream) stream.audioIndex = selectedTrackIdx;
        renderAudioMenu(vodAudioMenu);
        renderAudioMenu(settingsAudioMenu);

        if (state.hlsVod?.audioTracks?.length > 1) {
          state.hlsVod.audioTrack = idx;
          showToast(`🌐 Audio: ${label}`);
        } else if (video.audioTracks && video.audioTracks.length > 1) {
          for (let a = 0; a < video.audioTracks.length; a++) {
            video.audioTracks[a].enabled = (a === selectedTrackIdx);
          }
          showToast(`🌐 Audio: ${label}`);
        } else if (stream?.infoHash || stream?.relayAudioSwitch) {
          const curTime = Math.floor(getVodEffectiveCurrentTime());
          showToast(`🌐 Cambiando audio a: ${label}…`);
          await reloadVodAt(curTime, selectedTrackIdx);
        } else {
          showToast('Esta fuente no permite cambiar la pista de audio.');
        }
        setTimeout(() => vodAudioMenu.classList.remove('active'), 250);
      };

      menu.appendChild(itemEl);
    });
  };

  renderAudioMenu(vodAudioMenu);
  renderAudioMenu(settingsAudioMenu);

  const currentTrack = Number(stream?.audioIndex);
  if (stream?.relayAudioSwitch && rawTracks.length > 1 && preferredIdx !== currentTrack && !stream.preferredAudioApplied) {
    stream.preferredAudioApplied = true;
    stream.audioIndex = preferredIdx;
    state.activeAudioStreamIndex = preferredIdx;
    reloadVodAt(Math.floor(getVodEffectiveCurrentTime()), preferredIdx);
  }
}

async function loadSubtitlesForPlayer(imdbId, sNum, epNum, type, stream = null, probeData = null, session = vodSession) {
  const video = document.getElementById('vod-video');
  const subsMenu = document.getElementById('vod-subs-menu');
  const settingsSubsMenu = document.getElementById('vod-settings-subs-menu');
  const customSubEl = document.getElementById('vod-custom-subtitles');
  if (!video || !subsMenu) return;

  // Clear previous tracks & overlay
  video.querySelectorAll('track').forEach(t => t.remove());
  state.activeSubtitleCues = null;
  if (customSubEl) {
    customSubEl.textContent = '';
    customSubEl.classList.remove('visible');
  }

  let subList = [];

  // 1. Portal subtitles
  if (Array.isArray(stream?.subtitles) && stream.subtitles.length > 0) {
    stream.subtitles.forEach((s, idx) => {
      const lang = (s.lang || '').toLowerCase();
      const isSpa = /spa|es|lat/.test(lang);
      const isEng = /eng|en/.test(lang);
      let label = isSpa ? '🇪🇸 Español (Oficial)' : (isEng ? '🇺🇸 English (Official)' : `Subtítulo ${idx + 1} (${lang.toUpperCase()})`);
      subList.push({
        url: s.url,
        lang: lang || 'es',
        label: label,
        isSpanish: isSpa,
        source: 'portal'
      });
    });
  }

  // 2. Query community subtitles (OpenSubtitles) if missing Spanish or if no portal subtitles
  let resolvedImdbId = imdbId;
  const activeItem = state.activeVodItem;
  if (!resolvedImdbId && activeItem?.title) {
    try {
      const match = await resolveTitleId(activeItem.title, type, { seasonNum: sNum, episodeNum: epNum }, false, session?.controller?.signal);
      if (match?.imdbId) resolvedImdbId = match.imdbId;
    } catch (_) {}
  }

  const hasSpanishPortalSub = subList.some(s => s.isSpanish);
  if ((!subList.length || !hasSpanishPortalSub) && resolvedImdbId) {
    try {
      const idQuery = (sNum && epNum) ? `${resolvedImdbId}:${sNum}:${epNum}` : resolvedImdbId;
      const url = `https://opensubtitles-v3.strem.io/subtitles/${type}/${idQuery}.json`;
      const data = await fetchVodResource(url, session?.controller?.signal, 8000);
      if (session === vodSession && Array.isArray(data?.subtitles)) {
        data.subtitles.forEach(s => {
          const lang = (s.lang || '').toLowerCase();
          const isSpa = /^(spa|es|lat|spl)/i.test(lang) || /spanish|español|latino/i.test(s.label || s.subtitleFileName || s.movieReleaseName || '');
          const isEng = /^(eng|en)/i.test(lang) || /english|ingl[eé]s/i.test(s.label || s.subtitleFileName || s.movieReleaseName || '');
          if (isSpa || isEng) {
            subList.push({
              url: s.url,
              lang: s.lang,
              label: isSpa ? `🇪🇸 Español (${s.releaseGroup || 'Comunidad'})` : `🇺🇸 English (${s.releaseGroup || 'CC'})`,
              isSpanish: isSpa,
              source: 'opensubtitles'
            });
          }
        });
      }
    } catch (e) {
      console.warn('[Subtitles] OpenSubtitles query error:', e);
    }
  }

  // 3. Embedded subtitles from probeData
  if (probeData && Array.isArray(probeData.subTracks)) {
    probeData.subTracks.forEach(st => {
      subList.push({
        url: `http://127.0.0.1:11472/sub_embed/${stream.infoHash}/${stream.fileIdx}/${st.streamIndex}`,
        lang: st.lang,
        label: st.label,
        isSpanish: st.isSpanish,
        source: 'embedded'
      });
    });
  }

  if (session !== vodSession) return;
  const hlsSubtitleTracks = Array.isArray(state.hlsVod?.subtitleTracks) ? state.hlsVod.subtitleTracks : [];
  hlsSubtitleTracks.forEach((track, index) => {
    const lang = String(track.lang || track.language || '').toLowerCase();
    subList.push({
      index,
      lang,
      label: track.name || track.label || lang.toUpperCase() || `Subtítulo ${index + 1}`,
      isSpanish: /^(es|spa|es-\w+|spa-\w+)/i.test(lang),
      source: 'hls'
    });
  });

  // Native AVPlayer text tracks are available on direct HLS and some MP4 sources.
  if (!hlsSubtitleTracks.length && video.textTracks) {
    Array.from(video.textTracks).forEach((track, index) => {
      const lang = String(track.language || '').toLowerCase();
      if (!track.label && !lang) return;
      subList.push({
        index,
        lang,
        label: track.label || lang.toUpperCase() || `Subtítulo ${index + 1}`,
        isSpanish: /^(es|spa|es-\w+|spa-\w+)/i.test(lang),
        source: 'native'
      });
    });
  }

  const spanishSubs = subList.filter(s => s.isSpanish);
  const englishSubs = subList.filter(s => !s.isSpanish && /en/i.test(s.lang));
  const otherSubs = subList.filter(s => !s.isSpanish && !/en/i.test(s.lang));
  const allAvailableSubs = [...spanishSubs, ...englishSubs, ...otherSubs];

  // Auto-activate Spanish subtitles if available (especially for anime and foreign series)
  const isAnime = state.currentCategory === 'anime' ||
    /anime|japon[eé]s|shonen|manga/i.test(`${state.activeVodItem?.category || ''} ${state.activeVodItem?.genre || ''}`);
  let autoSub = spanishSubs.length > 0 ? spanishSubs[0] : null;

  const subtitleKey = subItem => subItem ? (subItem.url || `${subItem.source}:${subItem.index}`) : null;
  let activeSubUrl = subtitleKey(autoSub);

  const activateSubtitle = async (subItem) => {
    if (session !== vodSession) return;
    const request = Symbol();
    session.subtitleRequest = request;
    session.restoreSubtitle = () => activateSubtitle(subItem);
    if (!subItem) {
      activeSubUrl = null;
      state.activeSubtitleCues = null;
      if (session.activeSubBlobUrl) {
        try { URL.revokeObjectURL(session.activeSubBlobUrl); } catch (_) {}
        session.activeSubBlobUrl = null;
      }
      if (state.hlsVod) {
        state.hlsVod.subtitleTrack = -1;
        state.hlsVod.subtitleDisplay = false;
      }
      video.querySelectorAll('track').forEach(t => t.remove());
      if (video.textTracks) Array.from(video.textTracks).forEach(track => { track.mode = 'disabled'; });
      if (customSubEl) {
        customSubEl.textContent = '';
        customSubEl.classList.remove('visible');
      }
      renderSubsMenus();
      showToast('💬 Subtítulos desactivados');
      return;
    }

    activeSubUrl = subtitleKey(subItem);
    renderSubsMenus();

    state.activeSubtitleCues = null;
    if (session.activeSubBlobUrl) {
      try { URL.revokeObjectURL(session.activeSubBlobUrl); } catch (_) {}
      session.activeSubBlobUrl = null;
    }
    video.querySelectorAll('track').forEach(t => t.remove());
    if (customSubEl) {
      customSubEl.textContent = '';
      customSubEl.classList.remove('visible');
    }
    if (state.hlsVod) {
      state.hlsVod.subtitleTrack = -1;
      state.hlsVod.subtitleDisplay = false;
    }
    if (video.textTracks) Array.from(video.textTracks).forEach(track => { track.mode = 'disabled'; });

    if (subItem.source === 'hls') {
      if (!state.hlsVod) return showToast('Esta fuente no permite cambiar la pista de subtítulos.');
      state.hlsVod.subtitleDisplay = true;
      state.hlsVod.subtitleTrack = subItem.index;
      showToast(`💬 Subtítulos: ${subItem.label}`);
      return;
    }
    if (subItem.source === 'native') {
      const nativeTrack = video.textTracks?.[subItem.index];
      if (!nativeTrack) return showToast('Esta fuente no permite cambiar la pista de subtítulos.');
      nativeTrack.mode = 'showing';
      showToast(`💬 Subtítulos: ${subItem.label}`);
      return;
    }

    // Direct fetch for local engine/proxy endpoints; proxy through /sub for remote external URLs
    const isLocalUrl = subItem.url && (subItem.url.startsWith('http://127.0.0.1:') || subItem.url.startsWith('http://localhost:'));
    const proxyUrl = (subItem.source === 'embedded' || isLocalUrl)
      ? subItem.url
      : `http://127.0.0.1:11472/sub?url=${encodeURIComponent(subItem.url)}`;

    try {
      const resp = await fetch(proxyUrl, { signal: session?.controller?.signal });
      if (session !== vodSession) return;
      if (!resp.ok) throw new Error('La fuente rechazó la descarga de subtítulos.');
      const text = await resp.text();
      if (session !== vodSession || session.subtitleRequest !== request) return;
      const cues = parseVttCues(text);
      if (!cues.length) throw new Error('La pista no contiene subtítulos válidos.');

      // 1. Attach native WebVTT track for native WebKit / AVPlayer / Fullscreen / PiP
      video.querySelectorAll('track').forEach(t => t.remove());
      const vttText = text.startsWith('WEBVTT') ? text : srtToVtt(text);
      const vttBlob = new Blob([vttText], { type: 'text/vtt' });
      const blobUrl = URL.createObjectURL(vttBlob);
      session.activeSubBlobUrl = blobUrl;

      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = subItem.label;
      track.srclang = subItem.lang || 'es';
      track.src = blobUrl;
      track.default = true;
      video.appendChild(track);
      track.mode = 'showing';

      // 2. Set DOM overlay cues (supports shifted offset playback and styled display)
      state.activeSubtitleCues = cues;
      showToast(`💬 Subtítulos: ${subItem.label}`);
      updateActiveSubtitleCue();
    } catch (err) {
      if (session !== vodSession || session.subtitleRequest !== request) return;
      activeSubUrl = null;
      renderSubsMenus();
      console.warn('[Subtitles] Failed to fetch or parse subtitle:', err);
      showToast('⚠️ No se pudo cargar la pista de subtítulos');
    }
  };

  const renderSubsMenus = () => {
    [subsMenu, settingsSubsMenu].forEach(menu => {
      if (!menu) return;
      menu.innerHTML = '<div class="track-menu-header">Subtítulos (CC / Traducción)</div>';

      const isOffSelected = !activeSubUrl;
      const offItem = document.createElement('div');
      offItem.className = `track-menu-item ${isOffSelected ? 'selected' : ''}`;
      offItem.innerHTML = `Desactivados (Off) ${isOffSelected ? '<span class="check-icon">✓</span>' : ''}`;
      offItem.onclick = (e) => {
        e.stopPropagation();
        activateSubtitle(null);
        setTimeout(() => subsMenu.classList.remove('active'), 200);
      };
      menu.appendChild(offItem);

      if (allAvailableSubs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'track-menu-empty';
        empty.textContent = 'No hay subtítulos disponibles para este título.';
        menu.appendChild(empty);
        return;
      }

      allAvailableSubs.forEach(s => {
        const isSelected = activeSubUrl === subtitleKey(s);
        const itemEl = document.createElement('div');
        itemEl.className = `track-menu-item ${isSelected ? 'selected' : ''}`;
        itemEl.textContent = s.label;
        if (isSelected) {
          const check = document.createElement('span');
          check.className = 'check-icon';
          check.textContent = '✓';
          itemEl.appendChild(check);
        }
        itemEl.onclick = (e) => {
          e.stopPropagation();
          activateSubtitle(s);
          setTimeout(() => subsMenu.classList.remove('active'), 200);
        };
        menu.appendChild(itemEl);
      });
    });
  };

  renderSubsMenus();

  if (autoSub) {
    activateSubtitle(autoSub);
  }
}

// ================= VOD DETAIL MODAL ================= //
function itemHasKnownEpisodes(item) {
  const seasons = Array.isArray(item.seasonList) ? item.seasonList : (Array.isArray(item.seasons) ? item.seasons : []);
  return seasons.some(season => Array.isArray(season.episodes) && season.episodes.some(ep =>
    Number.isInteger(Number(ep.episodeNum || ep.epNum || ep.num)) && Number(ep.episodeNum || ep.epNum || ep.num) > 0
  ));
}

async function ensureSeriesEpisodes(item, type) {
  const originalId = item.id;
  const cacheKey = `swordtv_episode_metadata_v3_${originalId}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (Array.isArray(cached?.seasonList) && cached.seasonList.length && Date.now() - Number(cached.updatedAt || 0) < 21600000) {
      item.imdbId = item.imdbId || cached.imdbId;
      item.portalId = item.portalId || cached.portalId;
      if (cached.portalId) { item.id = cached.portalId; item.portal = true; }
      item.seasonList = cached.seasonList;
      item.seasons = cached.seasonList.length;
      item.episodesCount = cached.seasonList.reduce((sum, season) => sum + season.episodes.length, 0);
      return;
    }
  } catch (_) {}

  const knownSeries = findExactTitleMatch([...SERIES, ...ANIME, ...KIDS, ...NOVELAS, ...DOCS_ITEMS]
    .filter(candidate => candidate.portal || /^[0-9a-fA-F]{32}$/.test(candidate.id || '')), item.title);
  if (knownSeries && !item.portal && !/^[0-9a-fA-F]{32}$/.test(item.id || '')) {
    item.id = knownSeries.id;
    item.portalId = knownSeries.id;
    item.portal = true;
  }

  // Resolve a portal series only by an exact title match; fuzzy results can point at another show.
  if (!item.portal && !/^tt\d+$/.test(originalId || '') && !/^[0-9a-fA-F]{32}$/.test(originalId || '')) {
    try {
      const cleanTitle = (item.title || '').replace(/\s*\(\d{4}\).*$/, '').replace(/\s*-\s*T\d+:E\d+.*$/, '').trim();
      if (cleanTitle) {
        const sResp = await fetch(`http://127.0.0.1:11472/api/vod/search?q=${encodeURIComponent(cleanTitle)}`);
        const sData = await sResp.json();
        if (sData.ok && Array.isArray(sData.items)) {
          const match = findExactTitleMatch(sData.items, cleanTitle);
          if (match && (match.kind === 'serie' || match.type === 'teleplay' || match.type === 'series') && match.id) {
            item.portalId = match.id;
            item.id = match.id;
            item.portal = true;
          }
        }
      }
    } catch (_) {}
  }

  // Portal series expose seasons as separate IDs; query each one for its episode list.
  if (item.portal || /^[0-9a-fA-F]{32}$/.test(item.id)) {
    try {
      const resp = await fetch(`http://127.0.0.1:11472/api/vod/detail?id=${encodeURIComponent(item.id)}`);
      const data = await resp.json();
      if (data.ok) {
        const portalId = item.id;
        const seasonRefs = (Array.isArray(data.seasons) ? data.seasons : []).filter(season => season?.id);
        if (!seasonRefs.some(season => season.id === portalId)) {
          const titleSeason = (data.item?.title || item.title || '').match(/(?:temporada\s*|\b[TS])(\d+)\b/i);
          seasonRefs.push({ id: portalId, number: Number(titleSeason?.[1]) || 1 });
        }
        seasonRefs.sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
        const seasonList = await Promise.all(seasonRefs.map(async (season, idx) => {
          let episodes = season.id === portalId ? (data.episodes || []) : [];
          try {
            if (season.id !== portalId) {
            const seasonResp = await fetch(`http://127.0.0.1:11472/api/vod/detail?id=${encodeURIComponent(season.id)}`);
            const seasonData = await seasonResp.json();
            if (seasonData.ok && Array.isArray(seasonData.episodes)) episodes = seasonData.episodes;
            }
          } catch (_) {}
          const seasonNum = Number(season.number) > 0 ? Number(season.number) : idx + 1;
          return {
            id: season.id,
            seasonId: season.id,
            seasonNum,
            season: seasonNum,
            title: `Temporada ${seasonNum}`,
            episodes: episodes.map((ep, epIdx) => ({
              id: ep.id,
              title: ep.title || ep.name || `Capítulo ${epIdx + 1}`,
              episodeNum: Number(ep.number || epIdx + 1),
              seasonNum,
              seasonId: season.id,
              duration: ep.duration || '',
              quality: ep.quality || '1080p HD',
              thumbnail: ep.picture || item.poster,
              synopsis: ep.description || item.synopsis,
              portal: true,
              parentId: portalId
            }))
          };
        }));

        const verifiedSeasons = seasonList.filter(season => season.episodes.length > 0);
        if (verifiedSeasons.length && (!seasonRefs.length || verifiedSeasons.length === seasonRefs.length)) {
          item.seasonList = verifiedSeasons;
          item.seasons = verifiedSeasons.length;
          item.episodesCount = verifiedSeasons.reduce((sum, season) => sum + season.episodes.length, 0);
          const cache = JSON.stringify({ portalId, seasonList: verifiedSeasons, updatedAt: Date.now() });
          localStorage.setItem(cacheKey, cache);
          if (portalId !== originalId) localStorage.setItem(`swordtv_episode_metadata_v3_${portalId}`, cache);
          return;
        }
      }
    } catch (err) {
      console.warn('[Catalog] Portal episodes query error:', err);
    }
  }

  // Static placeholder episodes are retained only if the verified catalog lookup is unavailable.
  let imdbId = item.imdbId || (/^tt\d+$/.test(originalId || '') ? originalId : '');
  if (!imdbId) {
    const resolved = await resolveTitleId(item.title, type, null, false);
    imdbId = resolved?.imdbId || '';
  }
  if (!/^tt\d+$/.test(imdbId)) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`, { signal: controller.signal });
    if (!response.ok) return;
    const data = await response.json();
    const seasonList = formatSeriesSeasonList(data.meta?.videos);
    if (!seasonList.length) return;
    item.imdbId = imdbId;
    item.seasonList = seasonList;
    item.seasons = seasonList.length;
    item.episodesCount = seasonList.reduce((sum, season) => sum + season.episodes.length, 0);
    localStorage.setItem(cacheKey, JSON.stringify({ imdbId, seasonList, updatedAt: Date.now() }));
  } catch (err) {
    console.warn('[Catalog] Could not load verified episodes:', err);
  } finally {
    clearTimeout(timeout);
  }
}

async function openVodDetailModal(item, type = 'movie') {
  const isSeriesItem = type === 'series' || type === 'anime' || item.type === 'series' || item.type === 'anime';
  const seriesType = type === 'anime' || item.type === 'anime' ? 'anime' : 'series';
  if (isSeriesItem) await ensureSeriesEpisodes(item, seriesType);
  state.activeVodItem = item;
  const modal = document.getElementById('vod-detail-modal');
  const heroHeader = document.getElementById('modal-hero-header');
  const posterImg = document.getElementById('modal-poster-img');
  const badgesBox = document.getElementById('modal-badges-box');
  const titleEl = document.getElementById('modal-title');
  const submetaEl = document.getElementById('modal-submeta');
  const synopsisEl = document.getElementById('modal-synopsis');
  const castEl = document.getElementById('modal-cast-info');
  const epContainer = document.getElementById('modal-episodes-container');
  const favBtn = document.getElementById('modal-fav-btn');

  heroHeader.style.backgroundImage = `url('${item.backdrop || item.poster}')`;
  posterImg.src = item.poster;
  titleEl.textContent = item.title;
  submetaEl.textContent = `${item.year} • ${item.episodesCount ? `${item.episodesCount} Episodios` : (item.duration || 'Temporada 1')} • ${item.genre}`;
  synopsisEl.textContent = item.synopsis;
  castEl.innerHTML = item.cast ? `<b>Reparto:</b> ${item.cast}<br><b>Dirección:</b> ${item.director || 'N/A'}` : '';

  const inEmission = isSeriesItem && isMediaInEmission(item);
  badgesBox.innerHTML = `
    <span class="badge badge-4k">${item.quality || '1080p HD'}</span>
    <span class="badge badge-rating">⭐ ${item.rating || '8.9'}</span>
    <span class="badge badge-hd">${item.genre}</span>
    ${inEmission ? '<span class="badge badge-airing">🔴 EN EMISIÓN</span>' : ''}
  `;

  const isFav = state.favorites.some(f => f.id === item.id);
  favBtn.textContent = isFav ? '★ En Favoritos' : '☆ Agregar a Favoritos';

  favBtn.onclick = async () => {
    await toggleFav({
      id: item.id,
      title: item.title,
      category: type,
      logo: item.poster,
      stream_url: item.streamUrl || (item.seasons?.[0]?.episodes?.[0]?.url || '')
    });
    const stillFav = state.favorites.some(f => f.id === item.id);
    favBtn.textContent = stillFav ? '★ En Favoritos' : '☆ Agregar a Favoritos';
    updateFavCounterBadge();
  };

  const rawSeasons = Array.isArray(item.seasonList) ? item.seasonList : (Array.isArray(item.seasons) ? item.seasons : []);
  const cleanSeasons = rawSeasons
    .map(season => {
      const sNum = Number(season.seasonNum || season.season);
      const seen = new Set();
      const episodes = (Array.isArray(season.episodes) ? season.episodes : [])
        .map(ep => ({ ...ep, episodeNum: Number(ep.episodeNum || ep.epNum || ep.num), seasonNum: sNum, seasonId: ep.seasonId || season.seasonId || season.id || '' }))
        .filter(ep => Number.isInteger(ep.episodeNum) && ep.episodeNum > 0 && !seen.has(ep.episodeNum) && seen.add(ep.episodeNum))
        .sort((a, b) => a.episodeNum - b.episodeNum);
      return { ...season, seasonNum: sNum, season: sNum, episodes };
    })
    .filter(season => Number.isInteger(season.seasonNum) && season.seasonNum > 0 && season.episodes.length > 0)
    .sort((a, b) => a.seasonNum - b.seasonNum);
  const hasKnownEpisodes = cleanSeasons.some(season => season.episodes.length > 0);

  // Check for saved resume progress
  const savedProgress = getVodProgress(item.id);
  const playBtn = document.getElementById('modal-play-btn');
  if (playBtn) {
    playBtn.disabled = isSeriesItem && !hasKnownEpisodes;
    if (playBtn.disabled) {
      playBtn.textContent = 'Capítulos no disponibles';
    } else if (savedProgress && savedProgress.time > 15) {
      playBtn.textContent = isSeriesItem
        ? `▶ Reanudar T${savedProgress.seasonNum || 1}:E${savedProgress.episodeNum || 1} (${formatTime(savedProgress.time)})`
        : `▶ Reanudar Película (${formatTime(savedProgress.time)})`;
    } else {
      playBtn.textContent = isSeriesItem ? '▶ Reproducir Episodio 1' : '▶ Reproducir Película';
    }
  }

  document.getElementById('modal-play-btn').onclick = () => {
    if (isSeriesItem && !hasKnownEpisodes) {
      showToast('No hay capítulos con temporada y episodio verificados para este título.');
      return;
    }
    modal.classList.remove('open');
    modal.classList.remove('active');
    if (hasKnownEpisodes) {
      const savedSeason = cleanSeasons.find(season => season.seasonNum === Number(savedProgress?.seasonNum));
      const savedEpisode = savedSeason?.episodes.find(ep => ep.episodeNum === Number(savedProgress?.episodeNum));
      const targetEp = savedEpisode || cleanSeasons[0].episodes[0];
      const sNum = targetEp.seasonNum;
      const epNum = targetEp.episodeNum;
      promptOrPlayVod({
        ...item,
        id: targetEp.id || item.id,
        episodeId: targetEp.id,
        parentId: item.id,
        parentTitle: item.title,
        episodeNum: epNum,
        seasonNum: sNum,
        seasonId: targetEp.seasonId || targetEp.id || '',
        title: `${item.title} - T${sNum}:E${epNum} ${targetEp.title || ''}`.trim(),
        subtitle: `${item.genre || 'VOD'} • Temporada ${sNum} • 1080p HD`
      });
    } else {
      promptOrPlayVod(item);
    }
  };

  if (cleanSeasons.length > 0) {
    epContainer.style.display = 'block';
    const seasonTabs = document.getElementById('modal-season-tabs');
    seasonTabs.innerHTML = '';

    cleanSeasons.forEach((season, sIdx) => {
      const sNum = Number(season.seasonNum || season.season || sIdx + 1);
      season.seasonNum = sNum;
      season.season = sNum;

      const isLastSeasonOfAiringSeries = inEmission && sIdx === cleanSeasons.length - 1;
      const isSeasonAiring = season.airing === true || season.isAiring === true || season.en_emision === true || season.status === 'en_emision' || season.status === 'airing' || isLastSeasonOfAiringSeries;

      const tab = document.createElement('button');
      tab.className = `filter-pill ${sIdx === 0 ? 'active' : ''}`;
      tab.textContent = isSeasonAiring ? `Temporada ${sNum} 🔴` : `Temporada ${sNum}`;
      if (isSeasonAiring) {
        tab.title = 'Temporada en emisión';
      }
      tab.addEventListener('click', () => {
        seasonTabs.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        renderSeasonEpisodes(season, item);
      });
      seasonTabs.appendChild(tab);
    });

    renderSeasonEpisodes(cleanSeasons[0], item);
  } else {
    epContainer.style.display = 'none';
  }

  modal.classList.add('open');
  modal.classList.add('active');
}

function renderSeasonEpisodes(season, seriesItem) {
  const episodeList = document.getElementById('modal-episode-list');
  episodeList.innerHTML = '';

  const parentProgress = getVodProgress(seriesItem.id);
  const sNum = Number(season.seasonNum || season.season || 1);
  const rawEpisodes = season.episodes || [];

  // Strictly sort episodes ascending by episode number (1, 2, 3...)
  const seenEpisodes = new Set();
  const episodes = rawEpisodes
    .map(ep => ({ ...ep, episodeNum: Number(ep.episodeNum || ep.epNum || ep.num) }))
    .filter(ep => Number.isInteger(ep.episodeNum) && ep.episodeNum > 0 && !seenEpisodes.has(ep.episodeNum) && seenEpisodes.add(ep.episodeNum))
    .sort((a, b) => a.episodeNum - b.episodeNum);

  episodes.forEach(ep => {
    const row = document.createElement('div');
    row.className = 'episode-row';
    const epNum = ep.episodeNum;
    ep.seasonNum = sNum;
      ep.seasonId = ep.seasonId || season.seasonId || season.id || '';

    // Only an episode-specific URL may bypass the exact T:E stream resolver.
    let streamUrl = ep.streamUrl || ep.url || '';
    if (!isUsableVodUrl(streamUrl)) {
      streamUrl = '';
    }

    // Check if this specific episode has saved progress
    const isWatched = parentProgress && parentProgress.seasonNum === sNum && parentProgress.episodeNum === epNum && parentProgress.time > 15;
    if (isWatched) {
      row.classList.add('episode-card-watched');
    }

    const pct = isWatched && parentProgress.duration ? Math.min(100, Math.round((parentProgress.time / parentProgress.duration) * 100)) : 0;
    const displayEpTitle = ep.title ? (ep.title.startsWith('Capítulo') || ep.title.startsWith('Episodio') ? ep.title : `Capítulo ${epNum} - ${ep.title}`) : `Capítulo ${epNum}`;

    row.innerHTML = `
      <img class="episode-thumb" src="${escapeHtml(ep.thumbnail || seriesItem.poster || 'assets/poster_placeholder.svg')}" alt="${escapeHtml(`${seriesItem.title} T${sNum}:E${epNum}`)}" loading="lazy" onerror="this.onerror=null;this.src='assets/poster_placeholder.svg'">
      <div class="episode-info" style="display: flex; align-items: center; gap: 8px;">
        <span class="episode-number">T${sNum}:E${epNum}</span>
        <span class="episode-title">${escapeHtml(displayEpTitle)}</span>
        ${isWatched ? `<span class="episode-watched-pill">⏱️ Visto hasta ${formatTime(parentProgress.time)} (${pct}%)</span>` : ''}
      </div>
      <div class="episode-duration">${escapeHtml(ep.duration || '')} ▶</div>
      ${isWatched ? `<div class="episode-progress-bar" style="width: ${pct}%;"></div>` : ''}
    `;

    row.addEventListener('click', () => {
      const modal = document.getElementById('vod-detail-modal');
      if (modal) {
        modal.classList.remove('open');
        modal.classList.remove('active');
      }
    const epData = {
        ...seriesItem,
        id: ep.id || seriesItem.id,
        episodeId: ep.id,
      seasonId: ep.seasonId || season.seasonId || season.id || '',
        parentId: seriesItem.id,
        parentTitle: seriesItem.title,
        episodeNum: epNum,
        seasonNum: sNum,
        title: `${seriesItem.title} - T${sNum}:E${epNum} ${displayEpTitle}`,
        subtitle: `${seriesItem.genre || 'VOD'} • Temporada ${sNum} • 1080p HD`,
        streamUrl,
        portal: !!(ep.portal || seriesItem.portal)
      };
      promptOrPlayVod(epData);
    });
    episodeList.appendChild(row);
  });
}

document.getElementById('modal-close-btn')?.addEventListener('click', () => {
  const modal = document.getElementById('vod-detail-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.classList.remove('active');
  }
});

// Stremio sources modal event listeners
document.getElementById('sources-modal-close-btn')?.addEventListener('click', () => {
  const modal = document.getElementById('stremio-sources-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.classList.remove('active');
  }
});
document.getElementById('stremio-sources-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'stremio-sources-modal') {
    e.target.classList.remove('open');
    e.target.classList.remove('active');
  }
});
document.getElementById('sources-search-btn')?.addEventListener('click', () => {
  const input = document.getElementById('sources-search-input');
  const val = input ? input.value.trim() : '';
  if (val && activeSourcesItem) {
    openStremioSourcesModal(activeSourcesItem, activeSourcesTargetEp, val);
  }
});
document.getElementById('sources-search-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('sources-search-btn')?.click();
  }
});

// Click outside modal backdrop to dismiss
document.getElementById('vod-detail-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'vod-detail-modal') {
    document.getElementById('vod-detail-modal').classList.remove('open');
    document.getElementById('vod-detail-modal').classList.remove('active');
  }
});

// ================= RESUME PLAYBACK SYSTEM ================= //
function getVodProgressKey(itemId) {
  return `swordtv_progress_${itemId}`;
}

function getVodProgress(itemId) {
  try {
    const raw = localStorage.getItem(getVodProgressKey(itemId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveVodProgress(data) {
  if (!data || !data.itemId) return;
  try {
    const progress = {
      itemId: data.itemId,
      itemTitle: data.itemTitle || '',
      category: data.category || 'vod',
      time: Math.floor(data.time || 0),
      duration: Math.floor(data.duration || 0),
      streamUrl: data.streamUrl || '',
      updatedAt: Date.now()
    };
    if (Number.isInteger(Number(data.episodeNum)) && Number(data.episodeNum) > 0) {
      progress.episodeNum = Number(data.episodeNum);
      progress.seasonNum = Number(data.seasonNum) > 0 ? Number(data.seasonNum) : 1;
      progress.episodeTitle = data.episodeTitle || '';
    }
    localStorage.setItem(getVodProgressKey(data.itemId), JSON.stringify(progress));
  } catch (e) {}
}

function makeVodHistoryItem(item, time, duration) {
  return {
    id: item.id,
    title: item.title || item.name || 'Video',
    category: item.category || item.type || 'vod',
    logo: item.poster || item.logo || 'assets/backdrop.png',
    stream_url: item.streamUrl || '',
    position_seconds: Math.max(0, Number(time) || 0),
    duration_seconds: Math.max(0, Number(duration) || 0),
    parent_id: item.parentId || null,
    parent_title: item.parentTitle || null,
    season_id: item.seasonId || null,
    season_num: Number(item.seasonNum) > 0 ? Number(item.seasonNum) : null,
    episode_num: Number(item.episodeNum) > 0 ? Number(item.episodeNum) : null
  };
}

function clearVodProgress(itemId) {
  try {
    localStorage.removeItem(getVodProgressKey(itemId));
  } catch (e) {}
}

let pendingResumeItem = null;

function closeResumeModal() {
  const modal = document.getElementById('vod-resume-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.classList.remove('active');
  }
  pendingResumeItem = null;
}

async function promptOrPlayVod(item) {
  const legacyEpisode = !item.episodeNum && item.title?.match(/^(.*?)\s+-\s+T(\d+):E(\d+)\b/);
  if (legacyEpisode) {
    const parent = { id: `history:${legacyEpisode[1]}`, title: legacyEpisode[1], poster: item.poster };
    await ensureSeriesEpisodes(parent, 'series');
    const episodes = (parent.seasonList || []).flatMap(season => season.episodes);
    const episode = episodes.find(ep => ep.id === item.id) || episodes.find(ep =>
      Number(ep.seasonNum) === Number(legacyEpisode[2]) && Number(ep.episodeNum) === Number(legacyEpisode[3]));
    if (!episode) return showToast('No se pudo localizar el episodio del historial. Ábrelo desde su serie.');
    item = { ...item, ...episode, parentId: parent.id, parentTitle: parent.title,
      title: `${parent.title} - T${episode.seasonNum}:E${episode.episodeNum}`, streamUrl: '', stream_url: '' };
  }
  if (!item.episodeNum && (item.type === 'series' || item.type === 'anime' || item.kind === 'serie' || item.seasonList || item.seasons)) {
    await ensureSeriesEpisodes(item, item.category || 'series');
    const progress = getVodProgress(item.id);
    const season = item.seasonList?.find(s => Number(s.seasonNum) === Number(progress?.seasonNum)) || item.seasonList?.[0];
    const episode = season?.episodes.find(e => Number(e.episodeNum) === Number(progress?.episodeNum)) || season?.episodes[0];
    if (!episode) return showToast('No se encontraron episodios disponibles para este título.');
    item = { ...item, ...episode, id: episode.id || item.id, parentId: item.id, parentTitle: item.title,
      title: `${item.title} - T${episode.seasonNum}:E${episode.episodeNum}`, streamUrl: episode.streamUrl || '' };
  }
  const itemId = item.parentId || item.id;
  let saved = getVodProgress(itemId);
  if (!saved && Number(item.position_seconds) > 15) {
    saveVodProgress({ itemId, itemTitle: item.parentTitle || item.title, time: item.position_seconds,
      duration: item.duration_seconds || 0, seasonNum: item.seasonNum, episodeNum: item.episodeNum, episodeTitle: item.title });
    saved = getVodProgress(itemId);
  }
  const savedEpisodeMatches = !item.episodeNum || (
    Number(saved?.episodeNum || 1) === Number(item.episodeNum) &&
    Number(saved?.seasonNum || 1) === Number(item.seasonNum || 1)
  );
  const canResume = saved && saved.time > 15 && savedEpisodeMatches &&
    (!saved.duration || saved.time < saved.duration - 20);
  
  // Close detail modal so no backdrops interfere
  const detailModal = document.getElementById('vod-detail-modal');
  if (detailModal) {
    detailModal.classList.remove('open');
    detailModal.classList.remove('active');
  }

  if (canResume) {
    pendingResumeItem = item;
    const modal = document.getElementById('vod-resume-modal');
    const titleEl = document.getElementById('resume-modal-title');
    const itemNameEl = document.getElementById('resume-modal-item-name');
    const timeEl = document.getElementById('resume-modal-time');

    if (titleEl) titleEl.textContent = item.parentTitle || item.title;
    if (itemNameEl) itemNameEl.textContent = saved.episodeTitle || item.title || 'Continuar viendo';
    if (timeEl) timeEl.textContent = `${formatTime(saved.time)} ${saved.duration ? '/ ' + formatTime(saved.duration) : ''}`;

    if (modal) {
      modal.classList.add('open');
      modal.classList.add('active');
    }
  } else {
    autoResolveAndPlayVod(item, item.episodeNum ? item : null);
  }
}

// ================= FLOATING VOD VIDEO PLAYER ================= //

function getVodEffectiveDuration() {
  if (state.vodTotalDuration && isFinite(state.vodTotalDuration) && state.vodTotalDuration > 0) {
    return state.vodTotalDuration;
  }
  const video = document.getElementById('vod-video');
  if (video && isFinite(video.duration) && video.duration > 0) {
    return (state.vodSeekOffset || 0) + video.duration;
  }
  const it = state.activeVodItem;
  if (it) {
    const rawDur = it.duration || (it.episode && it.episode.duration) || '';
    if (typeof rawDur === 'string') {
      const mMatch = rawDur.match(/(\d+)\s*m/i);
      const hMatch = rawDur.match(/(\d+)\s*h/i);
      let secs = 0;
      if (hMatch) secs += parseInt(hMatch[1], 10) * 3600;
      if (mMatch) secs += parseInt(mMatch[1], 10) * 60;
      if (secs > 0) return secs;
    }
  }
  return 0; // Unknown until the source provides a duration.
}

function getVodEffectiveCurrentTime() {
  const video = document.getElementById('vod-video');
  if (!video) return 0;
  const offset = state.vodSeekOffset || 0;
  return offset + (video.currentTime || 0);
}

function seekVodTo(targetSec) {
  const video = document.getElementById('vod-video');
  if (!video) return;
  const totalDur = getVodEffectiveDuration();
  if (!Number.isFinite(targetSec)) return;
  const clampedSec = Math.max(0, totalDur > 0 ? Math.min(totalDur, Math.floor(targetSec)) : Math.floor(targetSec));
  
  const pct = totalDur > 0 ? (clampedSec / totalDur) * 100 : 0;
  const progressFill = document.getElementById('vod-progress-fill');
  const progressThumb = document.getElementById('vod-progress-thumb');
  const timeDisplay = document.getElementById('vod-time-display');
  if (progressFill) progressFill.style.width = `${pct}%`;
  if (progressThumb) progressThumb.style.left = `${pct}%`;
  if (timeDisplay) timeDisplay.textContent = `${formatTime(clampedSec)} / ${formatTime(totalDur)}`;

  const stream = state.currentPlayingStream;
  if (stream && (stream.infoHash || stream.relayAudioSwitch)) {
    return reloadVodAt(clampedSec);
  } else if (state.activeVodItem && String(state.activeVodItem.streamUrl).includes('/s/')) {
    state.vodSeekOffset = clampedSec;
    const base = state.activeVodItem.streamUrl.split('?')[0];
    const audioParam = state.activeAudioStreamIndex !== undefined ? `&a=${state.activeAudioStreamIndex}` : '';
    video.src = `${base}?start=${clampedSec}${audioParam}`;
    video.load();
    video.play().catch(() => {});
  } else {
    video.currentTime = Math.max(0, clampedSec - (state.vodSeekOffset || 0));
  }
}

async function reloadVodAt(seconds, audio = state.activeAudioStreamIndex ?? 'auto') {
  const session = vodSession;
  const stream = state.currentPlayingStream;
  if (!session || (!stream?.infoHash && !stream?.relayAudioSwitch)) return;
  const audioIndex = Number.isInteger(Number(audio)) ? Number(audio) : (Number(stream.audioIndex) || 0);
  const request = Symbol();
  session.reloadRequest = request;
  session.starting = true;
  document.getElementById('vod-video')?.pause();
  showVodLoading(`Preparando reproducción desde ${formatTime(seconds)}…`);
  try {
    let url;
    if (stream.infoHash) {
      url = `http://127.0.0.1:11472/hls/${stream.infoHash}/${stream.fileIdx}/stream.m3u8?audio=${audioIndex}&t=${seconds}`;
      await fetchVodResource(url, session.controller.signal, 45000, true);
    } else {
      const switched = await fetchVodResource(
        `http://127.0.0.1:11472/api/vod/switch_audio?audio=${audioIndex}&time=${seconds}&source=${encodeURIComponent(stream.relayUrl || '')}`,
        session.controller.signal,
        45000
      );
      if (!switched.ok || !switched.streamUrl) throw new Error(switched.error || 'No se pudo cambiar la pista de audio.');
      url = switched.streamUrl;
    }
    if (session !== vodSession || session.reloadRequest !== request) return;
    state.vodSeekOffset = seconds;
    state.activeAudioStreamIndex = audioIndex;
    state.currentPlayingStream = { ...stream, relayUrl: url, audioIndex, preferredAudioApplied: true };
    await openVodPlayer({ ...state.activeVodItem, streamUrl: url }, 0, session);
    if (session === vodSession) {
      setupVodAudioTracks(state.currentPlayingStream, session.probeData
        ? { ...session.probeData, recommendedAudioIndex: audioIndex }
        : null);
      session.restoreSubtitle?.();
    }
  } catch (error) {
    if (session !== vodSession || session.reloadRequest !== request) return;
    session.starting = false;
    showVodLoading(`No se pudo cambiar la reproducción. ${error.message}`, true);
  }
}

function setupVodPlayer() {
  const overlay = document.getElementById('vod-player-overlay');
  const video = document.getElementById('vod-video');
  const closeBtn = document.getElementById('vod-player-close-btn');
  const playBtn = document.getElementById('vod-play-btn');
  const muteBtn = document.getElementById('vod-mute-btn');
  const volRange = document.getElementById('vod-vol-range');
  const aspectBtn = document.getElementById('vod-aspect-btn');
  const fsBtn = document.getElementById('vod-fs-btn');
  const pipBtn = document.getElementById('vod-pip-btn');
  const settingsBtn = document.getElementById('vod-settings-btn');
  const settingsPanel = document.getElementById('vod-settings-panel');
  const settingsCloseBtn = document.getElementById('vod-settings-close');
  const progressBox = document.getElementById('vod-progress-box');
  const progressFill = document.getElementById('vod-progress-fill');
  const timeDisplay = document.getElementById('vod-time-display');

  // Resume modal buttons
  document.getElementById('resume-modal-continue-btn')?.addEventListener('click', () => {
    if (!pendingResumeItem) return;
    const item = pendingResumeItem;
    const itemId = item.parentId || item.id;
    const saved = getVodProgress(itemId);
    const resumeTime = saved ? saved.time : 0;
    closeResumeModal();
    autoResolveAndPlayVod(item, item.episodeNum ? item : null, resumeTime);
  });

  document.getElementById('resume-modal-restart-btn')?.addEventListener('click', () => {
    if (!pendingResumeItem) return;
    const item = pendingResumeItem;
    const itemId = item.parentId || item.id;
    clearVodProgress(itemId);
    closeResumeModal();
    autoResolveAndPlayVod(item, item.episodeNum ? item : null);
  });

  document.getElementById('resume-modal-cancel-btn')?.addEventListener('click', closeResumeModal);
  document.getElementById('vod-resume-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'vod-resume-modal') closeResumeModal();
  });

  closeBtn?.addEventListener('click', () => closeVodPlayer());
  document.getElementById('vod-retry-btn')?.addEventListener('click', () => {
    if (vodSession) {
      const { item, targetEp, startTime } = vodSession;
      autoResolveAndPlayVod(item, targetEp, startTime);
    }
  });
  document.getElementById('vod-return-btn')?.addEventListener('click', () => closeVodPlayer(false));

  const setSettingsOpen = open => {
    settingsPanel?.classList.toggle('open', open);
    settingsPanel?.setAttribute('aria-hidden', String(!open));
    settingsBtn?.setAttribute('aria-expanded', String(open));
    showVodOsdTemporarily();
  };
  settingsBtn?.addEventListener('click', () => setSettingsOpen(!settingsPanel?.classList.contains('open')));
  settingsCloseBtn?.addEventListener('click', () => setSettingsOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && settingsPanel?.classList.contains('open')) setSettingsOpen(false);
  });

  // Click on video surface toggles play/pause
  video?.addEventListener('click', () => {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
    showVodOsdTemporarily();
  });

  video?.addEventListener('play', () => {
    if (playBtn) playBtn.textContent = '⏸';
  });

  video?.addEventListener('pause', () => {
    if (playBtn) playBtn.textContent = '▶';
  });

  playBtn?.addEventListener('click', () => {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  });

  muteBtn?.addEventListener('click', () => {
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? '🔇' : '🔊';
  });

  volRange?.addEventListener('input', (e) => {
    video.volume = parseFloat(e.target.value);
    video.muted = video.volume === 0;
    muteBtn.textContent = video.muted ? '🔇' : '🔊';
  });

  aspectBtn?.addEventListener('click', () => {
    state.currentAspectIndex = (state.currentAspectIndex + 1) % state.aspectRatios.length;
    const aspect = state.aspectRatios[state.currentAspectIndex];
    applyAspectRatio(video, aspect);
    aspectBtn.textContent = `Aspecto: ${aspect.toUpperCase()}`;
    showToast(`Aspecto: ${aspect.toUpperCase()}`);
  });

  fsBtn?.addEventListener('click', () => {
    toggleElementFullscreen(overlay);
  });

  pipBtn?.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (e) {}
  });

  let lastProgressSave = 0;
  let lastHistorySave = 0;
  let lastDecodedFrameCount = null;
  let lastDecodedFrameAt = Date.now();
  video?.addEventListener('playing', () => {
    const frames = Number(video.webkitDecodedFrameCount);
    if (Number.isFinite(frames)) lastDecodedFrameCount = frames;
    lastDecodedFrameAt = Date.now();
  });
  video?.addEventListener('timeupdate', () => {
    updateActiveSubtitleCue();
    const totalDur = getVodEffectiveDuration();
    const curTime = getVodEffectiveCurrentTime();
    const pct = totalDur > 0 ? Math.min(100, Math.max(0, (curTime / totalDur) * 100)) : 0;
    
    if (progressFill) progressFill.style.width = `${pct}%`;
    const progressThumb = document.getElementById('vod-progress-thumb');
    if (progressThumb) progressThumb.style.left = `${pct}%`;
    if (timeDisplay) {
      timeDisplay.textContent = `${formatTime(curTime)} / ${formatTime(totalDur)}`;
    }

    // Throttle progress writes while preserving the relay offset for resumed streams.
    const now = Date.now();
    const decodedFrames = Number(video.webkitDecodedFrameCount);
    if (!video.paused && Number.isFinite(decodedFrames)) {
      if (lastDecodedFrameCount === null || decodedFrames !== lastDecodedFrameCount) {
        lastDecodedFrameCount = decodedFrames;
        lastDecodedFrameAt = now;
      } else if (curTime > 10 && now - lastDecodedFrameAt > 15000) {
        const session = vodSession;
        const stream = state.currentPlayingStream;
        if (session && !session.frameRecoveryAttempted && (stream?.infoHash || stream?.relayAudioSwitch)) {
          session.frameRecoveryAttempted = true;
          logAppAction('VOD_VIDEO_FRAME_STALL', { title: state.activeVodItem?.title, currentTime: curTime }, 'PLAYER');
          reloadVodAt(Math.floor(curTime), state.activeAudioStreamIndex ?? stream.audioIndex ?? 0);
        }
      }
    }
    if (now - lastProgressSave > 2500 && state.activeVodItem) {
      lastProgressSave = now;
      const actualDuration = Number(state.vodTotalDuration) ||
        (Number.isFinite(video.duration) && video.duration > 0 ? (state.vodSeekOffset || 0) + video.duration : 0);
      if (curTime > 10 && (!actualDuration || curTime < actualDuration - 15)) {
        saveVodProgress({
          itemId: state.activeVodItem.parentId || state.activeVodItem.id,
          itemTitle: state.activeVodItem.parentTitle || state.activeVodItem.title,
          category: state.activeVodItem.category || 'vod',
          episodeNum: state.activeVodItem.episodeNum || state.activeVodItem.num,
          seasonNum: state.activeVodItem.seasonNum,
          episodeTitle: state.activeVodItem.title || '',
          time: curTime,
          duration: actualDuration,
          streamUrl: state.activeVodItem.streamUrl
        });
        if (now - lastHistorySave > 15000) {
          lastHistorySave = now;
          saveHistoryItem(makeVodHistoryItem(state.activeVodItem, curTime, actualDuration));
        }
      }
    }
  });

  video?.addEventListener('seeked', () => updateActiveSubtitleCue());

  // Interactive timeline scrubbing & seeking
  progressBox?.addEventListener('click', (e) => {
    const rect = progressBox.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const totalDur = getVodEffectiveDuration();
    seekVodTo(pos * totalDur);
  });

  const progressTooltip = document.getElementById('vod-progress-tooltip');
  progressBox?.addEventListener('mousemove', (e) => {
    const rect = progressBox.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const totalDur = getVodEffectiveDuration();
    const hoverSec = pos * totalDur;
    if (progressTooltip) {
      progressTooltip.style.left = `${pos * 100}%`;
      progressTooltip.textContent = formatTime(hoverSec);
    }
  });

  // Dedicated 10-second skip buttons
  const skipBackBtn = document.getElementById('vod-skip-back-btn');
  const skipFwdBtn = document.getElementById('vod-skip-fwd-btn');

  skipBackBtn?.addEventListener('click', () => {
    const cur = getVodEffectiveCurrentTime();
    seekVodTo(Math.max(0, cur - 10));
    showToast('⏪ -10 segundos');
  });

  skipFwdBtn?.addEventListener('click', () => {
    const cur = getVodEffectiveCurrentTime();
    seekVodTo(cur + 10);
    showToast('⏩ +10 segundos');
  });

  video?.addEventListener('ended', () => {
    if (playBtn) playBtn.textContent = '▶';
    if (state.activeVodItem) {
      clearVodProgress(state.activeVodItem.parentId || state.activeVodItem.id);
    }
    if (vodSession) vodSession.completed = true;
    showToast('Reproducción finalizada');
  });

  video?.addEventListener('error', () => {
    if (vodSession && !vodSession.starting && video.error) {
      showVodLoading('La reproducción se interrumpió. Puedes volver a buscar una fuente.', true);
    }
  });

  let lastVodX = -1;
  let lastVodY = -1;
  let lastVodMoveTime = 0;
  const onVodMouseMove = (e) => {
    const now = Date.now();
    if (now - lastVodMoveTime < 80) return;
    if (e && Math.abs(e.clientX - lastVodX) < 5 && Math.abs(e.clientY - lastVodY) < 5) return;
    if (e) {
      lastVodX = e.clientX;
      lastVodY = e.clientY;
    }
    lastVodMoveTime = now;
    showVodOsdTemporarily();
  };
  overlay?.addEventListener('mousemove', onVodMouseMove);
  overlay?.addEventListener('click', (e) => {
    if (e.target.closest('.player-osd button') || e.target.closest('.player-osd input') || e.target.closest('.vod-close-btn') || e.target.closest('.track-selector-menu')) return;
    showVodOsdTemporarily();
  });
  video?.addEventListener('dblclick', () => {
    if (!document.fullscreenElement) {
      overlay.requestFullscreen().catch(() => toggleFullscreen());
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}

function openVodPlayer(item, startTime = 0, session = vodSession) {
  if (!session || vodSession !== session) return Promise.reject(new Error('Reproducción cancelada.'));
  const video = document.getElementById('vod-video');
  const liveVideo = document.getElementById('live-video');
  liveVideo?.pause();
  if (state.hlsLive) { state.hlsLive.destroy(); state.hlsLive = null; }
  liveVideo?.removeAttribute('src');
  liveVideo?.load();
  state.activeVodItem = item;
  document.getElementById('vod-osd-title').textContent = item.title || item.name;
  document.getElementById('vod-osd-subtitle').textContent = item.subtitle || '';
  document.getElementById('vod-progress-fill').style.width = '0%';
  document.getElementById('vod-time-display').textContent = '00:00 / 00:00';
  document.getElementById('vod-play-btn').textContent = '⏸';

  video.pause();
  if (state.hlsVod) { state.hlsVod.destroy(); state.hlsVod = null; }
  video.removeAttribute('src');
  video.load();
  video.muted = false;
  video.volume = 0.9;
  video.onwaiting = () => {
    if (vodSession === session && !session.failed) showVodLoading('Cargando video…');
  };
  video.onplaying = () => {
    if (vodSession === session) hideVodLoading();
  };
  video.oncanplay = null;
  video.onerror = null;
  video.onloadedmetadata = () => {
    if (vodSession !== session) return;
    if (startTime > 0) video.currentTime = startTime;
    configureVodTrackMenus();
  };
  configureVodTrackMenus();
  document.getElementById('vod-player-overlay').classList.add('open', 'active');
  showVodOsdTemporarily();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('playing', playing);
      video.removeEventListener('timeupdate', timeUpdated);
      video.removeEventListener('error', failed);
      video.removeEventListener('canplay', safePlay);
      video.removeEventListener('loadeddata', safePlay);
      session.controller.signal.removeEventListener('abort', cancelled);
      if (error) { reject(error); return; }
      session.starting = false;
      hideVodLoading();
      const duration = Number(state.vodTotalDuration) ||
        (Number.isFinite(video.duration) && video.duration > 0 ? (state.vodSeekOffset || 0) + video.duration : 0);
      saveHistoryItem(makeVodHistoryItem(item, getVodEffectiveCurrentTime(), duration));
      resolve();
    };
    const playing = () => {
      if (!(video.videoWidth > 0)) return;
      logAppAction('VOD_PLAYING_ACTIVE', { title: item.title, currentTime: video.currentTime }, 'PLAYER');
      finish();
    };
    const timeUpdated = () => {
      if (video.currentTime > 0 && video.videoWidth > 0) {
        logAppAction('VOD_PLAYING_TIMEUPDATE', { title: item.title, currentTime: video.currentTime }, 'PLAYER');
        finish();
      }
    };
    const failed = () => {
      const errCode = video.error?.code || 'desconocido';
      logAppAction('VOD_PLAYBACK_ERROR', { title: item.title, code: errCode }, 'PLAYER');
      finish(new Error(`El reproductor rechazó esta fuente (código ${errCode}).`));
    };
    const cancelled = () => finish(new DOMException('Reproducción cancelada', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('La fuente no empezó a reproducirse a tiempo.')), 35000);
    video.addEventListener('playing', playing);
    video.addEventListener('timeupdate', timeUpdated);
    video.addEventListener('error', failed);
    session.controller.signal.addEventListener('abort', cancelled, { once: true });

    const safePlay = () => {
      if (vodSession !== session || session.controller.signal.aborted) return;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          playing();
        }).catch(err => {
          logAppAction('VOD_PLAY_PROMISE_NOTICE', { title: item.title, name: err.name, msg: err.message }, 'PLAYER');
          if (err.name === 'NotAllowedError') {
            video.muted = true;
            video.play().then(playing).catch(() => {});
          }
          // Do not fail immediately on transient play() rejections; wait for playing, timeupdate, or error
        });
      }
    };

    video.addEventListener('canplay', safePlay, { once: true });
    video.addEventListener('loadeddata', safePlay, { once: true });

    const isM3u8 = /\.m3u8(?:[?#]|$)/i.test(item.streamUrl);

    // Prioritize Native Apple WebKit AVPlayer (supports MP4, relay fMP4, and hardware-accelerated HLS H264 & H265 HEVC)
    if (!isM3u8 || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = item.streamUrl;
      video.load();
      safePlay();
    } else if (isM3u8 && window.Hls?.isSupported()) {
      const hls = new window.Hls({ enableWorker: true });
      hls.on(window.Hls.Events.MANIFEST_PARSED, safePlay);
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) {
          logAppAction('HLS_VOD_ERROR', { title: item.title, details: data.details }, 'PLAYER');
          finish(new Error('La fuente HLS no se pudo reproducir: ' + (data.details || '')));
        }
      });
      state.hlsVod = hls;
      hls.loadSource(item.streamUrl);
      hls.attachMedia(video);
    } else {
      video.src = item.streamUrl;
      video.load();
      safePlay();
    }
  });
}

function closeVodPlayer(resumeLive = true) {
  state.activeSubtitleCues = null;
  const customSubEl = document.getElementById('vod-custom-subtitles');
  if (customSubEl) {
    customSubEl.textContent = '';
    customSubEl.classList.remove('visible');
  }
  const closingSession = vodSession;
  vodSession = null;
  closingSession?.controller.abort();
  if (closingSession?.activeSubBlobUrl) {
    try { URL.revokeObjectURL(closingSession.activeSubBlobUrl); } catch (_) {}
    closingSession.activeSubBlobUrl = null;
  }
  const overlay = document.getElementById('vod-player-overlay');
  const video = document.getElementById('vod-video');
  video?.querySelectorAll('track').forEach(t => t.remove());
  clearInterval(closingSession?.loadingTimer);
  hideVodLoading();
  if (closingSession || state.activeVodItem) {
    vodAbortPending = vodAbortPending.then(() => fetch('http://127.0.0.1:11472/api/vod/abort')).catch(() => {});
  }
  const settingsPanel = document.getElementById('vod-settings-panel');
  const settingsBtn = document.getElementById('vod-settings-btn');
  settingsPanel?.classList.remove('open');
  settingsPanel?.setAttribute('aria-hidden', 'true');
  settingsBtn?.setAttribute('aria-expanded', 'false');
  if (video) {
    const currentTime = getVodEffectiveCurrentTime();
    const duration = Number(state.vodTotalDuration) ||
      (Number.isFinite(video.duration) && video.duration > 0 ? (state.vodSeekOffset || 0) + video.duration : 0);
    if (state.activeVodItem && currentTime > 10) {
      if (closingSession?.completed) {
        clearVodProgress(state.activeVodItem.parentId || state.activeVodItem.id);
      } else if (!duration || currentTime < duration - 15) {
        saveVodProgress({
          itemId: state.activeVodItem.parentId || state.activeVodItem.id,
          itemTitle: state.activeVodItem.parentTitle || state.activeVodItem.title,
          category: state.activeVodItem.category || state.activeVodItem.type || 'vod',
          episodeNum: state.activeVodItem.episodeNum || state.activeVodItem.num,
          seasonNum: state.activeVodItem.seasonNum,
          episodeTitle: state.activeVodItem.title || '',
          time: currentTime,
          duration,
          streamUrl: state.activeVodItem.streamUrl
        });
      }
      saveHistoryItem(makeVodHistoryItem(state.activeVodItem, currentTime, duration));
    }
    video.onwaiting = video.onplaying = video.onloadedmetadata = null;
    video.pause();
    if (state.hlsVod) {
      try {
        state.hlsVod.destroy();
      } catch (e) {}
      state.hlsVod = null;
    }
    video.removeAttribute('src');
    video.load();
  }
  if (overlay) {
    overlay.classList.remove('open');
    overlay.classList.remove('active');
    overlay.classList.remove('mouse-idle');
    overlay.classList.remove('osd-active');
  }
  const vodOsd = document.getElementById('vod-player-osd');
  if (vodOsd) vodOsd.classList.remove('visible');
  const vodCloseBtn = document.getElementById('vod-player-close-btn');
  if (vodCloseBtn) vodCloseBtn.classList.remove('visible');
  clearTimeout(state.vodOsdHideTimeout);

  state.activeVodItem = null;
  state.currentPlayingStream = null;

  // Resume Live TV ONLY if requested and user is currently on the Live category
  if (resumeLive && state.currentCategory === 'live' && state.currentChannel) {
    playLiveChannel(state.currentChannel);
  }
}

function showVodOsdTemporarily() {
  const osd = document.getElementById('vod-player-osd');
  const overlay = document.getElementById('vod-player-overlay');
  const closeBtn = document.getElementById('vod-player-close-btn');
  if (!osd) return;

  osd.classList.add('visible');
  if (overlay) {
    overlay.classList.remove('mouse-idle');
    overlay.classList.add('osd-active');
  }
  if (closeBtn) {
    closeBtn.classList.add('visible');
  }

  clearTimeout(state.vodOsdHideTimeout);
  state.vodOsdHideTimeout = setTimeout(() => {
    if (document.getElementById('vod-settings-panel')?.classList.contains('open') || document.getElementById('vod-buffering-overlay')?.style.display === 'flex') return;
    osd.classList.remove('visible');
    if (overlay) {
      overlay.classList.remove('osd-active');
      overlay.classList.add('mouse-idle');
    }
    if (closeBtn) {
      closeBtn.classList.remove('visible');
    }
  }, 2000);
}

function formatTime(sec) {
  if (!sec || isNaN(sec) || !isFinite(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

// ================= PARENTAL CONTROL MODAL ================= //
function showParentalPinModal(onSuccess) {
  const modal = document.getElementById('parental-pin-modal');
  const input = document.getElementById('parental-pin-verify-input');
  const submitBtn = document.getElementById('parental-pin-submit-btn');
  const cancelBtn = document.getElementById('parental-pin-cancel-btn');

  input.value = '';
  modal.classList.add('open');
  setTimeout(() => input.focus(), 100);

  const verify = () => {
    if (input.value === state.settings.parental_control_pin) {
      modal.classList.remove('open');
      showToast('Acceso desbloqueado');
      onSuccess();
    } else {
      showToast('PIN incorrecto. Intenta de nuevo');
      input.value = '';
      input.focus();
    }
  };

  submitBtn.onclick = verify;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') verify();
  };
  cancelBtn.onclick = () => modal.classList.remove('open');
}

// ================= CATALOG AUTO-SYNC CONTROLLER ================= //

function setupCatalogSyncUI() {
  const headerSyncBtn = document.getElementById('btn-sync-catalog');
  if (headerSyncBtn) {
    headerSyncBtn.addEventListener('click', () => {
      triggerStartupCatalogSync(true);
    });
  }

  const settingsSyncBtn = document.getElementById('btn-settings-sync-catalog');
  if (settingsSyncBtn) {
    settingsSyncBtn.addEventListener('click', () => {
      triggerStartupCatalogSync(true);
    });
  }

  const autoSyncToggle = document.getElementById('setting-auto-sync-catalog');
  if (autoSyncToggle) {
    autoSyncToggle.checked = state.settings.auto_sync_catalog !== false;
    autoSyncToggle.addEventListener('change', () => {
      state.settings.auto_sync_catalog = autoSyncToggle.checked;
      invoke('save_settings', { newSettings: state.settings });
      showToast(autoSyncToggle.checked ? 'Actualización al abrir: Activada' : 'Actualización al abrir: Desactivada');
    });
  }

  const validateChannelsBtn = document.getElementById('btn-validate-channels');
  validateChannelsBtn?.addEventListener('click', reviewChannels);

  updateSyncStatusUI();
}

function updateSyncStatusUI() {
  const statusDesc = document.getElementById('catalog-sync-status-desc');
  if (statusDesc) {
    const syncInfo = getLastSyncInfo();
    statusDesc.innerHTML = `
      <span style="color: var(--accent-cyan); font-weight: 600;">Sincronizado:</span> ${syncInfo.text} • 
      <span style="color: #94a3b8;">${MOVIES.length} Películas, ${SERIES.length} Series, ${ANIME.length} Animes, ${KIDS.length} Infantil, ${DOCS_ITEMS.length} Documentales</span>
    `;
  }
}

async function triggerStartupCatalogSync(manual = false) {
  if (state.isSyncingCatalog) return;
  if (!manual && state.settings.auto_sync_catalog === false) {
    console.log('[CatalogSync] Auto-update on startup disabled by user preference');
    return;
  }

  state.isSyncingCatalog = true;

  const headerBtn = document.getElementById('btn-sync-catalog');
  if (headerBtn) {
    headerBtn.classList.add('syncing');
    const label = headerBtn.querySelector('.sync-label');
    if (label) label.textContent = 'Actualizando...';
  }

  const statusDesc = document.getElementById('catalog-sync-status-desc');
  if (statusDesc) {
    statusDesc.innerHTML = '<span style="color: #38bdf8;">🔄 Conectando con los servidores de catálogo y descargando estrenos...</span>';
  }

  try {
    // 1. Sync portal live channels first
    try {
      const portalChs = await syncPortalLiveChannels();
      if (portalChs && portalChs.length > 0) {
        const adultCodes = new Set(portalChs.filter(c => c.subcat === 'adultos').map(c => c.channelCode));
        CHANNELS.forEach(channel => {
          if (adultCodes.has(channel.channelCode || channel.id)) channel.subcat = 'adultos';
        });
        const existing = new Set(CHANNELS.map(c => c.channelCode || c.id));
        const newItems = portalChs.filter(c => !existing.has(c.channelCode));
        CHANNELS.push(...newItems);
        CHANNELS.sort((a, b) => (Number(a.num) || 9999) - (Number(b.num) || 9999));
        if (state.currentCategory === 'live') {
          renderLiveChannels();
        }
      }
    } catch (e) {
      console.warn('[LiveSync] Live channels sync skipped:', e.message);
    }

    const res = await syncAllCatalogs(dynamicCatalogs, {
      onStatus: (st) => {
        if (statusDesc) {
          statusDesc.innerHTML = `<span style="color: #38bdf8;">🔄 ${st.message}</span>`;
        }
      }
    });

    if (res && res.success) {
      canonicalizeAllCatalogPosters();
      refreshCurrentCategoryGrid();
      updateSyncStatusUI();

      if (manual) {
        showToast(res.added > 0 ? `✨ Sincronizados +${res.added} nuevos títulos` : '✅ Catálogo al día con los últimos estrenos');
      } else {
        showToast(`✨ Catálogo actualizado al abrir (${MOVIES.length} Películas, ${SERIES.length} Series)`);
      }
    }
  } catch (err) {
    console.error('[CatalogSync] Startup sync failed:', err);
    if (statusDesc) {
      statusDesc.innerHTML = '<span style="color: #f87171;">⚠️ Error de conexión temporal. Se mantiene el catálogo en caché.</span>';
    }
  } finally {
    state.isSyncingCatalog = false;
    if (headerBtn) {
      headerBtn.classList.remove('syncing');
      const label = headerBtn.querySelector('.sync-label');
      if (label) label.textContent = 'Actualizar';
    }
  }
}

function refreshCurrentCategoryGrid() {
  try {
    if (state.currentCategory === 'movies') {
      renderMoviesGrid();
    } else if (state.currentCategory === 'series') {
      setupSeriesSection();
    } else if (state.currentCategory === 'anime') {
      setupAnimeSection();
    } else if (state.currentCategory === 'kids') {
      setupKidsSection();
    } else if (state.currentCategory === 'sports') {
      setupSportsSection();
    } else if (state.currentCategory === 'music') {
      setupMusicSection();
    } else if (state.currentCategory === 'docs') {
      setupDocsSection();
    } else if (state.currentCategory === 'novelas') {
      setupNovelasSection();
    } else if (state.currentCategory === 'uhd') {
      setupUhdSection();
    }
  } catch (err) {
    console.warn('Error refreshing active grid:', err);
  }
}

// ================= SETTINGS CONTROLLER ================= //
function setupSettingsSection() {
  const langSelect = document.getElementById('setting-language');
  const aspectSelect = document.getElementById('setting-aspect');
  const qualitySelect = document.getElementById('setting-quality');
  const parentalToggle = document.getElementById('setting-parental-toggle');
  const parentalPinRow = document.getElementById('parental-pin-row');
  const parentalPinInput = document.getElementById('setting-parental-pin');
  const hwToggle = document.getElementById('setting-hw-accel');
  const m3uInput = document.getElementById('m3u-input-url');
  const loadM3uBtn = document.getElementById('btn-load-m3u');

  langSelect.value = state.settings.language || 'es';
  aspectSelect.value = state.settings.aspect_ratio || 'auto';
  qualitySelect.value = state.settings.preferred_quality || '1080p';
  parentalToggle.checked = !!state.settings.parental_control_enabled;
  parentalPinRow.style.display = parentalToggle.checked ? 'flex' : 'none';
  parentalPinInput.value = state.settings.parental_control_pin || '0000';
  hwToggle.checked = !!state.settings.hardware_acceleration;

  const saveAll = async () => {
    state.settings.language = langSelect.value;
    state.settings.aspect_ratio = aspectSelect.value;
    state.settings.preferred_quality = qualitySelect.value;
    state.settings.parental_control_enabled = parentalToggle.checked;
    state.settings.parental_control_pin = parentalPinInput.value || '0000';
    state.settings.hardware_acceleration = hwToggle.checked;
    const autoSyncEl = document.getElementById('setting-auto-sync-catalog');
    if (autoSyncEl) state.settings.auto_sync_catalog = autoSyncEl.checked;

    await invoke('save_settings', { newSettings: state.settings });
    showToast('Preferencias guardadas');
  };

  langSelect.addEventListener('change', saveAll);
  aspectSelect.addEventListener('change', () => {
    saveAll();
    const video = document.getElementById('live-video');
    applyAspectRatio(video, aspectSelect.value);
  });
  qualitySelect.addEventListener('change', saveAll);

  parentalToggle.addEventListener('change', () => {
    parentalPinRow.style.display = parentalToggle.checked ? 'flex' : 'none';
    state.isAdultUnlocked = !parentalToggle.checked;
    saveAll();
  });
  parentalPinInput.addEventListener('change', saveAll);
  hwToggle.addEventListener('change', saveAll);

  // Apple Silicon M4 / Media Engine Hardware Acceleration Chip Badge
  const chipBadge = document.getElementById('hw-chip-badge');
  if (chipBadge) {
    chipBadge.textContent = '⚡ Chip Detectado: Apple Silicon M4 (Media Engine Activo • 60 FPS • Metal 3)';
  }

  // Channel Validator Controller in Settings
  const btnRun = document.getElementById('btn-run-validator');
  const btnToggleFilter = document.getElementById('btn-toggle-filter-offline');
  const btnFilterText = document.getElementById('btn-filter-text');
  const btnFilterIcon = document.getElementById('btn-filter-icon');
  const btnRestore = document.getElementById('btn-restore-all-channels');
  const btnExport = document.getElementById('btn-export-m3u-verified');

  let isFilterActive = localStorage.getItem('swordtv_filter_offline') === 'true';
  refreshChannelMetrics();

  const updateFilterUI = () => {
    if (btnFilterText) {
      btnFilterText.textContent = isFilterActive
        ? 'Ocultando canales sin respuesta'
        : 'Ocultar canales sin respuesta';
    }
    if (btnFilterIcon) {
      btnFilterIcon.textContent = isFilterActive ? '🟢' : '⚡';
    }
    if (btnToggleFilter) {
      if (isFilterActive) {
        btnToggleFilter.classList.remove('secondary');
        btnToggleFilter.classList.add('success');
      } else {
        btnToggleFilter.classList.remove('success');
        btnToggleFilter.classList.add('secondary');
      }
    }
  };
  updateFilterUI();

  btnToggleFilter?.addEventListener('click', () => {
    isFilterActive = !isFilterActive;
    localStorage.setItem('swordtv_filter_offline', isFilterActive ? 'true' : 'false');
    updateFilterUI();
    renderLiveChannels();
    showToast(isFilterActive ? '✅ Filtro activado: Canales sin señal ocultados' : 'Lista restaurada con todos los canales');
  });

  btnRestore?.addEventListener('click', () => {
    isFilterActive = false;
    localStorage.setItem('swordtv_filter_offline', 'false');
    updateFilterUI();
    renderLiveChannels();
    showToast('Lista restaurada: mostrando todos los canales');
  });

  btnRun?.addEventListener('click', reviewChannels);

  btnExport?.addEventListener('click', async () => {
    const quote = value => String(value || '').replace(/["\r\n]/g, ' ');
    const content = ['#EXTM3U', ...CHANNELS.flatMap(channel => [
      `#EXTINF:-1 tvg-name="${quote(channel.name)}" tvg-logo="${quote(channel.logo)}",${quote(channel.name)}`,
      channel.streamUrl
    ])].join('\n');
    if (window.__TAURI__?.core?.invoke) {
      try {
        const path = await invoke('export_channels_m3u', { content });
        showToast(`Lista guardada: ${path || 'Documentos/ListaActual.m3u'}`);
      } catch (err) {
        showToast(`No se pudo guardar la lista: ${err}`);
      }
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([content], { type: 'audio/x-mpegurl' }));
      link.download = 'ListaActual.m3u';
      link.click();
      URL.revokeObjectURL(link.href);
      showToast('Lista M3U descargada.');
    }
  });

  loadM3uBtn.addEventListener('click', async () => {
    const url = m3uInput.value.trim();
    if (!url) {
      showToast('Ingresa una URL válida de lista M3U');
      return;
    }
    showToast('Descargando lista IPTV...');
    try {
      const content = await invoke('fetch_m3u_content', { url });
      if (content) {
        const added = parseAndAddM3U(content, url);
        showToast(added ? `Lista M3U: ${added} canales nuevos añadidos.` : 'La lista no contenía canales nuevos válidos.');
        switchCategory('live');
      }
    } catch (e) {
      showToast(`Error al cargar lista: ${e}`);
    }
  });
}

function parseAndAddM3U(m3uText, baseUrl = '') {
  const imported = JSON.parse(localStorage.getItem(IMPORTED_CHANNELS_KEY) || '[]');
  const knownUrls = new Set(CHANNELS.map(channel => channelUrlKey(channel.streamUrl)).filter(Boolean));
  let addedCount = 0;
  const stableId = value => {
    let hash = 2166136261;
    for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return `m3u-${(hash >>> 0).toString(36)}`;
  };
  for (const entry of parseM3UChannels(m3uText, baseUrl)) {
    const key = channelUrlKey(entry.streamUrl);
    if (!key || knownUrls.has(key)) continue;
    let logo = '';
    try {
      const candidate = new URL(entry.logo, baseUrl || undefined);
      if (['http:', 'https:'].includes(candidate.protocol)) logo = candidate.href;
    } catch (_) {}

    const channel = {
      id: stableId(key),
      num: CHANNELS.length + 1,
      name: entry.name,
      subcat: entry.group ? entry.group.toLocaleLowerCase('es') : 'nacionales',
      country: 'IPTV',
      logo: logo || 'assets/icon.png',
      currentShow: 'Transmisión IPTV en directo',
      nextShow: 'Transmisión continua',
      quality: 'HD',
      streamUrl: entry.streamUrl
    };
    knownUrls.add(key);
    CHANNELS.push(channel);
    imported.push(channel);
    addedCount++;
  }

  if (addedCount) localStorage.setItem(IMPORTED_CHANNELS_KEY, JSON.stringify(imported));
  renderLiveChannels();
  refreshChannelMetrics();
  return addedCount;
}

// ================= GLOBAL SEARCH CONTROLLER ================= //
function setupSearch() {
  const input = document.getElementById('global-search-input');
  let timeout = null;

  input.addEventListener('input', (e) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) {
        if (state.currentCategory === 'live') renderLiveChannels();
        else if (state.currentCategory === 'movies') renderMoviesGrid();
        else if (state.currentCategory === 'series') renderSeriesGrid();
        else if (state.currentCategory === 'anime') renderAnimeGrid();
        else if (state.currentCategory === 'kids') renderKidsGrid();
        else if (state.currentCategory === 'music') renderMusicGrid();
        else if (state.currentCategory === 'docs') renderDocsGrid();
        return;
      }
      performSearch(q);
    }, 200);
  });
}

function performSearch(query) {
  logAppAction('GLOBAL_SEARCH', { query }, 'SEARCH');
  if (state.currentCategory === 'live') {
    const listEl = document.getElementById('live-channels-container');
    listEl.innerHTML = '';
    const results = CHANNELS.filter(c => c.name.toLowerCase().includes(query) || (c.currentShow && c.currentShow.toLowerCase().includes(query)));
    if (results.length === 0) {
      listEl.innerHTML = `<div style="color: var(--text-muted); padding: 30px 10px; text-align: center;">Sin resultados para "${query}"</div>`;
      return;
    }
    results.forEach(ch => {
      const card = document.createElement('div');
      card.className = `channel-card ${state.currentChannel?.id === ch.id ? 'active' : ''}`;
      card.innerHTML = `
        <div class="channel-num-badge">${ch.num}</div>
        <div class="channel-info">
          <div class="channel-title-row">
            <span class="channel-title">${ch.name}</span>
            <span class="channel-quality-badge">${ch.quality || 'HD'}</span>
          </div>
          <div class="channel-show-now">▶ ${ch.currentShow}</div>
        </div>
      `;
      card.onclick = () => playLiveChannel(ch);
      listEl.appendChild(card);
    });
  } else if (state.currentCategory === 'movies') {
    const grid = document.getElementById('movies-grid');
    grid.innerHTML = '';
    const results = MOVIES.filter(m => m.title.toLowerCase().includes(query) || (m.genre && m.genre.toLowerCase().includes(query)));
    results.forEach(mov => {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <div class="media-poster-box">
          <img src="${mov.poster}" alt="${mov.title}" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${mov.title}</div>
          <div class="media-card-meta"><span>${mov.year}</span></div>
        </div>
      `;
      card.onclick = () => openVodDetailModal(mov, 'movie');
      grid.appendChild(card);
    });
  } else if (state.currentCategory === 'anime') {
    const grid = document.getElementById('anime-grid');
    grid.innerHTML = '';
    const results = ANIME.filter(a => a.title.toLowerCase().includes(query) || (a.genre && a.genre.toLowerCase().includes(query)));
    results.forEach(an => {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <div class="media-poster-box">
          <img src="${an.poster}" alt="${an.title}" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${an.title}</div>
          <div class="media-card-meta"><span>${an.year}</span></div>
        </div>
      `;
      card.onclick = () => openVodDetailModal(an, 'anime');
      grid.appendChild(card);
    });
  } else if (state.currentCategory === 'series') {
    const grid = document.getElementById('series-grid');
    grid.innerHTML = '';
    const results = SERIES.filter(s => s.title.toLowerCase().includes(query) || (s.genre && s.genre.toLowerCase().includes(query)));
    results.forEach(ser => {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <div class="media-poster-box">
          <img src="${ser.poster}" alt="${ser.title}" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${ser.title}</div>
          <div class="media-card-meta"><span>${ser.year}</span></div>
        </div>
      `;
      card.onclick = () => openVodDetailModal(ser, 'series');
      grid.appendChild(card);
    });
  } else if (state.currentCategory === 'kids') {
    const grid = document.getElementById('kids-grid');
    grid.innerHTML = '';
    const results = KIDS.filter(k => k.title.toLowerCase().includes(query) || (k.genre && k.genre.toLowerCase().includes(query)));
    results.forEach(kid => {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <div class="media-poster-box">
          <img src="${kid.poster}" alt="${kid.title}" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${kid.title}</div>
          <div class="media-card-meta"><span>${kid.year}</span></div>
        </div>
      `;
      card.onclick = () => openVodDetailModal(kid, 'kids');
      grid.appendChild(card);
    });
  } else if (state.currentCategory === 'novelas') {
    const grid = document.getElementById('novelas-grid');
    grid.innerHTML = '';
    const results = NOVELAS.filter(n => n.title.toLowerCase().includes(query) || (n.genre && n.genre.toLowerCase().includes(query)));
    results.forEach(nov => {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <div class="media-poster-box">
          <img src="${nov.poster}" alt="${nov.title}" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${nov.title}</div>
          <div class="media-card-meta"><span>${nov.year}</span></div>
        </div>
      `;
      card.onclick = () => openVodDetailModal(nov, 'series');
      grid.appendChild(card);
    });
  } else if (state.currentCategory === 'uhd') {
    const grid = document.getElementById('uhd-grid');
    grid.innerHTML = '';
    const results = UHD_ITEMS.filter(u => u.title.toLowerCase().includes(query) || (u.genre && u.genre.toLowerCase().includes(query)));
    results.forEach(uhd => {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <div class="media-poster-box">
          <img src="${uhd.poster}" alt="${uhd.title}" onerror="this.onerror=null; this.src='assets/poster_placeholder.svg';">
        </div>
        <div class="media-info-box">
          <div class="media-card-title">${uhd.title}</div>
          <div class="media-card-meta"><span>${uhd.year}</span></div>
        </div>
      `;
      card.onclick = () => openVodDetailModal(uhd, uhd.seasons ? 'series' : 'movie');
      grid.appendChild(card);
    });
  }
}

// ================= KEYBOARD SHORTCUTS ================= //
function setupGlobalShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    const vodOverlay = document.getElementById('vod-player-overlay');
    const vodOpen = vodOverlay && (vodOverlay.classList.contains('open') || vodOverlay.classList.contains('active'));
    const detailModal = document.getElementById('vod-detail-modal');
    const modalOpen = detailModal && (detailModal.classList.contains('open') || detailModal.classList.contains('active'));

    const resumeModal = document.getElementById('vod-resume-modal');
    const resumeOpen = resumeModal && (resumeModal.classList.contains('open') || resumeModal.classList.contains('active'));

    if (e.key === 'Escape') {
      if (resumeOpen) closeResumeModal();
      else if (vodOpen) closeVodPlayer();
      else if (modalOpen) {
        detailModal.classList.remove('open');
        detailModal.classList.remove('active');
      }
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      const activeVid = vodOpen ? document.getElementById('vod-video') : document.getElementById('live-video');
      if (activeVid.paused) activeVid.play();
      else activeVid.pause();
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
      return;
    }

    if (e.key === 'm' || e.key === 'M') {
      const activeVid = vodOpen ? document.getElementById('vod-video') : document.getElementById('live-video');
      activeVid.muted = !activeVid.muted;
      showToast(activeVid.muted ? '🔇 Silenciado' : '🔊 Sonido Activado');
      return;
    }

    if (state.currentCategory === 'live' && !vodOpen && !modalOpen) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const curIdx = CHANNELS.findIndex(c => c.id === state.currentChannel?.id);
        if (curIdx >= 0) {
          const nextIdx = e.key === 'ArrowDown'
            ? (curIdx + 1) % CHANNELS.length
            : (curIdx - 1 + CHANNELS.length) % CHANNELS.length;
          playLiveChannel(CHANNELS[nextIdx]);
        }
      }
    }
  });

  const handleFullscreenOrResize = () => {
    showLiveOsdTemporarily();
    showVodOsdTemporarily();
  };
  document.addEventListener('fullscreenchange', handleFullscreenOrResize);
  document.addEventListener('webkitfullscreenchange', handleFullscreenOrResize);
  window.addEventListener('resize', handleFullscreenOrResize);
}

// ================= MACOS WINDOW DRAGGING CONTROLLER ================= //
function setupWindowDrag() {
  const topbar = document.querySelector('.app-topbar');
  if (!topbar) return;

  topbar.addEventListener('mousedown', async (e) => {
    // Ignore clicks on inputs, buttons, and interactive controls
    if (e.target.closest('button, input, select, a, .search-box input, .win-btn, .catalog-sync-btn, .notification-bell-btn')) {
      return;
    }
    // Don't drag if fullscreen
    if (document.fullscreenElement || document.webkitFullscreenElement || state.windowFullscreen) {
      return;
    }
    if (e.detail === 2) {
      toggleFullscreen();
      return;
    }
    if (e.button === 0) {
      try {
        if (window.__TAURI__?.window?.getCurrentWindow) {
          window.__TAURI__.window.getCurrentWindow().startDragging();
        } else {
          await invoke('drag_window');
        }
      } catch (err) {
        await invoke('drag_window');
      }
    }
  });
}

// ================= SUBTITLE & AUDIO TRACK CONTROLLER ================= //
function setupTrackControls() {
  // Live Subtitles & Audio
  const liveSubsBtn = document.getElementById('live-subs-btn');
  const liveSubsMenu = document.getElementById('live-subs-menu');
  const liveAudioBtn = document.getElementById('live-audio-btn');
  const liveAudioMenu = document.getElementById('live-audio-menu');
  const liveVideo = document.getElementById('live-video');

  // VOD Subtitles & Audio
  const vodSubsBtn = document.getElementById('vod-subs-btn');
  const vodSubsMenu = document.getElementById('vod-subs-menu');
  const vodAudioBtn = document.getElementById('vod-audio-btn');
  const vodAudioMenu = document.getElementById('vod-audio-menu');
  const vodVideo = document.getElementById('vod-video');

  const closeAllMenus = () => {
    liveSubsMenu?.classList.remove('active');
    liveAudioMenu?.classList.remove('active');
    vodSubsMenu?.classList.remove('active');
    vodAudioMenu?.classList.remove('active');
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#live-subs-btn, #live-subs-menu, #live-audio-btn, #live-audio-menu, #vod-subs-btn, #vod-subs-menu, #vod-audio-btn, #vod-audio-menu')) {
      closeAllMenus();
    }
  });

  liveSubsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = liveSubsMenu?.classList.contains('active');
    closeAllMenus();
    if (!isActive) liveSubsMenu?.classList.add('active');
  });

  liveAudioBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = liveAudioMenu?.classList.contains('active');
    closeAllMenus();
    if (!isActive) liveAudioMenu?.classList.add('active');
  });

  vodSubsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = vodSubsMenu?.classList.contains('active');
    closeAllMenus();
    if (!isActive) vodSubsMenu?.classList.add('active');
  });

  vodAudioBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = vodAudioMenu?.classList.contains('active');
    closeAllMenus();
    if (!isActive) vodAudioMenu?.classList.add('active');
  });

  let livePreferredAudioApplied = false;
  const renderLiveTrackMenus = () => {
    if (!liveVideo) return;
    const hls = state.hlsLive;
    const hlsAudioTracks = Array.isArray(hls?.audioTracks) ? hls.audioTracks : [];
    const nativeAudioTracks = liveVideo.audioTracks ? Array.from(liveVideo.audioTracks) : [];
    const useHlsAudio = hlsAudioTracks.length > 0;
    const audioTracks = useHlsAudio ? hlsAudioTracks : nativeAudioTracks;

    if (liveAudioMenu) {
      liveAudioMenu.innerHTML = '<div class="track-menu-header">Pistas de Audio</div>';
      if (!audioTracks.length) {
        liveAudioMenu.insertAdjacentHTML('beforeend', '<div class="track-menu-empty">Esta señal no publica pistas de audio alternativas.</div>');
      } else {
        if (!livePreferredAudioApplied) {
          const preferredIdx = audioTracks.findIndex(track => /\b(?:es|spa|spanish|español|latino)\b/i.test(
            `${track.language || track.lang || ''} ${track.label || track.name || ''}`
          ));
          if (preferredIdx >= 0) {
            if (useHlsAudio) hls.audioTrack = preferredIdx;
            else if (nativeAudioTracks[preferredIdx]) {
              for (let i = 0; i < nativeAudioTracks.length; i++) nativeAudioTracks[i].enabled = i === preferredIdx;
            }
          }
          livePreferredAudioApplied = true;
        }
        audioTracks.forEach((track, idx) => {
          const selected = useHlsAudio ? hls.audioTrack === idx : !!track.enabled;
          const label = track.label || track.name || track.language || track.lang || `Pista ${idx + 1}`;
          const option = document.createElement('div');
          option.className = `track-menu-item ${selected ? 'selected' : ''}`;
          option.textContent = label;
          if (selected) option.insertAdjacentHTML('beforeend', '<span class="check-icon">✓</span>');
          option.addEventListener('click', event => {
            event.stopPropagation();
            if (useHlsAudio && state.hlsLive === hls) hls.audioTrack = idx;
            else if (liveVideo.audioTracks) {
              for (let i = 0; i < liveVideo.audioTracks.length; i++) liveVideo.audioTracks[i].enabled = i === idx;
            }
            livePreferredAudioApplied = true;
            showToast(`🌐 Audio: ${label}`);
            renderLiveTrackMenus();
            setTimeout(closeAllMenus, 250);
          });
          liveAudioMenu.appendChild(option);
        });
      }
    }

    const hlsSubtitleTracks = Array.isArray(hls?.subtitleTracks) ? hls.subtitleTracks : [];
    const nativeSubtitleTracks = liveVideo.textTracks
      ? Array.from(liveVideo.textTracks).filter(track => track.kind === 'subtitles' || track.kind === 'captions')
      : [];
    const useHlsSubtitles = hlsSubtitleTracks.length > 0;
    const subtitleTracks = useHlsSubtitles ? hlsSubtitleTracks : nativeSubtitleTracks;
    if (liveSubsMenu) {
      liveSubsMenu.innerHTML = '<div class="track-menu-header">Subtítulos (CC)</div>';
      const subtitlesEnabled = useHlsSubtitles
        ? hls.subtitleTrack >= 0 && hls.subtitleDisplay !== false
        : nativeSubtitleTracks.some(track => track.mode === 'showing');
      const off = document.createElement('div');
      off.className = `track-menu-item ${subtitlesEnabled ? '' : 'selected'}`;
      off.textContent = 'Desactivados (Off)';
      if (!subtitlesEnabled) off.insertAdjacentHTML('beforeend', '<span class="check-icon">✓</span>');
      off.addEventListener('click', event => {
        event.stopPropagation();
        if (useHlsSubtitles && state.hlsLive === hls) {
          hls.subtitleTrack = -1;
          hls.subtitleDisplay = false;
        } else {
          nativeSubtitleTracks.forEach(track => { track.mode = 'disabled'; });
        }
        showToast('Subtítulos desactivados');
        renderLiveTrackMenus();
        setTimeout(closeAllMenus, 250);
      });
      liveSubsMenu.appendChild(off);

      if (!subtitleTracks.length) {
        liveSubsMenu.insertAdjacentHTML('beforeend', '<div class="track-menu-empty">Esta señal no publica subtítulos.</div>');
      } else {
        subtitleTracks.forEach((track, idx) => {
          const selected = useHlsSubtitles ? hls.subtitleTrack === idx : track.mode === 'showing';
          const label = track.label || track.name || track.language || track.lang || `Subtítulo ${idx + 1}`;
          const option = document.createElement('div');
          option.className = `track-menu-item ${selected ? 'selected' : ''}`;
          option.textContent = label;
          if (selected) option.insertAdjacentHTML('beforeend', '<span class="check-icon">✓</span>');
          option.addEventListener('click', event => {
            event.stopPropagation();
            if (useHlsSubtitles && state.hlsLive === hls) {
              hls.subtitleDisplay = true;
              hls.subtitleTrack = idx;
            } else {
              nativeSubtitleTracks.forEach((nativeTrack, i) => { nativeTrack.mode = i === idx ? 'showing' : 'disabled'; });
            }
            showToast(`Subtítulos: ${label}`);
            renderLiveTrackMenus();
            setTimeout(closeAllMenus, 250);
          });
          liveSubsMenu.appendChild(option);
        });
      }
    }
  };

  window.__refreshLiveTrackMenus = renderLiveTrackMenus;
  window.__resetLiveTrackMenus = () => {
    livePreferredAudioApplied = false;
    renderLiveTrackMenus();
  };
  liveVideo?.addEventListener('loadedmetadata', renderLiveTrackMenus);
  liveVideo?.addEventListener('loadeddata', renderLiveTrackMenus);
  liveVideo?.audioTracks?.addEventListener?.('addtrack', renderLiveTrackMenus);
  liveVideo?.textTracks?.addEventListener?.('addtrack', renderLiveTrackMenus);
  renderLiveTrackMenus();


}

// ================= DYNAMIC VOD AUDIO & SUBTITLES SELECTOR ================= //
function configureVodTrackMenus() {
  const audioMenu = document.getElementById('vod-audio-menu');
  const video = document.getElementById('vod-video');
  if (!audioMenu || !video) return;

  // If already populated with items by setupVodAudioTracks, don't overwrite
  if (audioMenu.querySelectorAll('.track-menu-item').length > 0) return;

  audioMenu.innerHTML = '<div class="track-menu-header">Pistas de audio</div>';
  const tracks = video.audioTracks;
  if (!tracks || tracks.length === 0) {
    audioMenu.insertAdjacentHTML('beforeend', '<div class="track-menu-item selected">Audio Principal <span class="check-icon">✓</span></div>');
  } else {
    const hasEnabledTrack = Array.from(tracks).some(track => track.enabled);
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const item = document.createElement('div');
      item.className = `track-menu-item ${track.enabled || (i === 0 && !hasEnabledTrack) ? 'selected' : ''}`;
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.textContent = track.label || track.language || `Pista ${i + 1}`;
      if (item.classList.contains('selected')) item.insertAdjacentHTML('beforeend', '<span class="check-icon">✓</span>');
      const select = () => {
        for (let j = 0; j < tracks.length; j++) tracks[j].enabled = i === j;
        audioMenu.querySelectorAll('.track-menu-item').forEach((node, index) => {
          node.classList.toggle('selected', index === i);
          node.querySelector('.check-icon')?.remove();
          if (index === i) node.insertAdjacentHTML('beforeend', '<span class="check-icon">✓</span>');
        });
        showToast(`Audio: ${item.textContent.replace('✓', '').trim()}`);
      };
      item.addEventListener('click', select);
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
      });
      audioMenu.appendChild(item);
    }
  }
}
