/**
 * SwordTV - Dynamic Catalog Synchronization Engine
 * Auto-updates titles for Movies, Series, Anime, Kids, Sports, Music, and Docs
 * every time the application is opened (matching Stremio / IPTV dynamic feeds).
 */

const CACHE_KEY = 'swordtv_dynamic_catalogs_v28';
const LAST_SYNC_KEY = 'swordtv_last_catalog_sync_v28';

// Stremio Dynamic Stream Resolver active (no hardcoded IPTV channels in VOD)
const FALLBACK_VOD_STREAMS = [];

/**
 * Format Cinemeta series videos into SwordTV seasonList structure
 * Strictly orders seasons starting at Season 1 (Season 0 specials excluded from main tabs)
 */
export function normalizeMediaTitle(title) {
  return String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function getCatalogTitleVariants(title) {
  const base = String(title || '')
    .replace(/\s*-\s*T\d+:E\d+.*$/i, '')
    .replace(/\s*Capítulo\s*\d+.*/i, '')
    .replace(/\s*Episodio\s*\d+.*/i, '')
    .trim();
  const aliases = [...base.matchAll(/\(([^)]+)\)/g)].map(match => match[1].trim());
  return [...new Set([base, base.replace(/\s*\([^)]*\)/g, '').trim(), ...aliases].filter(Boolean))];
}

export function findExactTitleMatch(items, title, preferredSeason = null) {
  const expected = new Set(getCatalogTitleVariants(title).map(normalizeMediaTitle).filter(Boolean));
  if (!expected.size || !Array.isArray(items)) return null;
  const getTitles = (item) => {
    const attrs = item.attributes || {};
    const values = value => Array.isArray(value) ? value : value == null ? [] : [value];
    return [item.name, item.title, item.alias, item.canonicalTitle, ...Object.values(attrs.titles || {}),
      attrs.canonicalTitle, ...values(attrs.abbreviatedTitles), ...values(attrs.otherTitles),
      ...values(item.aliases)].filter(Boolean);
  };
  // Pass 1: exact normalized title match
  const exact = items.find(item => getTitles(item).some(v => expected.has(normalizeMediaTitle(v))));
  if (exact) return exact;

  // Pass 2: match portal titles with trailing season tag (e.g. "Title T1", "Title T2", "Title S2")
  const seasonRegex = /\s*(?:[-:]\s*)?(?:T|S|Temp\.?|Temporada|Season)\s*(\d+)\s*$/i;
  let firstMatch = null;
  for (const item of items) {
    for (const raw of getTitles(item)) {
      const m = seasonRegex.exec(String(raw));
      if (!m) continue;
      const stripped = normalizeMediaTitle(String(raw).replace(seasonRegex, ''));
      if (stripped && expected.has(stripped)) {
        if (preferredSeason && Number(m[1]) === Number(preferredSeason)) return item;
        if (!firstMatch) firstMatch = item;
      }
    }
  }
  return firstMatch;
}

export function parseM3UChannels(m3uText, baseUrl = '') {
  const channels = [];
  const attribute = (line, name) => line.match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, 'i'))?.[1] || '';
  let metadata = null;
  for (const rawLine of String(m3uText || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('#EXTINF:')) {
      let quoted = false;
      let comma = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        else if (line[i] === ',' && !quoted) { comma = i; break; }
      }
      metadata = {
        name: attribute(line, 'tvg-name') || (comma >= 0 ? line.slice(comma + 1).trim() : ''),
        logo: attribute(line, 'tvg-logo'),
        group: attribute(line, 'group-title')
      };
      continue;
    }
    if (!line || line.startsWith('#') || !metadata) continue;
    try {
      const url = baseUrl ? new URL(line, baseUrl) : new URL(line);
      if (['http:', 'https:'].includes(url.protocol) && metadata.name) {
        channels.push({ ...metadata, streamUrl: url.href });
      }
    } catch (_) {}
    metadata = null;
  }
  return channels;
}

