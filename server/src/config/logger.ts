import { getSettings } from './env.js';

/**
 * A deliberately small logger: level filtering, a timestamp, and structured
 * context. Enough to read Render's log stream without pulling in a logging
 * framework we would only use a tenth of.
 */

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

type Context = Record<string, unknown>;

function write(level: Level, message: string, context?: Context): void {
  // Read lazily: the logger is imported by modules that load before settings parse.
  let threshold: Level = 'info';
  try {
    threshold = getSettings().LOG_LEVEL;
  } catch {
    // Settings are invalid or not parsed yet — log everything so the reason is visible.
    threshold = 'debug';
  }

  if (LEVELS.indexOf(level) < LEVELS.indexOf(threshold)) return;

  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  const target = level === 'error' || level === 'warn' ? console.error : console.log;

  if (context && Object.keys(context).length > 0) target(line, context);
  else target(line);
}

export const logger = {
  debug: (message: string, context?: Context) => write('debug', message, context),
  info: (message: string, context?: Context) => write('info', message, context),
  warn: (message: string, context?: Context) => write('warn', message, context),
  error: (message: string, context?: Context) => write('error', message, context),
};
