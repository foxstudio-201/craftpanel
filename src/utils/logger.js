/* Minimal colourised logger with an in-memory ring buffer so the admin panel
   can surface recent system logs without a log-shipping stack. */
const COLORS = {
  reset: '\x1b[0m', gray: '\x1b[90m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};

const RING_MAX = 500;
const ring = [];

const stamp = () => new Date().toISOString();

function record(level, args) {
  const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  ring.push({ ts: stamp(), level: level.trim(), message });
  if (ring.length > RING_MAX) ring.shift();
}

const fmt = (color, level, args) => {
  record(level, args);
  console.log(`${COLORS.gray}${stamp()}${COLORS.reset} ${color}${level}${COLORS.reset}`, ...args);
};

export const logger = {
  info: (...a) => fmt(COLORS.cyan, 'INFO ', a),
  success: (...a) => fmt(COLORS.green, 'OK   ', a),
  warn: (...a) => fmt(COLORS.yellow, 'WARN ', a),
  error: (...a) => fmt(COLORS.red, 'ERROR', a),
  /** Recent log lines (newest last). */
  recent: (limit = 200) => ring.slice(-limit),
};

export default logger;