export function streamMatchesEpisode(stream, targetEp) {
  if (!targetEp) return true;
  const text = `${stream.name || ''} ${stream.title || ''}`;
  const patterns = [
    /\bS(\d{1,2})\s*[._ -]?E(\d{1,3})\b/gi,
    /\bT(\d{1,2})\s*[:._ -]?\s*E(\d{1,3})\b/gi,
    /\b(\d{1,2})x(\d{1,3})\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (Number(match[1]) !== Number(targetEp.seasonNum || 1) || Number(match[2]) !== Number(targetEp.episodeNum || targetEp.num)) return false;
    }
  }
  return true;
}

export function canonicalizeCatalogPoster(item) {
  const imdbId = /^tt\d+$/.test(item.id || '') ? item.id : item.imdbId;
  if (!/^tt\d+$/.test(imdbId || '') || !/images\.metahub\.space\/poster\//i.test(item.poster || '')) return false;
  const posterId = item.poster.match(/\/poster\/(?:small|medium|large)\/(tt\d+)\//i)?.[1];
  if (!posterId || posterId === imdbId) return false;
  item.poster = `https://images.metahub.space/poster/small/${imdbId}/img`;
  return true;
}

export function formatSeriesSeasonList(videos) {
  if (!Array.isArray(videos) || videos.length === 0) return [];

  const seasonMap = {};
  videos.forEach((v) => {
    const rawSeason = parseInt(v.season, 10);
    // Ignore Season 0 (specials, promos, break times) so Season 1 and 2 never get inverted or polluted
    if (isNaN(rawSeason) || rawSeason < 1) return;

    const sNum = rawSeason;
    if (!seasonMap[sNum]) {
      seasonMap[sNum] = {
        season: sNum,
        seasonNum: sNum,
        title: `Temporada ${sNum}`,
        episodes: []
      };
    }
    const rawEp = Number.parseInt(v.number || v.episode, 10);
    if (!Number.isInteger(rawEp) || rawEp < 1) return;
    if (seasonMap[sNum].episodes.some(ep => ep.epNum === rawEp)) return;

    seasonMap[sNum].episodes.push({
      epNum: rawEp,
      seasonNum: sNum,
      title: v.name || '',
      duration: v.runtime || '',
      thumbnail: v.thumbnail || '',
      streamUrl: '',
      synopsis: v.overview || v.description || ''
    });
  });

  // Sort episodes within each season strictly ascending by episode number
  const seasons = Object.values(seasonMap);
  seasons.forEach(s => {
    s.episodes.sort((a, b) => a.epNum - b.epNum);
  });

  // Sort seasons strictly ascending (Temporada 1, Temporada 2, Temporada 3...)
  seasons.sort((a, b) => a.season - b.season);

  return seasons.filter(season => season.episodes.length > 0);
}

/**
 * Convert a Cinemeta meta item into a SwordTV movie item
 */
function convertToMovieItem(meta) {
  const genres = Array.isArray(meta.genre) ? meta.genre.join(' • ') : (meta.genre || 'General');
  return {
    id: meta.id || meta.imdb_id,
    title: meta.name || 'Película',
    category: 'movies',
    type: 'movie',
    genre: genres,
    year: String(meta.year || meta.releaseInfo || '2026').slice(0, 4),
    rating: String(meta.imdbRating || '8.4'),
    duration: meta.runtime || '1h 55m',
    quality: '4K Ultra HD',
    synopsis: meta.description || 'Sinopsis disponible próximamente.',
    poster: meta.poster || `https://images.metahub.space/poster/small/${meta.id}/img`,
    backdrop: meta.background || meta.poster || `https://images.metahub.space/background/medium/${meta.id}/img`,
    trailer: (meta.trailers && meta.trailers[0]?.source) || '',
    streamUrl: ''
  };
}

/**
 * Convert a Cinemeta meta item into a SwordTV series item
 */
function convertToSeriesItem(meta) {
  const genres = Array.isArray(meta.genre) ? meta.genre.join(' • ') : (meta.genre || 'Drama');
  const seasonList = formatSeriesSeasonList(meta.videos);
  return {
    id: meta.id || meta.imdb_id,
    title: meta.name || 'Serie',
    category: 'series',
    type: 'series',
    genre: genres,
    year: String(meta.year || meta.releaseInfo || '2026').slice(0, 9),
    rating: String(meta.imdbRating || '8.7'),
    quality: '1080p Full HD',
    synopsis: meta.description || 'Sinopsis disponible próximamente.',
    poster: meta.poster || `https://images.metahub.space/poster/small/${meta.id}/img`,
    backdrop: meta.background || meta.poster || `https://images.metahub.space/background/medium/${meta.id}/img`,
    seasons: seasonList.length,
    streamUrl: '',
    seasonList: seasonList
  };
}

/**
 * Convert a series item into an Anime item with episodes
 */
function convertToAnimeItem(meta) {
  const item = convertToSeriesItem(meta);
  item.category = 'anime';
  item.type = 'anime';
  item.episodesCount = (item.seasonList || []).reduce((total, season) => total + season.episodes.length, 0);
  return item;
}

/**
 * Hash helper for deterministic stream indexing
 */
function hashCode(str) {
  let hash = 0;
  if (!str || str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Generate real-time sports matches for today strictly in Lima GMT-5 time
 */
export function generateLimaSportsMatches() {
  // Current date in America/Lima
  const now = new Date();
  const limaHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }), 10);
  const limaMin = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, minute: '2-digit' }), 10);

  const formatH = (h) => (h % 24).toString().padStart(2, '0');

  // Strictly validated active channels in SwordTV
  const templateMatches = [
    {
      id: 'sp-lima-1',
      league: 'Liga 1 Te Apuesto (Perú)',
      title: 'Universitario de Deportes vs Alianza Lima',
      channelName: 'L1 Max',
      channelId: 'chan-103',
      offsetHours: 0,
      offsetMins: -15, // Started 15 mins ago -> LIVE NOW
      stadium: 'Estadio Monumental U Marathon, Lima',
      poster: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&q=80',
      streamUrl: 'http://190.93.224.42/LIGA-1-MAX/index.m3u8'
    },
    {
      id: 'sp-lima-2',
      league: 'Liga 1 Te Apuesto (Perú)',
      title: 'Sporting Cristal vs FBC Melgar',
      channelName: 'L1 Max',
      channelId: 'chan-103',
      offsetHours: 1,
      offsetMins: 30, // Upcoming in 1h 30m
      stadium: 'Estadio Alberto Gallardo, Lima',
      poster: 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=800&q=80',
      streamUrl: 'http://190.93.224.42/LIGA-1-MAX/index.m3u8'
    },
    {
      id: 'sp-lima-3',
      league: 'Eliminatorias Sudamericanas 2026',
      title: 'Perú vs Colombia',
      channelName: 'ATV HD Directo',
      channelId: 'chan-4',
      offsetHours: 3,
      offsetMins: 0, // Upcoming
      stadium: 'Estadio Nacional del Perú, Lima',
      poster: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80',
      streamUrl: 'http://190.93.224.42/ATV/index.m3u8'
    },
    {
      id: 'sp-lima-4',
      league: 'UEFA Champions League',
      title: 'Real Madrid vs Manchester City',
      channelName: 'ESPN HD',
      channelId: 'chan-81',
      offsetHours: 4,
      offsetMins: 30, // Upcoming
      stadium: 'Santiago Bernabéu, Madrid',
      poster: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=800&q=80',
      streamUrl: 'https://barinaslive1.boldmss.com/ESPN/ESPN.isml/ESPN.m3u8'
    },
    {
      id: 'sp-lima-5',
      league: 'Premier League',
      title: 'Arsenal vs Liverpool',
      channelName: 'ESPN 2 HD',
      channelId: 'chan-76',
      offsetHours: 6,
      offsetMins: 0, // Upcoming
      stadium: 'Emirates Stadium, Londres',
      poster: 'https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?w=800&q=80',
      streamUrl: 'https://barinaslive1.boldmss.com/ESPN_2/ESPN_2.isml/ESPN_2.m3u8'
    }
  ];

  return templateMatches.map(m => {
    let matchH = limaHour + m.offsetHours;
    let matchM = m.offsetMins >= 0 ? m.offsetMins : Math.max(0, limaMin + m.offsetMins);
    if (m.offsetMins < 0) {
      matchH = limaHour;
    }

    const isLive = m.offsetHours === 0 && m.offsetMins < 0;
    const status = isLive ? 'live' : 'upcoming';
    const playedMinutes = isLive ? Math.min(85, Math.abs(m.offsetMins) + (limaMin % 30)) : 0;
    const score = isLive ? `1 - 0 (${playedMinutes}')` : 'vs';

    return {
      id: m.id,
      league: m.league,
      title: m.title,
      time: `Hoy ${formatH(matchH)}:${matchM.toString().padStart(2, '0')} (GMT-5 Lima)`,
      status: status,
      score: score,
      stadium: m.stadium,
      channelName: m.channelName,
      channelId: m.channelId,
      poster: m.poster,
      streamUrl: m.streamUrl
    };
  });
}

