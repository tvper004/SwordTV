/**
 * SwordTV Engine Server - macOS Native Media Bridge
 * High-performance streaming proxy & portal resolver (adapted from XuperTV).
 * Runs on 127.0.0.1:11472.
 */

const http = require('http');
const urlmod = require('url');
const magis = require('./magis');
const proxy = require('./proxy');
const relay = require('./ffmpeg-relay');
const activityLogger = require('./activity_logger');

let playbackGeneration = 0;
const torrentSources = new Map();
let torrentEngine = null;
const torrentOrigin = process.env.SWORDTV_ENGINE_URL || 'http://127.0.0.1:11470';
const PORT = Number(process.env.SWORDTV_PORT || 11472);

activityLogger.log('ENGINE', 'Starting SwordTV Engine Server...', { port: PORT });

// Start proxy on ephemeral port
proxy.start((err, proxyPort) => {
  if (err) {
    activityLogger.log('PROXY', 'Error starting streaming proxy', { error: err.message });
  } else {
    activityLogger.log('PROXY', 'Streaming proxy started successfully', { port: proxyPort });
  }
});

// Start FFmpeg relay for ultra-smooth native VOD MP4 remuxing
relay.start((err, relayPort) => {
  if (err) {
    activityLogger.log('RELAY', 'Error starting ffmpeg relay', { error: err.message });
  } else {
    activityLogger.log('RELAY', 'FFmpeg relay started successfully', { port: relayPort });
  }
});

// Warm up session
if (!process.env.SWORDTV_ENGINE_URL) magis.ensureSession((err, session) => {
  if (err) {
    activityLogger.log('PORTAL', 'Pre-session warning (will retry on demand)', { error: err.message });
  } else {
    activityLogger.log('PORTAL', 'Session ready', { userId: session.userId, sn: (session.sn || '').slice(0, 8) + '...' });
  }
});

function srtToVtt(srtText) {
  if (!srtText) return 'WEBVTT\n\n';
  let text = String(srtText).replace(/^\uFEFF/, '');
  if (text.startsWith('WEBVTT')) return text;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + text.trim() + '\n';
}

function sendJson(res, statusCode, data) {
  const jsonStr = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-cache'
  });
  res.end(jsonStr);
}

