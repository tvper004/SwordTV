const http = require('http');
const https = require('https');
const crypto = require('crypto');
const urlmod = require('url');
const tsIndexer = require('./ts-indexer');
const dnsx = require('./dnsx');
const activityLogger = require('./activity_logger');

const MAX_TOKENS = 128;
const tokens = {};
const order = [];
const subtitleTokens = {};
const subtitleOrder = [];
const MAX_SUBTITLES = 64;

let server = null;
let port = 0;
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 10000, timeout: 20000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 10000, timeout: 20000, rejectUnauthorized: false });
let activeToken = null;
const activeUpstreams = [];
const TS_PACKET_BYTES = 188;
const HLS_SEGMENT_SECONDS = 10;

function destroyConnection(conn) {
  if (!conn) return;
  if (conn.up) {
    try { conn.up.unpipe(); } catch (_) {}
    try { if (typeof conn.up.destroy === 'function') conn.up.destroy(); } catch (_) {}
    conn.up = null;
  }
  try {
    if (conn.upstream && typeof conn.upstream.destroy === 'function') {
      conn.upstream.destroy();
    } else if (conn.upstream && typeof conn.upstream.abort === 'function') {
      conn.upstream.abort();
    }
  } catch (_) {}
  try { if (conn.res && !conn.res.writableEnded && !conn.res.destroyed) conn.res.destroy(); } catch (_) {}
  conn.upstream = null;
  conn.res = null;
  conn.req = null;
}

function killActiveStreams() {
  while (activeUpstreams.length > 0) {
    destroyConnection(activeUpstreams.shift());
  }
}

function remember(id, item) {
  tokens[id] = item;
  order.push(id);
  while (order.length > MAX_TOKENS) {
    const expired = order.shift();
    if (expired) delete tokens[expired];
  }
}

function isCacheFlyIp(ip) {
  return !!ip && (/^66\.225\./.test(ip) || /^205\.234\./.test(ip) || /^167\.99\./.test(ip));
}

function resolveHostIp(target, cb) {
  if (!target) return cb('');
  if (target.resolvedIp && dnsx.isIpv4(target.resolvedIp)) {
    return cb(target.resolvedIp);
  }
  const host = urlmod.parse(target.url || '').hostname;
  if (!host || dnsx.isIpv4(host)) {
    target.resolvedIp = host || '';
    return cb(target.resolvedIp);
  }
  const cached = dnsx.cached(host);
  if (cached && cached.ips && cached.ips.length) {
    target.resolvedIp = dnsx.dial(host, cached.ips);
    return cb(target.resolvedIp);
  }
  dnsx.resolve(host, (err, info) => {
    if (!err && info && info.ips && info.ips.length) {
      target.resolvedIp = dnsx.dial(host, info.ips);
    } else {
      target.resolvedIp = host;
    }
    cb(target.resolvedIp);
  });
}

function add(url, headers, duration, resolvedIp) {
  const token = crypto.randomBytes(12).toString('hex');
  const record = {
    url: url,
    headers: headers || {},
    duration: Number(duration) || 0,
    contentLength: 0,
    lengthWaiters: null,
    resolvedIp: resolvedIp || '',
    at: Date.now()
  };
  remember(token, record);

  const parsed = urlmod.parse(url || '');
  if (parsed.hostname && !dnsx.isIpv4(parsed.hostname) && !record.resolvedIp) {
    const cached = dnsx.cached(parsed.hostname);
    if (cached && cached.ips && cached.ips.length) {
      record.resolvedIp = dnsx.dial(parsed.hostname, cached.ips);
    }
    dnsx.resolve(parsed.hostname, (err, info) => {
      if (!err && info && info.ips && info.ips.length) {
        record.resolvedIp = dnsx.dial(parsed.hostname, info.ips);
      }
    });
  }
  return token;
}

function srtToVtt(srtText) {
  if (!srtText) return 'WEBVTT\n\n';
  let text = String(srtText).replace(/^\uFEFF/, '');
  if (text.startsWith('WEBVTT')) return text;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + text.trim() + '\n';
}