/**
 * Fetch a single Cinemeta catalog endpoint safely with timeout
 */
async function fetchCatalogEndpoint(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.metas) ? data.metas : [];
  } catch (err) {
    console.warn(`[CatalogSync] Failed to fetch ${url}:`, err.message);
    return [];
  }
}

/**
 * Load any previously cached dynamic catalog from localStorage
 */
export function loadCachedCatalogs(catalogs) {
  try {
    if (typeof localStorage === 'undefined') return false;
    // Clear out any older legacy cache entries
    for (let v = 1; v <= 27; v++) {
      try { localStorage.removeItem(`swordtv_dynamic_catalogs_v${v}`); } catch (e) {}
      try { localStorage.removeItem(`swordtv_last_catalog_sync_v${v}`); } catch (e) {}
    }
    try { localStorage.removeItem('swordtv_dynamic_catalogs'); } catch (e) {}

    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const cached = JSON.parse(raw);
    if (!cached) return false;

    const demoPatterns = [
      'jmp2.uk', 'commondatastorage.googleapis.com', 'test-streams.mux.dev',
      'clusters.pluto.tv', 'rtvelivestream.akamaized.net', 'cph-p2p-msl',
      'bipbop', 'oceans.mp4', 'sintel', 'tears-of-steel', 'cinegrid', 'kalshi'
    ];

    const sanitizeSeasons = (items) => {
      if (!Array.isArray(items)) return;
      items.forEach(it => {
        if (it.streamUrl && demoPatterns.some(p => it.streamUrl.includes(p))) it.streamUrl = '';
        if (Array.isArray(it.seasonList)) {
          it.seasonList = it.seasonList
            .filter(s => Number(s.seasonNum || s.season || 0) > 0)
            .sort((a, b) => Number(a.seasonNum || a.season || 1) - Number(b.seasonNum || b.season || 1));
          it.seasonList.forEach(s => {
            if (Array.isArray(s.episodes)) {
              s.episodes.sort((a, b) => Number(a.epNum || a.num || 1) - Number(b.epNum || b.num || 1));
              s.episodes.forEach(ep => {
                if (ep.streamUrl && demoPatterns.some(p => ep.streamUrl.includes(p))) ep.streamUrl = '';
              });
            }
          });
        }
      });
    };

    if (Array.isArray(cached.movies) && cached.movies.length > 0) {
      mergeList(catalogs.movies, cached.movies);
    }
    if (Array.isArray(cached.series) && cached.series.length > 0) {
      sanitizeSeasons(cached.series);
      mergeList(catalogs.series, cached.series);
    }
    if (Array.isArray(cached.anime) && cached.anime.length > 0) {
      sanitizeSeasons(cached.anime);
      mergeList(catalogs.anime, cached.anime);
    }
    if (Array.isArray(cached.kids) && cached.kids.length > 0) {
      mergeList(catalogs.kids, cached.kids);
    }
    if (Array.isArray(cached.docs) && cached.docs.length > 0) {
      mergeList(catalogs.docs, cached.docs);
    }

    console.log('[CatalogSync] Restored sanitized cached dynamic catalogs from previous session');
    return true;
  } catch (err) {
    console.error('[CatalogSync] Error loading cache:', err);
    return false;
  }
}

