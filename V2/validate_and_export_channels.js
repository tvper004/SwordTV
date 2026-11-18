/**
 * Script para validar canales IPTV en vivo concurrentemente
 * y generar la lista M3U / M4U de canales sintonizables para WebOS IPTV Player.
 */

import fs from 'fs';
import path from 'path';
import { CHANNELS } from './src/data.js';

const TIMEOUT_MS = 3200;
const CONCURRENCY = 60;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

async function checkChannel(channel) {
  if (!channel.streamUrl || !channel.streamUrl.startsWith('http')) {
    return { ok: false, reason: 'invalid_url' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(channel.streamUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Range': 'bytes=0-1024'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.status >= 200 && res.status < 400) {
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err.name || 'network_error' };
  }
}

async function run() {
  console.log(`Iniciando validación de ${CHANNELS.length} canales con concurrencia ${CONCURRENCY}...`);
  const activeChannels = [];
  const deadChannels = [];
  let processed = 0;

  for (let i = 0; i < CHANNELS.length; i += CONCURRENCY) {
    const chunk = CHANNELS.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (c) => {
      const res = await checkChannel(c);
      return { channel: c, ...res };
    }));

    for (const r of results) {
      processed++;
      if (r.ok) {
        activeChannels.push(r.channel);
      } else {
        deadChannels.push({ id: r.channel.id, name: r.channel.name, reason: r.reason });
      }
    }

    if (processed % 300 === 0 || processed === CHANNELS.length) {
      console.log(`Progreso: ${processed}/${CHANNELS.length} canales analizados. Sintonizando OK: ${activeChannels.length}`);
    }
  }

  console.log(`\nValidación completada:`);
  console.log(`Total analizados: ${CHANNELS.length}`);
  console.log(`Canales que sintonizan perfectamente: ${activeChannels.length}`);
  console.log(`Canales descartados / sin señal: ${deadChannels.length}`);

  // Generar formato M3U estándar compatible con WebOS IPTV Player (SS IPTV, Smart IPTV, Nanomid, etc.)
  let m3uContent = '#EXTM3U x-tvg-url="https://iptv-org.github.io/epg/guides/pe.xml,https://iptv-org.github.io/epg/guides/es.xml"\n';
  
  for (const c of activeChannels) {
    const tvgId = c.id || '';
    const tvgName = (c.name || '').replace(/"/g, "'");
    const tvgLogo = (c.logo && !c.logo.startsWith('assets/')) ? c.logo : 'https://raw.githubusercontent.com/iptv-org/iptv/master/images/logo.png';
    const group = (c.subcat || c.country || 'General').toUpperCase();
    
    m3uContent += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${tvgName}" tvg-logo="${tvgLogo}" group-title="${group}",${c.name}\n`;
    m3uContent += `${c.streamUrl}\n`;
  }

  const outPathM4u = '/Users/rleon/Documents/ListaActual.m4u';
  const outPathM3u = '/Users/rleon/Documents/ListaActual.m3u';

  fs.writeFileSync(outPathM4u, m3uContent, 'utf8');
  fs.writeFileSync(outPathM3u, m3uContent, 'utf8');

  // Guardar también JSON de canales verificados para uso dentro de la app
  fs.writeFileSync('./src/validated_channels.json', JSON.stringify(activeChannels.map(c => c.id), null, 2), 'utf8');

  console.log(`\nLista guardada exitosamente en:\n -> ${outPathM4u}\n -> ${outPathM3u}`);
}

run().catch(console.error);