function addSubtitle(url) {
  const token = crypto.randomBytes(12).toString('hex');
  subtitleTokens[token] = { url: url, at: Date.now() };
  subtitleOrder.push(token);
  while (subtitleOrder.length > MAX_SUBTITLES) {
    const expired = subtitleOrder.shift();
    if (expired) delete subtitleTokens[expired];
  }
  return `${baseUrl()}/sub/${token}.vtt`;
}

function sendSubtitle(req, res, target) {
  resolveHostIp(target, (resolvedIp) => {
    const parsed = urlmod.parse(target.url || '');
    const isHttps = parsed.protocol === 'https:';
    const host = parsed.hostname;
    const ip = resolvedIp || host;
    const defaultPort = isHttps ? 443 : 80;
    const port = parsed.port || defaultPort;

    const reqOpts = {
      hostname: ip,
      host: ip,
      servername: host,
      rejectUnauthorized: false,
      port: port,
      path: parsed.path,
      method: 'GET',
      headers: {
        'User-Agent': 'Ranger/4.9.4-17294ac0',
        'Accept': '*/*',
        'Host': parsed.host || (host + (port !== defaultPort ? ':' + port : ''))
      },
      agent: isHttps ? httpsAgent : httpAgent
    };

    let done = false;
    const upstreamReq = (isHttps ? https : http).request(reqOpts, (upRes) => {
      const chunks = [];
      upRes.on('data', c => chunks.push(c));
      upRes.on('end', () => {
        if (!done) {
          const body = Buffer.concat(chunks);
          const ok = upRes.statusCode >= 200 && upRes.statusCode < 300;
          const raw = body.toString('utf8');
          const vtt = srtToVtt(raw);
          const vttBuf = Buffer.from(vtt, 'utf8');
          res.writeHead(ok ? 200 : 502, {
            'Content-Type': 'text/vtt; charset=utf-8',
            'Content-Length': vttBuf.length,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600'
          });
          res.end(vttBuf);
        }
      });
    });

    upstreamReq.setTimeout(20000, () => {
      try { upstreamReq.abort(); } catch (_) {}
    });

    upstreamReq.on('error', () => {
      if (!done) {
        done = true;
        try {
          res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end('subtitle upstream error');
        } catch (_) {}
      }
    });

    upstreamReq.end();
  });
}

function mediaRequest(target, method, extraHeaders, resolvedIp) {
  const parsed = urlmod.parse(target.url || '');
  const host = parsed.hostname;
  let ip = resolvedIp || target.resolvedIp;
  if (!ip && host) {
    const cached = dnsx.cached(host);
    if (cached && cached.ips && cached.ips.length) {
      ip = dnsx.dial(host, cached.ips);
      target.resolvedIp = ip;
    }
  }
  if (!ip) ip = host;

  let isHttps = parsed.protocol === 'https:';
  const isCf = isCacheFlyIp(ip) || /swzablvpm|kyalbhxgw|m3x8o50te|qnrgmzpcw|faolmbghu/i.test(host || '');
  if (isCf) isHttps = true;

  const headers = {};
  for (const k in target.headers) {
    if (Object.prototype.hasOwnProperty.call(target.headers, k)) headers[k] = target.headers[k];
  }
  for (const k in extraHeaders || {}) {
    if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) headers[k] = extraHeaders[k];
  }

  const defaultPort = isHttps ? 443 : 80;
  let port = parsed.port || defaultPort;
  if (isHttps && parsed.port === '80') port = 443;
  headers.Host = parsed.host || (host + (port !== defaultPort ? ':' + port : ''));

  let servername = host;
  if (isCf) servername = 'cachefly.net';

  return {
    secure: isHttps,
    options: {
      hostname: ip,
      host: ip,
      servername: servername,
      rejectUnauthorized: false,
      port: port,
      path: parsed.path,
      method: method,
      headers: headers,
      agent: isHttps ? httpsAgent : httpAgent
    }
  };
}