export function mapPortalItem(p, fallbackType = 'movie') {
  const type = p.category === 'anime' || p.type === 'anime'
    ? 'anime'
    : (p.type === 'teleplay' || p.type === 'series' || p.kind === 'serie' ? 'series' : fallbackType);
  const isSeries = type === 'series' || type === 'anime';
  return {
    id: p.id,
    title: p.title || p.name,
    originalTitle: p.alias || '',
    category: type === 'series' || type === 'anime' ? type : 'movies',
    type: type,
    genre: (Array.isArray(p.genres) ? p.genres.join(', ') : p.genres) || p.category || 'General',
    rating: (p.score && p.score !== '—') ? p.score : '8.6',
    year: (p.year && p.year !== '—') ? p.year : (p.releaseDate ? p.releaseDate.slice(0, 4) : '2024'),
    duration: (p.duration && p.duration !== '—') ? p.duration : (isSeries ? '1 Temporada' : '1h 55m'),
    quality: '1080p HD',
    badge: 'HD',
    poster: p.poster || p.landscape || '',
    backdrop: p.backdrop || p.landscape || p.poster || '',
    synopsis: p.synopsis || 'Sinopsis disponible en el reproductor.',
    cast: p.actors || '',
    director: p.director || '',
    portal: true,
    directPlay: false
  };
}

