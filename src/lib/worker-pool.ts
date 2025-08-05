import fs from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import Piscina from 'piscina';
import logger from './logger';

function getOptimalWorkerCount(): { maxWorkers: number; minWorkers: number } {
  const totalCpus = cpus().length;
  let maxWorkers = Math.floor(totalCpus / 2);
  let minWorkers = maxWorkers;

  const isDocker = fs.existsSync('/.dockerenv');
  const isKubernetes = !!process.env.KUBERNETES_SERVICE_HOST;

  if (isDocker || isKubernetes) {
    maxWorkers = Math.max(1, Math.floor(totalCpus / 3));
    minWorkers = maxWorkers;

    try {
      if (
        fs.existsSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us') &&
        fs.existsSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
      ) {
        const quota = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'));
        const period = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'));
        if (quota > 0 && period > 0) {
          const cpuLimit = quota / period;
          maxWorkers = Math.max(1, Math.floor(cpuLimit / 2));
          minWorkers = maxWorkers;
        }
      }
    } catch {
      logger.warn('Error reading CPU limits from cgroup:', {
        message: 'Failed to read CPU limits from cgroup files',
      });
    }
  }

  if (process.env.PDF_MAX_WORKERS) {
    const envMaxWorkers = parseInt(process.env.PDF_MAX_WORKERS);
    if (envMaxWorkers > 0) {
      maxWorkers = envMaxWorkers;
      minWorkers = maxWorkers;
    }
  }

  return { maxWorkers, minWorkers };
}

function getWorkerFilePath(): string {
  const workerPath = path.resolve(__dirname, '../core/services/messages/pdfChunkWorker.js');

  if (fs.existsSync(workerPath)) {
    return workerPath;
  }

  throw new Error(`Worker file not found: ${workerPath}`);
}

const { maxWorkers, minWorkers } = getOptimalWorkerCount();
const workerFilePath = getWorkerFilePath();

export const pdfWorkerPool = new Piscina({
  filename: workerFilePath,
  maxThreads: maxWorkers,
  minThreads: maxWorkers,
  idleTimeout: 300000,
  maxQueue: 1000,
  concurrentTasksPerWorker: 1,
});

export { maxWorkers, minWorkers };
