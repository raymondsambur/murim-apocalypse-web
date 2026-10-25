/**
 * Tiny leveled logger. Plain text lines on stdout/stderr; no dependencies.
 * Every module gets a scoped child: `log.child('aoi').warn('...')`.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 100 };

export const LOG_LEVELS = Object.keys(ORDER) as LogLevel[];

export interface Logger {
  readonly level: LogLevel;
  trace(msg: string, data?: unknown): void;
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  /** Same sink and level, with an extra scope label. */
  child(scope: string): Logger;
}

export interface LogSink {
  out(line: string): void;
  err(line: string): void;
}

const consoleSink: LogSink = {
  out: (line) => process.stdout.write(line + '\n'),
  err: (line) => process.stderr.write(line + '\n'),
};

function fmtData(data: unknown): string {
  if (data === undefined) return '';
  if (data instanceof Error) return ' ' + (data.stack ?? `${data.name}: ${data.message}`);
  if (typeof data === 'string') return ' ' + data;
  try {
    return (
      ' ' +
      JSON.stringify(data, (_k, v: unknown) => {
        if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
        if (typeof v === 'bigint') return v.toString();
        return v;
      })
    );
  } catch {
    return ' [unserializable]';
  }
}

export function createLogger(level: LogLevel = 'info', scope = 'server', sink: LogSink = consoleSink): Logger {
  const min = ORDER[level];
  const write = (lv: Exclude<LogLevel, 'silent'>, msg: string, data?: unknown) => {
    if (ORDER[lv] < min) return;
    const line = `${new Date().toISOString()} ${lv.toUpperCase().padEnd(5)} [${scope}] ${msg}${fmtData(data)}`;
    if (ORDER[lv] >= ORDER.warn) sink.err(line);
    else sink.out(line);
  };
  return {
    level,
    trace: (m, d) => write('trace', m, d),
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: (s) => createLogger(level, `${scope}:${s}`, sink),
  };
}

/** A logger that drops everything (tests). */
export const nullLogger: Logger = createLogger('silent');