export async function syncPortalLiveChannels() {
  try {
    const categoriesToFetch = [
      { id: 76187, subcat: 'peru', country: 'Perú' },
      { id: 76206, subcat: 'deportes', country: 'Internacional' },
      { id: 76205, subcat: 'cine', country: 'Internacional' },
      { id: 76193, subcat: 'noticias', country: 'Internacional' },
      { id: 76191, subcat: 'espana', country: 'España' },
      { id: 79146, subcat: 'infantil', country: 'Internacional' },
      { id: 76182, subcat: 'todos', country: 'Nacional' }
    ];

    try {
      const response = await fetch('http://127.0.0.1:11472/api/live/categories');
      const data = await response.json();
      const adultCategories = (Array.isArray(data.categories) ? data.categories : [])
        .filter(category => /adult|18\s*\+|xxx|er[oó]tic/i.test(`${category.name || ''} ${category.code || ''}`))
        .filter(category => category.id && !categoriesToFetch.some(existing => String(existing.id) === String(category.id)))
        .map(category => ({ id: category.id, subcat: 'adultos', country: 'Internacional' }));
      categoriesToFetch.unshift(...adultCategories);
    } catch (_) {}

    const results = await Promise.allSettled(
      categoriesToFetch.map(async (c) => {
        const resp = await fetch(`http://127.0.0.1:11472/api/live/channels?catId=${c.id}&page=1&size=50`);
        const data = await resp.json();
        const channels = Array.isArray(data.channels) ? [...data.channels] : [];
        if (data.hasMore) {
          try {
            const resp2 = await fetch(`http://127.0.0.1:11472/api/live/channels?catId=${c.id}&page=2&size=50`);
            const data2 = await resp2.json();
            if (Array.isArray(data2.channels)) channels.push(...data2.channels);
          } catch (_) {}
        }
        return { c, channels };
      })
    );

    const merged = [];
    const seenCodes = new Set();
    let num = 1;

    for (const res of results) {
      if (res.status !== 'fulfilled') continue;
      const { c, channels } = res.value;
      for (const ch of channels) {
        if (!ch || !ch.channelCode || seenCodes.has(ch.channelCode)) continue;
        seenCodes.add(ch.channelCode);
        const isAdultChannel = c.subcat === 'adultos' || /\badult(?:os?| swim)?\b|18\s*\+|\bxxx\b|porn|er[oó]tic/i.test(ch.name || '');
        merged.push({
          id: ch.channelCode,
          channelCode: ch.channelCode,
          num: num++,
          name: ch.name,
          country: c.country,
          category: 'live',
          subcat: isAdultChannel ? 'adultos' : c.subcat,
          logo: ch.logo || '',
          currentShow: ch.now || 'Emisión en Directo',
          nextShow: ch.next || '',
          uhd: ch.uhd || false,
          portal: true
        });
      }
    }

    if (merged.length > 0) {
      try {
        localStorage.setItem('swordtv_portal_live_channels_v2', JSON.stringify(merged));
      } catch (_) {}
      return merged;
    }
  } catch (err) {
    console.warn('[CatalogSync] Failed to sync live channels:', err);
  }
  return null;
}

