import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'study-plan-agents' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Tipos de erro para classificação
export enum ErrorType {
  NETWORK = 'network',
  VALIDATION = 'validation',
  DATABASE = 'database',
  UNKNOWN = 'unknown'
}

export function classifyError(error: any): ErrorType {
  const message = error.message || error.toString();

  if (message.includes('timeout') || message.includes('network') || message.includes('ECONNREFUSED')) {
    return ErrorType.NETWORK;
  }
  if (message.includes('invalid') || message.includes('required') || message.includes('UUID')) {
    return ErrorType.VALIDATION;
  }
  if (message.includes('RLS') || message.includes('constraint') || message.includes('duplicate') || message.includes('foreign key')) {
    return ErrorType.DATABASE;
  }
  return ErrorType.UNKNOWN;
}

export function logError(agentId: string, userId: string, error: any, context?: any) {
  const errorType = classifyError(error);
  logger.error('Agent Error', {
    agentId,
    userId,
    errorType,
    message: error.message,
    stack: error.stack,
    context
  });
}

export function logInfo(agentId: string, userId: string, message: string, context?: any) {
  logger.info(message, { agentId, userId, context });
}

export function logWarning(agentId: string, userId: string, message: string, context?: any) {
  logger.warn(message, { agentId, userId, context });
}

export default logger;