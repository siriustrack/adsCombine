import fs from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import Piscina from 'piscina'
import logger from './logger'
import { calculateWorkerCount, parseCgroupV2CpuQuota } from './worker-count'

function getOptimalWorkerCount(): { maxWorkers: number; minWorkers: number } {
  const isDocker = fs.existsSync('/.dockerenv')
  const isKubernetes = !!process.env.KUBERNETES_SERVICE_HOST
  let cpuQuota: number | undefined

  try {
    if (fs.existsSync('/sys/fs/cgroup/cpu.max')) {
      cpuQuota = parseCgroupV2CpuQuota(fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8'))
    } else if (
      fs.existsSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us') &&
      fs.existsSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
    ) {
      const quota = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'), 10)
      const period = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'), 10)
      if (quota > 0 && period > 0) {
        cpuQuota = quota / period
      }
    }
  } catch {
    logger.warn('Error reading CPU limits from cgroup:', {
      message: 'Failed to read CPU limits from cgroup files',
    })
  }

  const configuredWorkers = process.env.PDF_MAX_WORKERS
    ? parseInt(process.env.PDF_MAX_WORKERS, 10)
    : undefined
  const maxWorkers = calculateWorkerCount({
    availableCpus: availableParallelism(),
    isContainer: isDocker || isKubernetes,
    ...(cpuQuota === undefined ? {} : { cpuQuota }),
    ...(configuredWorkers === undefined ? {} : { configuredWorkers }),
  })

  return { maxWorkers, minWorkers: maxWorkers }
}

function getWorkerFilePath(): string {
  const workerPath = path.resolve(__dirname, '../core/services/messages/pdfChunkWorker.js')

  if (fs.existsSync(workerPath)) {
    return workerPath
  }

  throw new Error(`Worker file not found: ${workerPath}`)
}

const { maxWorkers, minWorkers } = getOptimalWorkerCount()
const workerFilePath = getWorkerFilePath()

export const pdfWorkerPool = new Piscina({
  filename: workerFilePath,
  maxThreads: maxWorkers,
  minThreads: minWorkers,
  idleTimeout: 300000,
  maxQueue: 1000,
  concurrentTasksPerWorker: 1,
})

export { maxWorkers, minWorkers }