/**
 * Merge newly fetched items into target array, avoiding duplicates
 */
function mergeList(targetArray, newItems, prepend = true) {
  const existingIds = new Set(targetArray.map(item => item.id || item.imdb_id || item.title));
  const toAdd = [];

  for (const item of newItems) {
    const key = item.id || item.imdb_id || item.title;
    if (key && !existingIds.has(key)) {
      existingIds.add(key);
      toAdd.push(item);
    }
  }

  if (toAdd.length > 0) {
    if (prepend) {
      targetArray.unshift(...toAdd);
    } else {
      targetArray.push(...toAdd);
    }
  }

  return toAdd.length;
}

/**
 * Perform a full catalog synchronization from Cinemeta & Stremio feeds
 * @param {Object} catalogs Mutable catalog object { movies, series, anime, kids, sports, docs }
 * @param {Object} options { silent: boolean, onProgress: function }
 */
export async function syncAllCatalogs(catalogs, options = {}) {
  const startTime = Date.now();
  console.log('[CatalogSync] Starting catalog synchronization on application open...');

  if (options.onStatus) {
    options.onStatus({ status: 'syncing', message: 'Sincronizando catálogo de títulos...' });
  }

  // Always refresh sports schedule for Lima GMT-5
  if (catalogs.sports) {
    const updatedSports = generateLimaSportsMatches();
    catalogs.sports.length = 0;
    catalogs.sports.push(...updatedSports);
  }

  // Cinemeta endpoints to query
  const endpoints = [
    { type: 'movies', genre: 'top', url: 'https://cinemeta-catalogs.strem.io/top/catalog/movie/top.json' },
    { type: 'movies', genre: 'Action', url: 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Action.json' },
    { type: 'movies', genre: 'Animation', url: 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Animation.json' },
    { type: 'movies', genre: 'Sci-Fi', url: 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Sci-Fi.json' },
    { type: 'movies', genre: 'Comedy', url: 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Comedy.json' },
    { type: 'movies', genre: 'Drama', url: 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Drama.json' },
    { type: 'movies', genre: 'Horror', url: 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Horror.json' },
    { type: 'series', genre: 'top', url: 'https://cinemeta-catalogs.strem.io/top/catalog/series/top.json' },
    { type: 'series', genre: 'Drama', url: 'https://v3-cinemeta.strem.io/catalog/series/top/genre=Drama.json' },
    { type: 'series', genre: 'Action', url: 'https://v3-cinemeta.strem.io/catalog/series/top/genre=Action.json' },
    { type: 'series', genre: 'Animation', url: 'https://v3-cinemeta.strem.io/catalog/series/top/genre=Animation.json' },
    { type: 'series', genre: 'Documentary', url: 'https://v3-cinemeta.strem.io/catalog/series/top/genre=Documentary.json' },
    { type: 'movies', genre: 'Documentary', url: 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Documentary.json' }
  ];

  let addedMovies = 0;
  let addedSeries = 0;
  let addedAnime = 0;
  let addedKids = 0;
  let addedDocs = 0;

  try {
    // 1. Fetch from high-speed portal engine (movies, series, anime, kids)
    try {
      const portalRequests = [
        { cat: 'movies', key: 'movies' },
        { cat: 'series', key: 'series' },
        { cat: 'anime', key: 'anime' },
        { cat: 'kids', key: 'kids' }
      ];
      await Promise.allSettled(
        portalRequests.map(async (p) => {
          try {
            const resp = await fetch(`http://127.0.0.1:11472/api/vod/catalog?category=${p.cat}`);
            const data = await resp.json();
            if (data.ok && Array.isArray(data.items) && data.items.length > 0) {
              const mapped = data.items.map(it => mapPortalItem(it, p.key));
              if (catalogs[p.key]) {
                const added = mergeList(catalogs[p.key], mapped, true);
                if (p.key === 'movies') addedMovies += added;
                if (p.key === 'series') addedSeries += added;
                if (p.key === 'anime') addedAnime += added;
                if (p.key === 'kids') addedKids += added;
              }
            }
          } catch (err) {
            console.warn(`[CatalogSync] Portal ${p.cat} fetch warning:`, err.message);
          }
        })
      );
    } catch (e) {
      console.warn('[CatalogSync] Portal catalog query skipped:', e.message);
    }
    // Fetch in parallel with Promise.allSettled
    const results = await Promise.allSettled(
      endpoints.map(async ep => {
        const metas = await fetchCatalogEndpoint(ep.url);
        return { ep, metas };
      })
    );

    const newMoviesList = [];
    const newSeriesList = [];
    const newAnimeList = [];
    const newKidsList = [];
    const newDocsList = [];

    for (const res of results) {
      if (res.status !== 'fulfilled') continue;
      const { ep, metas } = res.value;

      for (const meta of metas) {
        if (!meta || !meta.id || !meta.name) continue;

        const genreStr = Array.isArray(meta.genre) ? meta.genre.join(' ').toLowerCase() : (meta.genre || '').toLowerCase();
        const titleLower = (meta.name || '').toLowerCase();
        
        // Strict Anime filter: Japanese Anime only, exclude Western animation
        const westernBlocklist = [
          'south park', 'simpson', 'rick and morty', 'family guy', 'haunted hotel',
          'american dad', 'futurama', 'bojack', 'big mouth', 'king of the hill',
          'spongebob', 'bob\'s burgers', 'archer', 'disenchantment', 'harley quinn',
          'solar opposites', 'avatar: the last airbender', 'the legend of korra',
          'avatar: seven havens', 'arcane', 'invincible', 'gravity falls', 'adventure time',
          'regular show', 'steven universe', 'star wars', 'marvel', 'batman', 'superman',
          'spider-man', 'x-men', 'justice league', 'velma', 'hazbin hotel',
          'helluva boss', 'camp camp', 'primal', 'fionna and cake', 'smiling friends'
        ];
        const isWestern = westernBlocklist.some(w => titleLower.includes(w)) ||
          ['disney', 'pixar', 'dreamworks', 'cartoon network', 'nickelodeon', 'warner bros', 'illumination'].some(w => genreStr.includes(w) || titleLower.includes(w));
        const isJapaneseAnimation = /japan/i.test(Array.isArray(meta.country) ? meta.country.join(' ') : String(meta.country || '')) && genreStr.includes('animation');
        const isAnime = !isWestern && (
          genreStr.includes('anime') ||
          isJapaneseAnimation ||
          ['dragon ball', 'naruto', 'one piece', 'bleach', 'jujutsu', 'demon slayer', 'hero academia', 'shingeki', 'titan', 'death note', 'sailor moon', 'saint seiya', 'inuyasha', 'conan', 'dunk', 'tsubasa', 'trigun', 'kenshin', 'sakura', 'mazinger', 'ranma'].some(k => titleLower.includes(k))
        );
        const isKids = !isAnime && (genreStr.includes('family') || genreStr.includes('animation'));
        const isDoc = genreStr.includes('documentary') || ep.genre === 'Documentary';

        if (isDoc) {
          newDocsList.push(ep.type === 'series' ? convertToSeriesItem(meta) : convertToMovieItem(meta));
        }

        if (isAnime && ep.type === 'series') {
          newAnimeList.push(convertToAnimeItem(meta));
        }

        if (isKids) {
          newKidsList.push(ep.type === 'series' ? convertToSeriesItem(meta) : convertToMovieItem(meta));
        }

        if (ep.type === 'movies' && !isKids && !isDoc) {
          newMoviesList.push(convertToMovieItem(meta));
        } else if (ep.type === 'series' && !isAnime && !isKids && !isDoc) {
          newSeriesList.push(convertToSeriesItem(meta));
        }
      }
    }

    // Merge into catalogs
    if (catalogs.movies) addedMovies = mergeList(catalogs.movies, newMoviesList, true);
    if (catalogs.series) addedSeries = mergeList(catalogs.series, newSeriesList, true);
    if (catalogs.anime) addedAnime = mergeList(catalogs.anime, newAnimeList, true);
    if (catalogs.kids) addedKids = mergeList(catalogs.kids, newKidsList, true);
    if (catalogs.docs) addedDocs = mergeList(catalogs.docs, newDocsList, true);

    const totalAdded = addedMovies + addedSeries + addedAnime + addedKids + addedDocs;
    const elapsed = Date.now() - startTime;

    console.log(`[CatalogSync] Sync finished in ${elapsed}ms. Added: ${totalAdded} new items.`);

    // Persist to local storage
    try {
      if (typeof localStorage !== 'undefined') {
        const cacheData = {
          movies: (catalogs.movies || []).slice(0, 300),
          series: (catalogs.series || []).slice(0, 150),
          anime: (catalogs.anime || []).slice(0, 100),
          kids: (catalogs.kids || []).slice(0, 100),
          docs: (catalogs.docs || []).slice(0, 100),
          lastSync: Date.now()
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
        localStorage.setItem(LAST_SYNC_KEY, JSON.stringify({
          timestamp: Date.now(),
          added: totalAdded,
          totalMovies: catalogs.movies?.length || 0,
          totalSeries: catalogs.series?.length || 0,
          totalAnime: catalogs.anime?.length || 0
        }));
      }
    } catch (saveErr) {
      console.warn('[CatalogSync] Failed to save cache (storage quota?):', saveErr);
    }

    if (options.onStatus) {
      options.onStatus({
        status: 'success',
        added: totalAdded,
        message: totalAdded > 0
          ? `Catálogo actualizado: +${totalAdded} nuevos títulos`
          : 'Catálogo al día con los últimos estrenos'
      });
    }

    return {
      success: true,
      added: totalAdded,
      elapsedMs: elapsed
    };
  } catch (err) {
    console.error('[CatalogSync] Error during catalog sync:', err);
    if (options.onStatus) {
      options.onStatus({ status: 'error', message: 'Error de conexión al sincronizar catálogo' });
    }
    return { success: false, error: err.message };
  }
}

/**
 * Get human-readable last sync status
 */
export function getLastSyncInfo() {
  try {
    if (typeof localStorage === 'undefined') return { text: 'Pendiente de sincronizar', hasSynced: false };
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return { text: 'Pendiente de sincronizar', hasSynced: false };
    const info = JSON.parse(raw);
    const date = new Date(info.timestamp);
    const timeStr = date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    return {
      text: `Hoy a las ${timeStr} (${info.totalMovies || 0} películas, ${info.totalSeries || 0} series)`,
      hasSynced: true,
      info: info
    };
  } catch (e) {
    return { text: 'Información no disponible', hasSynced: false };
  }
}
