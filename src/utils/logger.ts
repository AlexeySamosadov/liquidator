import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { LogLevel } from '../types';

const envLogLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
const logToFile = (process.env.LOG_TO_FILE || 'true').toLowerCase() === 'true';

// BigInt serialization helper
const bigIntReplacer = (_key: string, value: any) => {
  if (typeof value === 'bigint') {
    return value.toString() + 'n';
  }
  return value;
};

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta, bigIntReplacer)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaString}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
);

const transports: winston.transport[] = [
  new winston.transports.Console({ level: envLogLevel, format: consoleFormat }),
];

if (logToFile) {
  const mkRotate = (level: string) =>
    new DailyRotateFile({
      level,
      dirname: 'logs',
      filename: `%DATE%-${level}.log`,
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '20m',
      zippedArchive: false,
      format: fileFormat,
    });

  transports.push(mkRotate('error')); // errors only
  transports.push(mkRotate('warn'));
  transports.push(mkRotate('info'));
}

export const logger = winston.createLogger({
  level: envLogLevel,
  transports,
});

export const logBotStart = (config: unknown): void => {
  logger.info('Bot started with config', { config });
};

export const logPositionFound = (payload: unknown): void => {
  logger.info('Position found', payload as Record<string, unknown>);
};

export const logLiquidationAttempt = (payload: unknown): void => {
  logger.info('Liquidation attempt', payload as Record<string, unknown>);
};

export const logLiquidationSuccess = (payload: unknown): void => {
  logger.info('Liquidation successful', payload as Record<string, unknown>);
};

export const logLiquidationFailure = (payload: unknown): void => {
  logger.error('Liquidation failed', payload as Record<string, unknown>);
};