function sourceLength(target, cb) {
  if (target.contentLength > 0) return cb(null, target.contentLength);
  if (target.lengthWaiters) {
    target.lengthWaiters.push(cb);
    return;
  }
  target.lengthWaiters = [cb];
  resolveHostIp(target, (resolvedIp) => {
    const m = mediaRequest(target, 'GET', { Range: 'bytes=0-0' }, resolvedIp);
    const req = (m.secure ? https : http).request(m.options, (res) => {
      const match = /\/(\d+)$/.exec(String(res.headers['content-range'] || ''));
      const len = match ? parseInt(match[1], 10) : parseInt(res.headers['content-length'], 10);
      res.resume();
      const waiters = target.lengthWaiters || [];
      target.lengthWaiters = null;
      if (len > 0) target.contentLength = len;
      for (let i = 0; i < waiters.length; i++) {
        waiters[i](len > 0 ? null : new Error('el CDN no informó el tamaño'), len);
      }
    });

    req.setTimeout(15000, () => {
      try { req.abort(); } catch (_) {}
    });

    req.on('error', (err) => {
      const waiters = target.lengthWaiters || [];
      target.lengthWaiters = null;
      for (let i = 0; i < waiters.length; i++) waiters[i](err);
    });

    req.end();
  });
}

function readRange(target, start, end, cb) {
  resolveHostIp(target, (resolvedIp) => {
    const m = mediaRequest(target, 'GET', { Range: `bytes=${start}-${end}` }, resolvedIp);
    const req = (m.secure ? https : http).request(m.options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        cb(ok ? null : new Error('rango rechazado'), Buffer.concat(chunks));
      });
    });

    req.setTimeout(25000, () => {
      try { req.abort(); } catch (_) {}
    });

    req.on('error', cb);
    req.end();
  });
}

function sendVirtualHls(req, res, token, target) {
  sourceLength(target, (err, len) => {
    if (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      return res.end('no se pudo crear el manifiesto HLS');
    }

    if (!target.indexer) {
      target.indexer = tsIndexer.create(len, (s, e, cb) => {
        readRange(target, s, e, cb);
      });
      target.indexer.start();
    }

    const idx = target.indexer;
    if (idx.segments.length || idx.complete) {
      const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        `#EXT-X-TARGETDURATION:${HLS_SEGMENT_SECONDS}`,
        '#EXT-X-MEDIA-SEQUENCE:0'
      ];
      for (let i = 0; i < idx.segments.length; i++) {
        const seg = idx.segments[i];
        lines.push(`#EXTINF:${seg.duration.toFixed(3)},`);
        lines.push(`#EXT-X-BYTERANGE:${seg.end - seg.start + 1}@${seg.start}`);
        lines.push('stream.ts');
      }
      if (idx.complete) lines.push('#EXT-X-ENDLIST');

      const manifest = lines.join('\n') + '\n';
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': Buffer.byteLength(manifest),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      res.end(manifest);
    } else {
      idx.when(() => sendVirtualHls(req, res, token, target));
    }
  });
}

