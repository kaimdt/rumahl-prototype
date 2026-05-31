'use strict';

/** Minimal structured logger. Backend logs are always English (per IORA rules). */

function ts() {
  return new Date().toISOString();
}

function emit(level, msg, meta) {
  const base = `[${ts()}] [${level}] ${msg}`;
  if (meta !== undefined) {
    try {
      console.log(`${base} ${JSON.stringify(meta)}`);
    } catch {
      console.log(base, meta);
    }
  } else {
    console.log(base);
  }
}

module.exports = {
  info: (msg, meta) => emit('INFO', msg, meta),
  warn: (msg, meta) => emit('WARN', msg, meta),
  error: (msg, meta) => emit('ERROR', msg, meta),
  debug: (msg, meta) => {
    if (process.env.DEBUG) emit('DEBUG', msg, meta);
  },
};
