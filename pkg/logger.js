import pino from 'pino';
import config from '../config/index.js';

const transport = config.log.prettyPrint
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
  : undefined;

const logger = pino({
  level: config.log.level,
  transport,
  base: { service: '10minutemail' },
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.ip,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.secret'],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
