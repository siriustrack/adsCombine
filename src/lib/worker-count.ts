type WorkerCountInput = {
  readonly availableCpus: number
  readonly isContainer: boolean
  readonly cpuQuota?: number
  readonly configuredWorkers?: number
}

export function parseCgroupV2CpuQuota(value: string): number | undefined {
  const [quotaText, periodText] = value.trim().split(/\s+/u)
  if (quotaText === 'max') return undefined
  const quota = Number(quotaText)
  const period = Number(periodText)
  return quota > 0 && period > 0 ? quota / period : undefined
}

export function calculateWorkerCount({
  availableCpus,
  isContainer,
  cpuQuota,
  configuredWorkers,
}: WorkerCountInput): number {
  const available = Math.max(1, Math.floor(availableCpus))
  const automatic = Math.max(1, Math.floor(available / (isContainer ? 3 : 2)))
  const requested =
    configuredWorkers !== undefined && configuredWorkers > 0
      ? Math.floor(configuredWorkers)
      : automatic
  const quotaLimit =
    cpuQuota !== undefined && cpuQuota > 0 ? Math.max(1, Math.floor(cpuQuota)) : undefined
  return quotaLimit === undefined ? requested : Math.min(requested, quotaLimit)
}
