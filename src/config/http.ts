import http from 'node:http';
import https from 'node:https';
import axios from 'axios';

export const httpClient = axios.create({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 10 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 10 }),
});