function base64Url(str) {
  return Buffer.from(String(str), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function hlsChildUrl(token, parentUrl, childUri) {
  if (!childUri || childUri.startsWith('data:')) return childUri;
  const resolved = urlmod.resolve(parentUrl, childUri);
  const isM3u8 = /\.m3u8(?:[?#]|$)/i.test(resolved);
  const ext = isM3u8 ? '.m3u8' : '.ts';
  return `${baseUrl()}/hls/${token}/${base64Url(resolved)}${ext}`;
}

function rewriteHlsManifest(content, token, parentUrl) {
  const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.charAt(0) !== '#') {
      lines[i] = hlsChildUrl(token, parentUrl, line);
    } else if (line && line.includes('URI=')) {
      lines[i] = line.replace(/URI=("|')([^"']+)\1/g, (match, quote, uri) => {
        return `URI=${quote}${hlsChildUrl(token, parentUrl, uri)}${quote}`;
      });
    }
  }
  return lines.join('\n');
}

function forward(req, res, target, token, hops = 0) {
  if (hops === 0 && activeToken !== token) {
    killActiveStreams();
    activeToken = token;
  }

  const extraHeaders = {};
  if (req.headers.range) extraHeaders.Range = req.headers.range;
  if (req.headers['if-range']) extraHeaders['If-Range'] = req.headers['if-range'];

  resolveHostIp(target, (resolvedIp) => {
    if (res.writableEnded || res.destroyed) return;

    const m = mediaRequest(target, req.method === 'HEAD' ? 'HEAD' : 'GET', extraHeaders, resolvedIp);
    if (res.socket) {
      try { res.socket.setNoDelay(true); } catch (_) {}
    }

    const conn = { upstream: null, res: res, req: req, up: null };
    activeUpstreams.push(conn);

    function detachConn() {
      const idx = activeUpstreams.indexOf(conn);
      if (idx !== -1) activeUpstreams.splice(idx, 1);
    }

    function cleanup(reason) {
      detachConn();
      destroyConnection(conn);
    }

    req.on('aborted', () => cleanup('req aborted'));
    res.on('close', () => {
      if (!res.writableEnded) cleanup('res closed prematurely');
    });
    res.on('error', (err) => cleanup('res error: ' + err.message));

    const upstreamReq = (m.secure ? https : http).request(m.options, (upstreamRes) => {
      conn.up = upstreamRes;
      if (upstreamRes.socket) {
        try { upstreamRes.socket.setNoDelay(true); } catch (_) {}
      }

      upstreamReq.setTimeout(0);
      if (upstreamReq.socket) {
        try { upstreamReq.socket.setTimeout(0); } catch (_) {}
      }

      // Follow 301/302/303/307/308 redirects transparently
      if (upstreamRes.statusCode >= 300 && upstreamRes.statusCode < 400 && upstreamRes.headers.location && hops < 4) {
        const nextUrl = urlmod.resolve(target.url, upstreamRes.headers.location);
        upstreamRes.resume();
        detachConn();
        return forward(req, res, { ...target, url: nextUrl, resolvedIp: '' }, token, hops + 1);
      }

      const ctype = (upstreamRes.headers['content-type'] || '').toLowerCase();
      let mime = 'video/mp2t';
      if (ctype.includes('mp4')) {
        mime = 'video/mp4';
      } else if (ctype.includes('mpegurl') || (target.url && target.url.includes('.m3u8'))) {
        mime = 'application/vnd.apple.mpegurl';
      }

      const isHls = mime === 'application/vnd.apple.mpegurl';
      const outHeaders = {
        'Content-Type': mime,
        'Accept-Ranges': upstreamRes.headers['accept-ranges'] || 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': isHls ? 'no-cache, no-store' : 'private, max-age=120',
        'Connection': 'keep-alive'
      };

      if (upstreamRes.headers['content-length']) outHeaders['Content-Length'] = upstreamRes.headers['content-length'];
      if (upstreamRes.headers['content-range']) outHeaders['Content-Range'] = upstreamRes.headers['content-range'];

      if (req.method === 'HEAD') {
        res.writeHead(upstreamRes.statusCode || 200, outHeaders);
        res.end();
        upstreamRes.resume();
        return;
      }

      if (isHls) {
        const hlsChunks = [];
        upstreamRes.on('data', c => hlsChunks.push(c));
        upstreamRes.on('error', (err) => cleanup('upstreamRes HLS error: ' + err.message));
        upstreamRes.on('end', () => {
          const raw = Buffer.concat(hlsChunks).toString('utf8');
          if ((upstreamRes.statusCode && upstreamRes.statusCode >= 400) || raw.trim().startsWith('<')) {
            try {
              res.writeHead(upstreamRes.statusCode >= 400 ? upstreamRes.statusCode : 404, { 'Access-Control-Allow-Origin': '*' });
              res.end('upstream not available');
            } catch (_) {}
            cleanup('upstream not available');
            return;
          }
          const rewritten = rewriteHlsManifest(raw, token, target.url);
          delete outHeaders['Content-Length'];
          delete outHeaders['Content-Range'];
          outHeaders['Content-Length'] = Buffer.byteLength(rewritten);
          try {
            res.writeHead(upstreamRes.statusCode || 200, outHeaders);
            res.end(rewritten);
          } catch (_) {
            cleanup('res.end hls failed');
          }
          cleanup('hls manifest done');
        });
        return;
      }

      // Normal video stream (TS, MP4, etc.)
      res.writeHead(upstreamRes.statusCode || 200, outHeaders);
      upstreamRes.on('error', (err) => cleanup('upstreamRes stream error: ' + err.message));
      res.on('finish', () => {
        cleanup('stream finish');
      });
      upstreamRes.pipe(res);
    });

    conn.upstream = upstreamReq;
    if (upstreamReq.socket) {
      try { upstreamReq.socket.setNoDelay(true); } catch (_) {}
    }

    upstreamReq.setTimeout(25000, () => {
      if (!res.headersSent) {
        try { upstreamReq.abort(); } catch (_) {}
        try {
          res.writeHead(504, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end('gateway timeout');
        } catch (_) {}
      }
      cleanup();
    });

    upstreamReq.on('error', (err) => {
      if (!res.headersSent) {
        try {
          res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end('upstream error');
        } catch (_) {}
      }
      cleanup();
    });

    upstreamReq.end();
  });
}

function handler(req, res) {
  try { req.setTimeout(0); } catch (_) {}
  try { res.setTimeout(0); } catch (_) {}

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range'
    });
    return res.end();
  }

  if (req.url === '/media/abort') {
    killActiveStreams();
    activeToken = null;
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    return res.end('aborted');
  }

  const subMatch = /^\/sub\/([a-f0-9]{24})\.(?:vtt|srt)$/.exec(req.url || '');
  if (subMatch) {
    const subTarget = subtitleTokens[subMatch[1]];
    if (!subTarget) {
      res.writeHead(410, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      return res.end('expired');
    }
    return sendSubtitle(req, res, subTarget);
  }

  const hlsMatch = /^\/hls\/([a-f0-9]{24})\/([A-Za-z0-9_-]+)(?:\.[a-zA-Z0-9]+)?$/.exec((req.url || '').split('?')[0]);
  if (hlsMatch) {
    const hlsTarget = tokens[hlsMatch[1]];
    if (!hlsTarget) {
      res.writeHead(410, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      return res.end('expired');
    }
    const decodedUrl = fromBase64Url(hlsMatch[2]);
    if (/^https?:\/\//i.test(decodedUrl)) {
      return forward(req, res, { url: decodedUrl, headers: hlsTarget.headers, duration: 0 }, hlsMatch[1]);
    }
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    return res.end('invalid hls child');
  }

  const mediaMatch = /^\/media\/([a-f0-9]{24})(?:\/([^\?#]*))?(?:[?#].*)?$/.exec(req.url || '');
  if (!mediaMatch) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    return res.end('not found');
  }

  const token = mediaMatch[1];
  const subpath = mediaMatch[2] || '';
  const mediaTarget = tokens[token];
  if (!mediaTarget) {
    res.writeHead(410, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    return res.end('expired');
  }

  if (mediaTarget.url.includes('.m3u8') || !subpath.includes('.m3u8')) {
    forward(req, res, mediaTarget, token);
  } else {
    sendVirtualHls(req, res, token, mediaTarget);
  }
}

function start(cb) {
  if (server && port) return cb(null, port);
  server = http.createServer(handler);
  server.timeout = 0;
  if (typeof server.setTimeout === 'function') server.setTimeout(0);
  server.on('error', cb);
  server.listen(0, () => {
    port = server.address().port;
    cb(null, port);
  });
}

function baseUrl() {
  return port ? `http://127.0.0.1:${port}` : '';
}

module.exports = {
  start,
  add,
  addSubtitle,
  baseUrl,
  port: () => port,
  killActiveStreams,
  handler
};
