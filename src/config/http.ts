import http from 'node:http';
import https from 'node:https';
import axios from 'axios';
import { redactUrl } from '../lib/redact-url';
import { PROCESSING_TIMEOUTS } from './constants';

export const httpClient = axios.create({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 10 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 10 }),
  timeout: PROCESSING_TIMEOUTS.DOWNLOAD,
});

httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.config && error.config.url) {
      error.config.url = redactUrl(error.config.url);
    }
    if (error.request && error.request.path) {
      error.request.path = redactUrl(error.request.path);
    }
    if (error.message) {
      // Regex para encontrar URLs e substituí-las
      error.message = error.message.replace(/(https?:\/\/[^\s]+)/g, (match) => redactUrl(match));
    }
    return Promise.reject(error);
  }
);
