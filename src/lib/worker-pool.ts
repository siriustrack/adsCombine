import path from 'node:path';
import Piscina from 'piscina';

export const pdfWorkerPool = new Piscina({
  filename: path.resolve(__dirname, '../core/services/messages/pdfChunkWorker.js')
});