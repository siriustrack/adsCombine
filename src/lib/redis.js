
const Redis = require('ioredis');
const logger = require('./logger');

if (!process.env.REDIS_URL) {
  logger.warn('REDIS_URL not found in .env, Redis client will not be created.');
  module.exports = null;
} else {
  const redis = new Redis(process.env.REDIS_URL, {
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redis.on('connect', () => {
    logger.info('Successfully connected to Redis');
  });

  redis.on('error', (err) => {
    logger.error('Redis connection error', { error: err.message });
  });

  module.exports = redis;
}
