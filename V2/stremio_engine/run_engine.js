const path = require('path');
const fs = require('fs');

process.env.APP_PATH = __dirname;
process.env.FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
process.env.FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';

const cacheDir = path.join(__dirname, 'stremio-cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

require('./server.js');
