import pino from 'pino';
import { randomUUID } from 'crypto';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l' }
    }
  }),
  redact: {
    paths: ['req.headers.authorization', 'body.password', 'body.refreshToken'],
    censor: '[REDACTED]'
  }
});

export function addRequestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

export function requestLogger(req, res, next) {
  req.log = logger.child({ requestId: req.id });
  const start = Date.now();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level]({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start
    }, 'request completed');
  });
  next();
}

export default logger;
