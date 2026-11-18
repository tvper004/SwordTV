import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';

// Exercise the real app functions without a browser or a framework.
const appFile = new URL('../src/app.js', import.meta.url);
let source = fs.readFileSync(appFile, 'utf8');
const imports = {};
for (const match of source.matchAll(/import\s*{([\s\S]*?)}\s*from\s*'([^']+)';/g)) {
  const module = await import(new URL(match[2], appFile));
  for (const entry of match[1].split(',')) {
    const [name, alias = name] = entry.trim().split(/\s+as\s+/);
    imports[alias] = module[name];
  }
}
source = source.replace(/import\s*{[\s\S]*?}\s*from\s*'[^']+';/g, '').replace(/\bexport (?=let|const|function)/g, '');
source = source.replace(/(?<!function )initApp\(\);/g, '');
class Element extends EventTarget {
  constructor() {
    super();
    const classes = new Set();
    this.classList = { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle: (x, on = !classes.has(x)) => on ? classes.add(x) : classes.delete(x) };
    this.style = {}; this.dataset = {}; this.textTracks = []; this.audioTracks = [];
    this.currentTime = 0; this.duration = 60; this.videoWidth = 320; this.paused = true; this.urls = [];
  }
  setAttribute() {}
  getAttribute() { return ''; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  appendChild(child) { (this.children ||= []).push(child); }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html; }
  insertAdjacentHTML() {}
  pause() { this.paused = true; }
  load() { this.error = null; }
  canPlayType() { return 'probably'; }
  play() {
    this.urls.push(this.src);
    queueMicrotask(() => {
      if (this.src.includes('bad')) { this.error = { code: 4 }; this.dispatchEvent(new Event('error')); }
      else { this.paused = false; this.onloadedmetadata?.(); this.onplaying?.(); this.dispatchEvent(new Event('playing')); }
    });
    return Promise.resolve();
  }
}
const nodes = new Map();
const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
const storage = new Map();
const context = vm.createContext({ ...imports, console, URL, AbortController, DOMException, setTimeout, clearTimeout, setInterval, clearInterval,
  window: {}, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  document: { getElementById: node, addEventListener() {}, querySelectorAll: () => [], createElement: () => new Element() }
});
vm.runInContext(source + '\nglobalThis.check = { parseStreamSource, fetchStremioStreams, autoResolveAndPlayVod, closeVodPlayer, setupVodPlayer, saveVodProgress, getVodProgress, state, seekVodTo, getVodEffectiveCurrentTime, updateActiveSubtitleCue, ensureSeriesEpisodes, promptOrPlayVod, loadSubtitlesForPlayer };', context);
const app = context.check;
app.state.currentCategory = 'movies';
app.setupVodPlayer();
let streams = [];
context.fetch = async url => ({ ok: true, json: async () => String(url).includes('/stream/') ? { streams } : { subtitles: [], metas: [] } });
const fakeSource = (url, seeds = 1) => ({ name: 'Source\n1080p', title: `Example 1080p\n👤 ${seeds}`, url });
const item = { id: 'tt0000001', title: 'Example' };
try {
  const avi = app.parseStreamSource({ name: 'Torrentio', title: 'Collection\n👤 57 💾 1.36 GB ⚙️ Wolfmax4k\n🇪🇸', infoHash: 'a'.repeat(40), fileIdx: 151, behaviorHints: { filename: 'Example.avi' } });
  assert.equal(avi.resolution, 0, 'provider name must not become a video quality');
  assert.equal(avi.compatibilityRisk, 1);
  assert.equal(app.parseStreamSource({ infoHash: 'a'.repeat(40) }), null, 'never guess a torrent file index');
  const episodeRequests = [];
  context.fetch = async url => {
    episodeRequests.push(String(url));
    return { ok: true, json: async () => ({ streams: [
      { name: 'Torrentio\n1080p', title: 'Show.S03E02.1080p', infoHash: 'c'.repeat(40), fileIdx: 1 },
      { name: 'Torrentio\n1080p', title: 'Show.S03E01.1080p', infoHash: 'd'.repeat(40), fileIdx: 2 }
    ] }) };
  };
  const episodeStreams = await app.fetchStremioStreams({ id: 'tt0000002', imdbId: 'tt0000002', title: 'Show', category: 'anime' }, { seasonNum: 3, episodeNum: 1 });
  assert.ok(episodeRequests.includes('https://torrentio.strem.fun/stream/series/tt0000002:3:1.json'), 'anime episode request must include its season and episode');
  assert.equal(episodeStreams.length, 1, 'a different episode must not be selected');
  assert.equal(episodeStreams[0].infoHash, 'd'.repeat(40));
  app.saveVodProgress({ itemId: 'movie-progress', time: 30, duration: 120 });
  assert.equal('episodeNum' in app.getVodProgress('movie-progress'), false, 'movie progress must not be recorded as episode 1');
  app.saveVodProgress({ itemId: 'episode-progress', episodeNum: 1, seasonNum: 3, time: 30, duration: 120 });
  assert.deepEqual([app.getVodProgress('episode-progress').seasonNum, app.getVodProgress('episode-progress').episodeNum], [3, 1]);
  streams = [fakeSource('https://media.invalid/bad.mp4', 2), fakeSource('https://media.invalid/good.mp4')];
  context.fetch = async url => ({ ok: true, json: async () => String(url).includes('/stream/') ? { streams } : { subtitles: [], metas: [] } });
  await app.autoResolveAndPlayVod(item);
  assert.deepEqual(node('vod-video').urls.slice(-2), streams.map(s => s.url), 'fallback must reach the second source');
  assert.equal(node('vod-player-overlay').classList.contains('open'), true);
  assert.equal(node('vod-buffering-overlay').style.display, 'none');
  streams = [fakeSource('https://media.invalid/bad.mp4')];
  await app.autoResolveAndPlayVod(item);
  assert.equal(node('vod-player-overlay').classList.contains('open'), true, 'errors must not close the player');
  assert.equal(node('vod-buffering-overlay').classList.contains('failed'), true);
  const before = node('vod-video').urls.length;
  let finishRequest;
  context.fetch = url => String(url).includes('/api/vod/abort') ? Promise.resolve({ ok: true }) : new Promise(resolve => { finishRequest = resolve; });
  const pending = app.autoResolveAndPlayVod(item);
  while (!finishRequest) await new Promise(resolve => setTimeout(resolve, 0));
  app.closeVodPlayer(false);
  finishRequest({ ok: true, json: async () => ({ streams: [fakeSource('https://media.invalid/late.mp4')] }) });
  await pending;
  assert.equal(node('vod-player-overlay').classList.contains('open'), false, 'cancelled lookup must not reopen the player');
  assert.equal(node('vod-video').urls.length, before);
  // Explicit sources must win over title searches and portal resolution.
  context.fetch = async () => ({ ok: true, json: async () => ({}) });
  await app.autoResolveAndPlayVod({ id: 'a'.repeat(32), portal: true, title: 'Portal' }, null, 0,
    { streamUrl: 'https://media.invalid/chosen.mp4' });
  assert.equal(node('vod-video').src, 'https://media.invalid/chosen.mp4');

  // The provider includes the current season in the season list; do not discard it.
  const series = { id: 'series-two', title: 'Show T2', portal: true };
  context.fetch = async url => ({ ok: true, json: async () => String(url).includes('series-one')
    ? { ok: true, episodes: [{ id: 'one', number: 1 }] }
    : { ok: true, episodes: [{ id: 'two', number: 1 }], seasons: [{ id: 'series-one', number: 1 }, { id: 'series-two', number: 2 }] } });
  await app.ensureSeriesEpisodes(series, 'series');
  assert.deepEqual(Array.from(series.seasonList, s => [s.seasonNum, s.episodes[0].id]), [[1, 'one'], [2, 'two']]);

  context.fetch = async url => ({ ok: true, json: async () => String(url).includes('/search?')
    ? { ok: true, items: [{ id: 'series-two', title: 'Show T2', kind: 'serie' }] }
    : String(url).includes('series-one') ? { ok: true, episodes: [{ id: 'one', number: 1 }] }
    : { ok: true, episodes: [{ id: 'two', number: 1 }], seasons: [{ id: 'series-one', number: 1 }, { id: 'series-two', number: 2 }] } });
  const legacy = { id: 'two', title: 'Show T2 - T1:E1 Episode', position_seconds: 195 };
  await app.promptOrPlayVod(legacy);
  assert.equal(app.getVodProgress('series-two').time, 195);
  assert.equal(app.getVodProgress('series-two').seasonNum, 2);
  await app.promptOrPlayVod(legacy); // Cached metadata must retain the canonical series ID.
  assert.match(node('resume-modal-time').textContent, /03:15/);

  // Resume, seek, audio switching and subtitle rendering share content time.
  context.fetch = async url => ({ ok: true, json: async () => String(url).includes('switch_audio')
    ? { ok: true, streamUrl: 'http://127.0.0.1:9000/hls/def/stream.m3u8' } : {} });
  await app.autoResolveAndPlayVod(item, null, 180, { streamUrl: 'http://127.0.0.1:9000/hls/abc/stream.m3u8',
    relayUrl: 'http://127.0.0.1:9000/hls/abc/stream.m3u8', relayAudioSwitch: true, duration: 1200 });
  node('vod-video').currentTime = 5;
  assert.equal(app.getVodEffectiveCurrentTime(), 185);
  await app.seekVodTo(360);
  node('vod-video').currentTime = 2;
  assert.equal(app.getVodEffectiveCurrentTime(), 362, 'seeking after a relay restart must not double the offset');
  let finishSpanish;
  context.fetch = url => String(url).includes(encodeURIComponent('https://sub.invalid/es'))
    ? new Promise(resolve => { finishSpanish = resolve; })
    : Promise.resolve({ ok: true, text: async () => 'WEBVTT\n\n00:06:01.000 --> 00:06:03.000\nEnglish' });
  await app.loadSubtitlesForPlayer(null, null, null, 'movie', { subtitles: [
    { url: 'https://sub.invalid/es', lang: 'es' }, { url: 'https://sub.invalid/en', lang: 'en' }
  ] });
  node('vod-subs-menu').children.at(-1).onclick({ stopPropagation() {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  finishSpanish({ ok: true, text: async () => 'WEBVTT\n\n00:06:01.000 --> 00:06:03.000\nEspañol' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.state.activeSubtitleCues[0].text, 'English', 'late subtitle downloads must not override the chosen language');
  app.state.activeSubtitleCues = [{ start: 361, end: 363, text: 'Texto sincronizado' }];
  app.updateActiveSubtitleCue();
  assert.equal(node('vod-custom-subtitles').innerHTML, 'Texto sincronizado');
  app.closeVodPlayer(false);
  assert.equal(app.getVodProgress(item.id).time, 362);
  await app.promptOrPlayVod(item);
  assert.equal(node('vod-resume-modal').classList.contains('open'), true);
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.spinner\s*\{[^}]*animation:\s*spinCatalogIcon/);
  assert.match(css, /@keyframes spinCatalogIcon/);
  console.log('VOD checks passed: selection, fallback, persistent error, cancellation and animation.');
} finally {
  app.closeVodPlayer(false);
  clearTimeout(app.state.vodOsdHideTimeout);
  clearTimeout(node('toast-notification')._timeout);
}

// Exercise the shipping proxy and relay with seven-minute video and two audio tracks.
const run = promisify(execFile);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'swordtv-playback-check-'));
const ffmpeg = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg';
let child;
let upstream;
try {
  for (const [name, encoder] of [['h264', 'libx264'], ['hevc', 'hevc_videotoolbox']]) {
    await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
      '-t', '12', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', encoder, '-pix_fmt', 'yuv420p', '-g', '36',
      '-c:a', 'aac', '-metadata:s:a:0', 'language=por', '-metadata:s:a:1', 'language=spa', path.join(temp, `${name}-short.mkv`)]);
    await run(ffmpeg, ['-y', '-v', 'error', '-stream_loop', '34', '-i', path.join(temp, `${name}-short.mkv`), '-t', '420', '-map', '0', '-c', 'copy', path.join(temp, `${name}.mkv`)]);
  }
  upstream = http.createServer((req, res) => {
    const file = path.join(temp, req.url === '/hevc' ? 'hevc.mkv' : 'h264.mkv');
    const size = fs.statSync(file).size;
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/x-matroska', 'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    fs.createReadStream(file, { start, end }).pipe(res);
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const relayPath = new URL('../stremio_engine/ffmpeg-relay.js', import.meta.url).pathname;
  const proxyPath = new URL('../stremio_engine/proxy.js', import.meta.url).pathname;
  child = spawn(process.execPath, ['-e', `
    const relay = require(${JSON.stringify(relayPath)}), proxy = require(${JSON.stringify(proxyPath)});
    proxy.start(() => relay.start(() => process.send({ ready: true })));
    process.on('message', m => {
      if (m.op === 'register') {
        const token = proxy.add(m.url, {}, 420);
        process.send({ url: relay.register({ url: proxy.baseUrl() + '/media/' + token + '/video.mkv' }, { isLive: false, hevc: m.hevc }) });
      } else if (m.op === 'probe') relay.probeAudio(m.url, {}, (err, audio, metadata) => process.send({ audio, metadata }));
      else process.send({ url: relay.switchAudio(1, 360, m.url) });
    });
    process.on('SIGTERM', () => { relay.stop(); process.exit(); });
  `], { env: { ...process.env, SWORDTV_LOG_FILE: path.join(temp, 'relay.log') }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let engineLog = '';
  child.stderr.on('data', chunk => { engineLog = (engineLog + chunk).slice(-4000); });
  await once(child, 'message');
  const request = async message => { child.send(message); return (await once(child, 'message'))[0]; };
  const completePlaylist = async url => {
    for (let attempt = 0; attempt < 240; attempt++) {
      const response = await fetch(url);
      assert.equal(response.status, 200, engineLog);
      const text = await response.text();
      if (text.includes('#EXT-X-ENDLIST')) return text;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Relay did not complete: ' + engineLog);
  };
  for (const codec of ['h264', 'hevc']) {
    const source = `http://127.0.0.1:${upstream.address().port}/${codec}`;
    const probe = await request({ op: 'probe', url: source });
    assert.ok(probe.metadata.duration >= 420);
    assert.deepEqual(probe.audio.map(track => track.language), ['por', 'spa']);
    const { url } = await request({ op: 'register', url: source, hevc: codec === 'hevc' });
    const playlist = await completePlaylist(url);
    const partial = await fetch(new URL('init.mp4', url), { headers: { Range: 'bytes=0-15' } });
    assert.equal(partial.status, 206);
    assert.equal((await partial.arrayBuffer()).byteLength, 16);
    assert.match(playlist, /#EXT-X-PLAYLIST-TYPE:EVENT/);
    const decoded = await run(ffmpeg, ['-v', 'error', '-i', url, '-map', '0:v', '-f', 'null', '-', '-progress', 'pipe:1']);

    assert.equal(decoded.stderr, '', 'seven minutes must decode without video errors');
    assert.ok(Number([...decoded.stdout.matchAll(/out_time_us=(\d+)/g)].at(-1)[1]) >= 419000000);
    const { url: switched } = await request({ op: 'switch', url });
    assert.notEqual(switched, url);
    await completePlaylist(switched);
    const audio = await run(ffmpeg, ['-v', 'error', '-i', switched, '-t', '1', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { encoding: 'buffer' });
    assert.ok(audio.stdout.length >= 90000, 'audio must start alongside the video after seeking');
    const energy = frequency => {
      let real = 0, imaginary = 0;
      for (let i = 0; i < audio.stdout.length / 2; i++) {
        const sample = audio.stdout.readInt16LE(i * 2);
        const phase = 2 * Math.PI * frequency * i / 48000;
        real += sample * Math.cos(phase); imaginary += sample * Math.sin(phase);
      }
      return real * real + imaginary * imaginary;
    };
    assert.ok(energy(880) > energy(440) * 10, 'audio must actually switch to the 880 Hz track');
    const seekVideo = await run(ffmpeg, ['-v', 'error', '-i', switched, '-map', '0:v', '-f', 'null', '-', '-progress', 'pipe:1']);
    assert.equal(seekVideo.stderr, '');
    assert.ok(Number([...seekVideo.stdout.matchAll(/out_time_us=(\d+)/g)].at(-1)[1]) >= 59000000);
  }
  child.kill(); await once(child, 'exit');
  child = spawn(process.execPath, [new URL('../stremio_engine/engine_server.js', import.meta.url).pathname], {
    env: { ...process.env, SWORDTV_PORT: '0', SWORDTV_ENGINE_URL: `http://127.0.0.1:${upstream.address().port}`,
      SWORDTV_LOG_FILE: path.join(temp, 'api.log') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API did not start')), 10000);
    child.stdout.on('data', data => {
      const match = String(data).match(/HTTP API server listening on (http:\/\/127.0.0.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const hash = 'a'.repeat(40);
  const metadata = await (await fetch(`${origin}/probe/${hash}/0`)).json();
  assert.equal(metadata.videoCodec, 'h264');
  assert.deepEqual(metadata.audioTracks.map(track => track.index), [0, 1]);
  const response = await fetch(`${origin}/hls/${hash}/0/stream.m3u8?audio=1&t=360`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /#EXTINF/);
  const direct = await run(ffmpeg, ['-v', 'error', '-i', response.url, '-t', '2', '-f', 'null', '-']);
  assert.equal(direct.stderr, '');
  assert.equal((await fetch(`${origin}/api/vod/abort`)).status, 200);
  console.log('Engine checks passed: 7-minute H.264/HEVC decode, actual audio switch, seek at minute 6 and alternate-source API.');
} finally {
  if (child) { child.kill(); await once(child, 'exit'); }
  if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
  fs.rmSync(temp, { recursive: true, force: true });
}
