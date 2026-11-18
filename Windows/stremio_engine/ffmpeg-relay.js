"use strict";

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const urlmod = require('url');
const spawn = require('child_process').spawn;
const activityLogger = require('./activity_logger');

let server = null;
let port = 0;
const HOST = '127.0.0.1';
const sessions = {};
let currentToken = null;

const BASE_RELAY_DIR = path.join(os.tmpdir(), 'swordtv_relay');
try {
  if (!fs.existsSync(BASE_RELAY_DIR)) {
    fs.mkdirSync(BASE_RELAY_DIR, { recursive: true });
  }
} catch (_) {}

function findFfmpeg() {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = isWin ? [
    path.join(path.dirname(process.execPath), binName),
    path.join(__dirname, 'bin', binName),
    path.join(process.env.LOCALAPPDATA || '', 'SwordTV', 'bin', binName),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'
  ] : [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg'
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return binName;
}

function findFfprobe() {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'ffprobe.exe' : 'ffprobe';
  const candidates = isWin ? [
    path.join(path.dirname(process.execPath), binName),
    path.join(__dirname, 'bin', binName),
    path.join(process.env.LOCALAPPDATA || '', 'SwordTV', 'bin', binName),
    'C:\\ffmpeg\\bin\\ffprobe.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe'
  ] : [
    '/opt/homebrew/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/usr/bin/ffprobe'
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return binName;
}

const FFMPEG = findFfmpeg();
const FFPROBE = findFfprobe();

function stopSession(token) {
  if (!token) return;
  const s = sessions[token];
  if (s) {
    if (s.proc) {
      try { s.proc.kill('SIGKILL'); } catch (_) {}
      s.proc = null;
    }
    try {
      if (s.dir && fs.existsSync(s.dir)) {
        fs.rmSync(s.dir, { recursive: true, force: true });
      }
    } catch (_) {}
    delete sessions[token];
  }
  if (currentToken === token) currentToken = null;
}

function stopCurrent() {
  Object.keys(sessions).forEach(stopSession);
}

function splitHeaders(headers) {
  let ua = null;
  const rest = [];
  Object.keys(headers || {}).forEach((k) => {
    if (k.toLowerCase() === 'user-agent') {
      ua = headers[k];
    } else {
      rest.push(`${k}: ${headers[k]}\r\n`);
    }
  });
  return { ua, rest: rest.join('') };
}

function cleanOldSessions(maxActive = 3) {
  const tokenKeys = Object.keys(sessions);
  const now = Date.now();
  tokenKeys.forEach((tok) => {
    const s = sessions[tok];
    if (s && (now - s.createdAt > 300000 || (tokenKeys.length > maxActive && tok !== currentToken))) {
      stopSession(tok);
    }
  });
}

function register(target, opts) {
  opts = opts || {};
  cleanOldSessions(3);

  const token = crypto.randomBytes(8).toString('hex');
  const sessionDir = path.join(BASE_RELAY_DIR, token);
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch (_) {}

  sessions[token] = {
    url: target.url,
    headers: target.headers || {},
    audio: Math.max(0, Number(opts.audio) || 0),
    hevc: opts.hevc !== false,
    isLive: opts.isLive !== false,
    startTime: Math.max(0, Number(opts.startTime) || 0),
    dir: sessionDir,
    proc: null,
    started: false,
    createdAt: Date.now()
  };
  currentToken = token;

  return `http://${HOST}:${port}/hls/${token}/stream.m3u8`;
}

function spawnFfmpeg(token) {
  const session = sessions[token];
  if (!session || session.started) return;
  session.started = true;

  const spl = splitHeaders(session.headers);
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-nostdin',
    '-probesize', '2M',
    '-analyzeduration', '2M'
  ];

  if (/\.m3u8(?:[?#]|$)/i.test(session.url)) {
    args.push(
      '-extension_picky', '0',
      '-allowed_extensions', 'ALL',
      '-allowed_segment_extensions', 'ALL'
    );
  }

  if (/^https:\/\//i.test(session.url)) {
    args.push('-tls_verify', '0');
  }
  if (/^https?:\/\//i.test(session.url)) {
    args.push('-rw_timeout', '15000000');
    if (spl.ua) args.push('-user_agent', spl.ua);
    if (spl.rest) args.push('-headers', spl.rest);
  }

  if (session.startTime > 0) {
    args.push('-ss', String(session.startTime));
  }

  args.push('-i', session.url);
  args.push('-map', '0:v:0');
  args.push('-map', `0:a:${session.audio}?`);
  // Portal HEVC can change parameter sets after the intro. Copying it into hvc1
  // freezes WebKit's decoder. Re-encode on seek too: stream-copy keeps keyframe
  // preroll while audio seeks exactly, shifting both the timeline and subtitles.
  if (!session.isLive && (session.hevc || session.startTime > 0)) {
    args.push('-c:v', process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264');
    // ponytail: fixed 5 Mb/s compatibility output; use probed resolution for adaptive 4K bitrate if needed.
    if (process.platform === 'darwin') args.push('-allow_sw', '1', '-b:v', '5M');
    else args.push('-preset', 'veryfast', '-crf', '20');
    args.push('-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*3)', '-tag:v', 'avc1');
  } else {
    args.push('-c:v', 'copy');
    if (session.hevc) args.push('-tag:v', 'hvc1');
  }

  // Safe universal audio stream: ensure AAC output compatible with fMP4 and WebKit
  if (session.isLive) {
    args.push('-c:a', 'aac', '-b:a', '192k');
    args.push(
      '-hls_time', '2',
      '-hls_list_size', '5',
      '-hls_flags', 'delete_segments+temp_file'
    );
  } else {
    args.push('-c:a', 'aac', '-b:a', '192k');
    args.push(
      '-hls_time', '2',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'event',
      '-hls_flags', 'temp_file'
    );
  }

  args.push('-hls_segment_type', 'fmp4');

  const manifestPath = path.join(session.dir, 'stream.m3u8');
  args.push('-y', manifestPath);

  activityLogger.log('RELAY', 'Starting ffmpeg fMP4 relay', {
    token,
    url: session.url.slice(0, 80),
    isLive: session.isLive,
    hevc: session.hevc
  });

  const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  session.proc = proc;

  proc.stderr.on('data', (d) => {
    const msg = String(d).trim();
    if (msg) {
      session.lastError = msg.slice(-1000);
      console.warn('[relay-ffmpeg]', msg);
    }
  });

  proc.on('close', (code) => {
    activityLogger.log('RELAY', 'ffmpeg relay process closed', { token, code, error: code ? session.lastError : undefined });
    session.failed = code !== 0;
    if (session.proc === proc) session.proc = null;
  });

  proc.on('error', (err) => {
    activityLogger.log('RELAY', 'ffmpeg spawn error', { token, error: err.message });
  });
}

function handleRequest(req, res) {
  const parsed = urlmod.parse(req.url, true);

  if (parsed.pathname === '/abort' || parsed.pathname === '/media/abort') {
    stopCurrent();
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end('aborted');
  }

  // Also support legacy /s/:token.mp4 requests by routing to stream.m3u8
  const legacyMatch = /^\/s\/([0-9a-fA-Z_-]+)\.mp4$/.exec(parsed.pathname || '');
  if (legacyMatch) {
    const token = legacyMatch[1];
    res.writeHead(302, {
      'Location': `/hls/${token}/stream.m3u8`,
      'Access-Control-Allow-Origin': '*'
    });
    return res.end();
  }

  const match = /^\/hls\/([0-9a-zA-Z_-]+)\/([^\/?#]+)$/.exec(parsed.pathname || '');
  if (!match) {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    return res.end('not found');
  }

  const [, token, filename] = match;
  const session = sessions[token];
  if (!session) {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    return res.end('session expired or not found');
  }

  // Ensure FFmpeg is running for this session
  if (!session.started) {
    spawnFfmpeg(token);
  }

  const filePath = path.join(session.dir, filename);

  if (filename.endsWith('.m3u8')) {
    const startTime = Date.now();
    const waitManifest = (attempts = 0) => {
      if (res.destroyed) return;
      if (session.failed) {
        res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
        return res.end('No se pudo preparar el video.');
      }
      if (fs.existsSync(filePath)) {
        try {
          const text = fs.readFileSync(filePath, 'utf8');
          if (text.includes('.m4s') || (!session.isLive && text.includes('#EXT-X-ENDLIST'))) {
            res.writeHead(200, {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Content-Length': Buffer.byteLength(text),
              'Cache-Control': 'no-cache, no-store',
              'Access-Control-Allow-Origin': '*'
            });
            return res.end(text);
          }
        } catch (_) {}
      }
      if (attempts > 200 || (Date.now() - startTime > 20000)) {
        res.writeHead(504, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end('Timeout waiting for HLS fMP4 manifest');
      }
      setTimeout(() => waitManifest(attempts + 1), 100);
    };
    return waitManifest();
  }

  if (filename !== 'init.mp4' && !/^stream\d+\.m4s$/.test(filename)) {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    return res.end('not found');
  }
  const serveSegment = (attempts = 0) => {
    if (res.destroyed) return;
    if (!fs.existsSync(filePath)) {
      if (!session.failed && session.proc && attempts < 12) {
        return setTimeout(() => serveSegment(attempts + 1), 50);
      }
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      return res.end('segment not found');
    }
    const size = fs.statSync(filePath).size;
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Access-Control-Allow-Origin': '*' });
      return res.end();
    }
    res.writeHead(range ? 206 : 200, {
      'Content-Type': filename === 'init.mp4' ? 'video/mp4' : 'video/iso.segment',
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      'Cache-Control': 'public, max-age=120',
      'Access-Control-Allow-Origin': '*'
    });
    if (req.method === 'HEAD') return res.end();
    const file = fs.createReadStream(filePath, { start, end });
    file.on('error', () => res.destroy());
    res.on('close', () => file.destroy());
    file.pipe(res);
  };
  return serveSegment();
}

function switchAudio(audioIndex, startTime, sourceUrl) {
  const token = sourceUrl ? /\/hls\/([a-f0-9]+)\//.exec(sourceUrl)?.[1] : currentToken;
  const current = token ? sessions[token] : null;
  if (!current) return null;
  const target = { url: current.url, headers: current.headers };
  const opts = {
    audio: parseInt(audioIndex, 10) || 0,
    startTime: Math.max(0, parseFloat(startTime) || 0),
    hevc: current.hevc,
    isLive: current.isLive
  };
  const next = register(target, opts);
  if (current.proc) { current.proc.kill(); current.proc = null; }
  return next;
}

function probeAudio(url, headers, cb, timeoutMs = 4000) {
  if (typeof headers === 'function') {
    cb = headers;
    headers = {};
  }
  if (!url) return cb ? cb(null, []) : [];
  const spl = splitHeaders(headers);
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams', '-show_format',
    '-analyzeduration', '1000000',
    '-probesize', '1000000'
  ];
  if (/^https:\/\//i.test(url)) {
    args.unshift('-tls_verify', '0');
  }
  if (/^https?:\/\//i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(url)) {
    args.unshift('-rw_timeout', '3000000');
  }
  if (spl.ua) args.push('-user_agent', spl.ua);
  if (spl.rest) args.push('-headers', spl.rest);
  args.push(url);

  let done = false;
  const finish = (err, res, metadata = {}) => {
    if (!done) {
      done = true;
      clearTimeout(timer);
      if (cb) cb(err, res, metadata);
    }
  };

  const timer = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch (_) {}
    finish(null, []);
  }, timeoutMs);

  const proc = spawn(FFPROBE, args);
  let out = '';
  proc.stdout.on('data', d => out += d);
  proc.on('error', () => finish(null, []));
  proc.on('close', () => {
    try {
      const data = JSON.parse(out);
      const audioStreams = (data.streams || [])
        .filter(s => s.codec_type === 'audio')
        .map((s, aIdx) => {
          const lang = (s.tags && (s.tags.language || s.tags.lang)) || '';
          const title = (s.tags && s.tags.title) || '';
          let label = title || lang || `Pista ${aIdx + 1}`;
          const isSpa = /es|spa|lat/i.test(lang) || /español|spanish|latino/i.test(title);
          const isEng = /en|eng/i.test(lang) || /english|inglés/i.test(title);
          const isJpn = /ja|jpn/i.test(lang) || /japanese|japonés/i.test(title);
          if (isSpa) label = '🇪🇸 Español (Doblaje / Latino)';
          else if (isEng) label = '🇺🇸 Inglés (English)';
          else if (isJpn) label = '🇯🇵 Japonés (Original)';
          return {
            index: aIdx,
            streamIndex: s.index,
            codec: s.codec_name,
            channels: s.channels,
            language: lang,
            label: label,
            isSpanish: isSpa,
            isJapanese: isJpn,
            isEnglish: isEng
          };
        });
      const video = (data.streams || []).find(s => s.codec_type === 'video');
      finish(null, audioStreams, {
        duration: Number(data.format?.duration || video?.duration) || 0,
        videoCodec: video?.codec_name || '',
        subTracks: (data.streams || []).filter(s => s.codec_type === 'subtitle' && ['subrip', 'ass', 'ssa', 'webvtt', 'mov_text'].includes(s.codec_name)).map(s => ({
          streamIndex: s.index, lang: s.tags?.language || '',
          label: s.tags?.title || s.tags?.language || `Subtítulo ${s.index}`,
          isSpanish: /^(es|spa)(-|$)/i.test(s.tags?.language || '')
        }))
      });
    } catch (_) {
      finish(null, []);
    }
  });
}

function start(cb) {
  if (server && port) return cb ? cb(null, port) : port;
  server = http.createServer(handleRequest);
  server.timeout = 0;
  server.listen(0, HOST, () => {
    port = server.address().port;
    activityLogger.log('RELAY', `FFmpeg HLS fMP4 relay listening on ${HOST}:${port} using ${FFMPEG}`);
    if (cb) cb(null, port);
  });
  server.on('error', (err) => {
    activityLogger.log('RELAY', 'Relay server error', { error: err.message });
    if (cb) cb(err);
  });
}

module.exports = {
  start,
  register,
  switchAudio,
  probeAudio,
  stop: stopCurrent,
  stopSession,
  available: () => {
    try {
      if (fs.existsSync(FFMPEG)) return true;
      return require('child_process').spawnSync(FFMPEG, ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0;
    } catch (_) {
      return false;
    }
  },
  path: () => FFMPEG,
  port: () => port,
  baseUrl: () => (port ? `http://${HOST}:${port}` : '')
};
