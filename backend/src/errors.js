import logger from './logger.js';

export class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

export function tryCatch(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err, req, res, _next) {
  if (err.isOperational) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  const log = req.log || logger;
  log.error({ err, requestId: req.id }, 'Error inesperado');
  return res.status(500).json({ error: 'Error interno del servidor.' });
}
