import winston from 'winston'

const isProduction = process.env.NODE_ENV === 'production'
const configuredLogLevel = ['error', 'warn', 'info', 'debug'].includes(process.env.LOG_LEVEL ?? '')
  ? process.env.LOG_LEVEL
  : undefined

const consoleFormat = isProduction
  ? winston.format.combine(winston.format.timestamp(), winston.format.json())
  : winston.format.combine(winston.format.colorize(), winston.format.simple())

const logger = winston.createLogger({
  level: configuredLogLevel ?? (isProduction ? 'info' : 'debug'),
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
})

export default logger
