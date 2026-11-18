/**
 * SwordTV Activity & Debug Logger
 * Records UI and engine actions persistently to swordtv_debug.log during development.
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = process.env.SWORDTV_LOG_FILE || '/Users/rleon/Documents/SwordTV/swordtv_debug.log';

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function getTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function log(category, action, details) {
  const ts = getTimestamp();
  let detailsText = '';
  if (details !== undefined && details !== null) {
    if (typeof details === 'object') {
      try {
        detailsText = JSON.stringify(details);
      } catch (_) {
        detailsText = String(details);
      }
    } else {
      detailsText = String(details);
    }
  }

  const line = `[${ts}] [${String(category || 'INFO').toUpperCase()}] ${action}${detailsText ? ' | ' + detailsText : ''}\n`;

  // Output to stdout/stderr
  console.log(`[ACTIVITY] [${category}] ${action}`, detailsText ? detailsText : '');

  // Append to swordtv_debug.log
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (err) {
    // If permission or path issue, ignore
  }
}

module.exports = {
  log,
  LOG_FILE
};