function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  if (handleCors(req, res)) return;

  const parsed = urlmod.parse(req.url, true);
  const pathname = parsed.pathname || '';
  const query = parsed.query || {};

  // Keep alternate sources on the same probe/relay pipeline as portal titles.
  const torrent = /^\/(probe|hls|sub_embed)\/([a-f0-9]{40})\/(\d+)(?:\/(stream\.m3u8|\d+))?$/i.exec(pathname);
  if (torrent) {
    const [, action, hash, file, subtitle] = torrent;
    const sourceUrl = `${torrentOrigin}/${hash}/${file}`;
    const key = `${hash}/${file}`;
    if (action === 'probe') {
      return (async () => {
        if (!process.env.SWORDTV_ENGINE_URL && !torrentEngine) {
          try { await fetch(torrentOrigin, { signal: AbortSignal.timeout(1000) }); }
          catch (_) {
            const path = require('path');
            torrentEngine = require('child_process').spawn(process.execPath, [path.join(__dirname, 'server.js')], {
              cwd: process.env.SWORDTV_DATA_DIR || __dirname,
              env: { ...process.env, FFMPEG_BIN: relay.path(), FFPROBE_BIN: relay.path().replace(/ffmpeg$/, 'ffprobe') },
              stdio: 'ignore'
            });
            torrentEngine.on('error', err => activityLogger.log('ENGINE', 'Alternate source engine failed', { error: err.message }));
            torrentEngine.on('exit', () => { torrentEngine = null; });
            // Wait until the spawned torrent engine binds to its port before probing.
            for (let wait = 0; wait < 40; wait++) {
              await new Promise(r => setTimeout(r, 150));
              try {
                await fetch(torrentOrigin, { signal: AbortSignal.timeout(400) });
                break;
              } catch (_) {}
            }
          }
        }
        relay.probeAudio(sourceUrl, {}, (err, audioTracks, metadata) => {
          if (metadata?.videoCodec) torrentSources.set(key, metadata);
          sendJson(res, 200, { ok: !!metadata?.videoCodec, ...metadata, audioTracks });
        }, 25000);
      })().catch(error => sendJson(res, 502, { ok: false, error: error.message }));
    }
    const metadata = torrentSources.get(key);
    if (!metadata) return sendJson(res, 404, { ok: false, error: 'Primero se debe comprobar esta fuente.' });
    if (action === 'sub_embed') {
      if (!metadata.subTracks?.some(s => String(s.streamIndex) === subtitle)) return sendJson(res, 404, { ok: false });
      const ff = require('child_process').spawn(relay.path(), ['-v', 'error', '-i', sourceUrl, '-map', `0:${subtitle}`, '-f', 'webvtt', 'pipe:1']);
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      ff.stdout.pipe(res);
      ff.stderr.resume();
      ff.on('error', () => res.destroy());
      res.on('close', () => ff.kill());
      return;
    }
    const audio = Math.max(0, parseInt(query.audio, 10) || 0);
    const startTime = Math.max(0, parseFloat(query.t) || 0);
    const sessionKey = `${audio}:${startTime}`;
    if (metadata.sessionKey !== sessionKey) {
      metadata.relayUrl = relay.register({ url: sourceUrl }, { isLive: false, hevc: metadata.videoCodec === 'hevc', audio, startTime });
      metadata.sessionKey = sessionKey;
    }
    res.writeHead(302, { Location: metadata.relayUrl, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    return res.end();
  }

  // 1. Forward streaming requests directly to proxy
  if (pathname.startsWith('/media/') || pathname.startsWith('/hls/') || pathname.startsWith('/sub/')) {
    return proxy.handler(req, res);
  }

  // 1b. Subtitle proxy & WebVTT converter
  if (pathname === '/sub' || pathname === '/api/vod/sub') {
    const subUrl = query.url;
    if (!subUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      return res.end('Missing sub url');
    }
    const fetchSub = (targetUrl, hops = 0) => {
      if (hops > 3) {
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        return res.end('Too many redirects');
      }
      let parsedSub;
      try {
        parsedSub = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsedSub.protocol)) throw new Error();
      } catch (_) { return sendJson(res, 400, { ok: false, error: 'URL de subtítulos inválida' }); }
      const isHttps = parsedSub.protocol === 'https:';
      const client = isHttps ? require('https') : require('http');
      const subReq = client.get(targetUrl, {
        timeout: 10000,
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'Ranger/4.9.4-17294ac0' }
      }, (subRes) => {
        if (subRes.statusCode >= 300 && subRes.statusCode < 400 && subRes.headers.location) {
          const loc = urlmod.resolve(targetUrl, subRes.headers.location);
          subRes.resume();
          return fetchSub(loc, hops + 1);
        }
        if (subRes.statusCode < 200 || subRes.statusCode >= 300) {
          subRes.resume();
          return sendJson(res, 502, { ok: false, error: 'La fuente de subtítulos no está disponible' });
        }
        const chunks = [];
        let size = 0;
        subRes.on('data', c => {
          size += c.length;
          if (size > 4 * 1024 * 1024) subReq.destroy(new Error('Subtítulos demasiado grandes'));
          else chunks.push(c);
        });
        subRes.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const vtt = srtToVtt(raw);
          const vttBuf = Buffer.from(vtt, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/vtt; charset=utf-8',
            'Content-Length': vttBuf.length,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
          });
          res.end(vttBuf);
        });
      });
      subReq.on('timeout', () => subReq.destroy(new Error('Tiempo de espera agotado')));
      subReq.on('error', (err) => {
        if (res.headersSent || res.destroyed) return;
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('Subtitle fetch error: ' + err.message);
      });
    };
    return fetchSub(subUrl);
  }

  // 2. Client activity logging endpoint
  if (pathname === '/api/log' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(body).toString('utf8'));
        activityLogger.log(payload.category || 'CLIENT', payload.action || 'ACTION', payload.details || {});
      } catch (e) {
        activityLogger.log('CLIENT', 'RAW_LOG', Buffer.concat(body).toString('utf8').slice(0, 200));
      }
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  // 3. Health check
  if (pathname === '/ping' || pathname === '/api/ping') {
    return sendJson(res, 200, {
      ok: true,
      service: 'SwordTV Native Engine',
      version: '2.0.1',
      appVersion: '1.1.4',
      proxyPort: proxy.port(),
      sessionReady: magis.session ? magis.session.ready : false
    });
  }

  // 4. Live TV: Categories
  if (pathname === '/api/live/categories') {
    return magis.getLiveCategories((err, categories) => {
      if (err) {
        activityLogger.log('ENGINE', 'Live categories error', { error: err.message });
        return sendJson(res, 500, { ok: false, error: err.message });
      }
      sendJson(res, 200, { ok: true, categories: categories || [] });
    });
  }

  // 5. Live TV: Channels in category
  if (pathname === '/api/live/channels') {
    const catId = query.catId || null;
    const page = parseInt(query.page, 10) || 1;
    const size = parseInt(query.size, 10) || 50;

    return magis.getLiveChannels(catId, page, size, (err, channels, hasMore) => {
      if (err) {
        activityLogger.log('ENGINE', 'Live channels error', { catId, error: err.message });
        return sendJson(res, 500, { ok: false, error: err.message });
      }
      activityLogger.log('ENGINE', 'Live channels delivered', { catId, count: (channels || []).length, hasMore: !!hasMore });
      sendJson(res, 200, { ok: true, channels: channels || [], hasMore: !!hasMore });
    });
  }

  // 6. Live TV: Resolve Channel Stream
  if (pathname === '/api/live/resolve') {
    const channelCode = query.code || query.channelCode;
    if (!channelCode) {
      return sendJson(res, 400, { ok: false, error: 'Falta channelCode' });
    }

    activityLogger.log('ENGINE', 'Resolving live stream', { channelCode });

    return magis.resolveLive(channelCode, (err, stream) => {
      if (err) {
        activityLogger.log('ENGINE', 'Live resolve failed', { channelCode, error: err.message });
        return sendJson(res, 500, { ok: false, error: err.message });
      }
      const token = proxy.add(stream.url, stream.headers, 0);
      const streamUrl = `${proxy.baseUrl()}/media/${token}/stream.m3u8`;
      const relayUrl = relay.available() ? relay.register({ url: streamUrl, headers: {} }, { hevc: true, isLive: true }) : null;
      activityLogger.log('ENGINE', 'Live resolve succeeded', { channelCode, name: stream.name, streamUrl, relayUrl });
      sendJson(res, 200, {
        ok: true,
        name: stream.name,
        streamUrl: streamUrl,
        relayUrl: relayUrl,
        rawUrl: stream.url,
        mime: stream.mime
      });
    });
  }

  // 6b. Live TV: Proxy & Relay wrapper for direct M3U/IPTV URLs (CORS/HTTP/Redirect/HEVC safe)
  if (pathname === '/api/live/proxy') {
    const rawUrl = query.url;
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      return sendJson(res, 400, { ok: false, error: 'URL de canal inválida' });
    }
    const isHls = /\.m3u8(?:[?#]|$)/i.test(rawUrl);
    const token = proxy.add(rawUrl, {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
    }, 0);
    const streamUrl = `${proxy.baseUrl()}/media/${token}/${isHls ? 'stream.m3u8' : 'stream.ts'}`;
    const relayUrl = relay.available() ? relay.register({ url: streamUrl, headers: {} }, { hevc: false, isLive: true }) : null;
    return sendJson(res, 200, {
      ok: true,
      streamUrl,
      relayUrl
    });
  }

  // 7. VOD: Catalog by Category (movies, series, anime, kids, featured, free)
  if (pathname === '/api/vod/catalog') {
    const category = query.category || 'movies';
    activityLogger.log('ENGINE', 'VOD catalog request', { category });
    return magis.home(category, (err, result) => {
      if (err) {
        activityLogger.log('ENGINE', 'VOD catalog error', { category, error: err.message });
        return sendJson(res, 500, { ok: false, error: err.message });
      }
      activityLogger.log('ENGINE', 'VOD catalog delivered', { category, count: (result.items || []).length, cached: !!result.cached });
      sendJson(res, 200, {
        ok: true,
        root: result.root,
        items: result.items || [],
        cached: result.cached
      });
    });
  }

  // 8. VOD: Search
  if (pathname === '/api/vod/search') {
    const q = query.q || query.query || '';
    if (!q.trim()) {
      return sendJson(res, 200, { ok: true, items: [] });
    }
    activityLogger.log('ENGINE', 'VOD search request', { query: q });
    return magis.search(q, (err, result) => {
      if (err) {
        activityLogger.log('ENGINE', 'VOD search error', { query: q, error: err.message });
        return sendJson(res, 500, { ok: false, error: err.message });
      }
      const count = (result && result.items) ? result.items.length : 0;
      activityLogger.log('ENGINE', 'VOD search results', { query: q, count });
      sendJson(res, 200, {
        ok: true,
        items: (result && result.items) || []
      });
    });
  }

  // 9. VOD: Detail (metadata, seasons, episodes)
  if (pathname === '/api/vod/detail') {
    const id = query.id || query.contentId;
    if (!id) {
      return sendJson(res, 400, { ok: false, error: 'Falta contentId (id)' });
    }
    activityLogger.log('ENGINE', 'VOD detail request', { id });
    return magis.detail(id, (err, result) => {
      if (err) {
        activityLogger.log('ENGINE', 'VOD detail error', { id, error: err.message });
        return sendJson(res, 500, { ok: false, error: err.message });
      }
      const epCount = (result.episodes || []).length;
      activityLogger.log('ENGINE', 'VOD detail delivered', { id, title: result.item?.title, episodesCount: epCount });
      sendJson(res, 200, {
        ok: true,
        item: result.item || null,
        episodes: result.episodes || [],
        seasons: result.seasons || []
      });
    });
  }

  // 10. VOD: Resolve Video Stream & Subtitles
  if (pathname === '/api/vod/resolve') {
    const id = query.id || query.contentId;
    const seriesId = query.seriesId || query.seriesContentId || query.playCode || '';
    if (!id) {
      return sendJson(res, 400, { ok: false, error: 'Falta contentId (id)' });
    }

    const generation = ++playbackGeneration;
    activityLogger.log('ENGINE', 'VOD resolve request', { id, seriesId });

    return magis.resolve(id, seriesId, {}, (err, stream) => {
      if (res.destroyed || generation !== playbackGeneration) return sendJson(res, 409, { ok: false, error: 'Reproducción cancelada' });
      if (err) {
        activityLogger.log('ENGINE', 'VOD resolve error', { id, seriesId, error: err.message });
        return sendJson(res, 500, { ok: false, error: err.message });
      }

      let relayUrl = '';
      const isMp4 = (stream.mime && stream.mime.includes('mp4')) || (stream.url && stream.url.includes('.mp4'));
      const isHevc = /hevc|h\.?265/i.test(stream.codec || '') || /hevc|h\.?265/i.test(stream.mime || '');
      let streamUrl = '';
      let format = 'mp4';
      let relayAudioSwitch = false;

      if (isMp4 && !isHevc) {
        const token = proxy.add(stream.url, stream.headers, stream.duration || 0);
        streamUrl = `${proxy.baseUrl()}/media/${token}/video.mp4`;
        // Keep a dormant relay so track changes and stalled MP4 playback can resume at the same position.
        if (relay.available()) {
          relayUrl = relay.register({ url: streamUrl, headers: {} }, { hevc: isHevc, isLive: false, audio: 0 });
          relayAudioSwitch = true;
        }
        format = 'mp4';
      } else {
        // Normalize HEVC for WebKit; remux other codecs to fMP4 HLS.
        const proxyToken = proxy.add(stream.url, stream.headers, stream.duration || 0);
        const loopbackTs = `${proxy.baseUrl()}/media/${proxyToken}/stream.ts`;
        streamUrl = relay.register({ url: loopbackTs, headers: {} }, { hevc: isHevc, isLive: false, audio: 0 });
        relayUrl = streamUrl;
        relayAudioSwitch = true;
        format = 'hls_fmp4';
      }

      const subtitles = (stream.subtitles || []).map((sub) => {
        let subProxyUrl = sub.url;
        try {
          subProxyUrl = proxy.addSubtitle(sub.url);
        } catch (_) {}
        return {
          lang: sub.lang || 'es',
          url: subProxyUrl,
          rawUrl: sub.url,
          format: sub.format || 'srt'
        };
      });

      relay.probeAudio(stream.url, stream.headers, (err, audioTracks, metadata) => {
        if (res.destroyed || generation !== playbackGeneration) return sendJson(res, 409, { ok: false, error: 'Reproducción cancelada' });
        activityLogger.log('ENGINE', 'VOD resolve success', { id, name: stream.name, format, streamUrl, duration: stream.duration, audioTracksCount: (audioTracks || []).length });

        sendJson(res, 200, {
          ok: true,
          name: stream.name,
          streamUrl: streamUrl,
          mime: format === 'mp4' ? 'video/mp4' : 'application/vnd.apple.mpegurl',
          codec: stream.codec,
          quality: stream.quality,
          duration: metadata?.duration || stream.duration || 0,
          subtitles: subtitles,
          audioTracks: audioTracks || [],
          availableTracks: stream.availableTracks || [],
          relayAudioSwitch,
          relayUrl
        });
      });
    });
  }

  // 11. Switch Audio Track on Active VOD Relay
  if (pathname === '/api/vod/switch_audio') {
    const audioIdx = parseInt(query.audio, 10) || 0;
    const startTime = parseFloat(query.time || query.startTime) || 0;
    const newStreamUrl = relay.switchAudio(audioIdx, startTime, query.source);
    if (!newStreamUrl) {
      return sendJson(res, 404, { ok: false, error: 'No active relay session to switch' });
    }
    activityLogger.log('RELAY', 'Switched audio track', { audio: audioIdx, startTime, newStreamUrl });
    return sendJson(res, 200, { ok: true, streamUrl: newStreamUrl });
  }

  // 12. Abort Active Playback Streams
  if (pathname === '/api/vod/abort' || pathname === '/api/live/abort') {
    playbackGeneration++;
    torrentSources.clear();
    activityLogger.log('ENGINE', 'Aborting active playback streams');
    try { relay.stop(); } catch (_) {}
    proxy.killActiveStreams();
    return sendJson(res, 200, { ok: true, aborted: true });
  }

  // Not found
  activityLogger.log('ENGINE', '404 Not found', { pathname });
  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  activityLogger.log('ENGINE', `HTTP API server listening on http://127.0.0.1:${server.address().port}`);
});

function shutdown() {
  torrentEngine?.kill();
  relay.stop();
  proxy.killActiveStreams();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
if (process.env.SWORDTV_PARENT_PID) {
  setInterval(() => {
    try { process.kill(Number(process.env.SWORDTV_PARENT_PID), 0); } catch (_) { shutdown(); }
  }, 2000).unref();
}
