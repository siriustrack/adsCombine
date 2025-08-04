import fs from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import Piscina from 'piscina';

function getOptimalWorkerCount(): { maxWorkers: number; minWorkers: number } {
  const totalCpus = cpus().length;
  let maxWorkers = Math.floor(totalCpus / 2);
  let minWorkers = maxWorkers; // Force ALL workers to be created immediately

  // Check if running in containerized environment
  const isDocker = fs.existsSync('/.dockerenv');
  const isKubernetes = !!process.env.KUBERNETES_SERVICE_HOST;

  if (isDocker || isKubernetes) {
    // In containers, be more conservative with worker count
    maxWorkers = Math.max(1, Math.floor(totalCpus / 3));
    minWorkers = maxWorkers; // Still force all workers in containers

    // Check for CPU limits in containers
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
          minWorkers = maxWorkers; // Update minWorkers too
          console.log('Container CPU limit detected:', {
            cpuLimit,
            adjustedMaxWorkers: maxWorkers,
          });
        }
      }
    } catch {
      // Ignore errors reading cgroup files
    }
  }

  // Environment variable override
  if (process.env.PDF_MAX_WORKERS) {
    const envMaxWorkers = parseInt(process.env.PDF_MAX_WORKERS);
    if (envMaxWorkers > 0) {
      maxWorkers = envMaxWorkers;
      minWorkers = maxWorkers; // Keep them equal
      console.log('PDF_MAX_WORKERS environment variable override:', maxWorkers);
    }
  }

  return { maxWorkers, minWorkers };
}

function getWorkerFilePath(): string {
  const workerPath = path.resolve(__dirname, '../core/services/messages/pdfChunkWorker.js');
  
  if (fs.existsSync(workerPath)) {
    console.log('Using JavaScript worker file');
    return workerPath;
  }

  throw new Error(`Worker file not found: ${workerPath}`);
}

const { maxWorkers, minWorkers } = getOptimalWorkerCount();
const workerFilePath = getWorkerFilePath();

console.log('PDF Worker Pool Configuration:', {
  totalCpus: cpus().length,
  maxWorkers,
  minWorkers,
  workerFile: workerFilePath,
  nodeVersion: process.version,
  bunVersion: process.versions.bun,
  platform: process.platform,
  arch: process.arch,
  isDocker: fs.existsSync('/.dockerenv'),
  isKubernetes: !!process.env.KUBERNETES_SERVICE_HOST,
  memoryUsage: process.memoryUsage(),
  nodeEnv: process.env.NODE_ENV,
});

export const pdfWorkerPool = new Piscina({
  filename: workerFilePath,
  maxThreads: maxWorkers,
  minThreads: maxWorkers, // Force all workers to be created immediately
  idleTimeout: 300000, // Keep workers alive longer (5 minutes)
  maxQueue: 0, // No queue - force parallel execution
});

console.log('Piscina Pool Created:', {
  maxThreads: pdfWorkerPool.options.maxThreads,
  minThreads: pdfWorkerPool.options.minThreads,
  filename: pdfWorkerPool.options.filename,
  concurrentTasksPerWorker: pdfWorkerPool.options.concurrentTasksPerWorker,
});

// Log worker pool events for debugging
pdfWorkerPool.on('worker', (worker) => {
  console.log(`PDF Worker spawned: PID ${worker.threadId}`);
});

pdfWorkerPool.on('workerExit', (worker) => {
  console.log(`PDF Worker exited: PID ${worker.threadId}`);
});

// Log pool utilization
pdfWorkerPool.on('drain', () => {
  console.log('Worker pool drained - all tasks completed');
});

pdfWorkerPool.on('needsDrain', () => {
  console.log('Worker pool needs drain - queue is full');
});

export { maxWorkers, minWorkers };
