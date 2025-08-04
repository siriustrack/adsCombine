import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';

export interface SystemDiagnostics {
  cpu: {
    count: number;
    model: string;
    speed: number;
    loadAverage: number[];
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  disk: {
    tmpSpace?: string;
    tmpUsage?: string;
  };
  software: {
    nodeVersion: string;
    platform: string;
    arch: string;
    tesseractVersion?: string;
    poppler?: boolean;
    sharp?: boolean;
  };
  containerization: {
    isDocker: boolean;
    isKubernetes: boolean;
    memoryLimit?: number;
    cpuLimit?: number;
  };
}

export function getSystemDiagnostics(): SystemDiagnostics {
  const cpuInfo = cpus();
  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = totalMem - freeMem;

  const diagnostics: SystemDiagnostics = {
    cpu: {
      count: cpuInfo.length,
      model: cpuInfo[0]?.model || 'Unknown',
      speed: cpuInfo[0]?.speed || 0,
      loadAverage: loadavg(),
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usagePercent: (usedMem / totalMem) * 100,
    },
    disk: {},
    software: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    containerization: {
      isDocker: false,
      isKubernetes: false,
    },
  };

  // Check for containerization
  try {
    if (fs.existsSync('/.dockerenv')) {
      diagnostics.containerization.isDocker = true;
    }

    if (process.env.KUBERNETES_SERVICE_HOST) {
      diagnostics.containerization.isKubernetes = true;
    }

    // Check for memory limits in Docker/K8s
    if (fs.existsSync('/sys/fs/cgroup/memory/memory.limit_in_bytes')) {
      const memLimit = parseInt(
        fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8')
      );
      if (memLimit < totalMem) {
        diagnostics.containerization.memoryLimit = memLimit;
      }
    }

    // Check for CPU limits in Docker/K8s
    if (
      fs.existsSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us') &&
      fs.existsSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
    ) {
      const quota = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'));
      const period = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'));
      if (quota > 0 && period > 0) {
        diagnostics.containerization.cpuLimit = quota / period;
      }
    }
  } catch {
    // Ignore errors in containerization detection
  }

  // Check software dependencies
  try {
    const tesseractVersion = execSync('tesseract --version', { encoding: 'utf8', timeout: 5000 });
    diagnostics.software.tesseractVersion = tesseractVersion.split('\n')[0];
  } catch {
    diagnostics.software.tesseractVersion = 'Not installed or not accessible';
  }

  try {
    execSync('pdftoppm -h', { timeout: 5000 });
    diagnostics.software.poppler = true;
  } catch {
    diagnostics.software.poppler = false;
  }

  try {
    require('sharp');
    diagnostics.software.sharp = true;
  } catch {
    diagnostics.software.sharp = false;
  }

  // Check disk space for temp directory
  try {
    const tmpDir = require('os').tmpdir();
    const diskUsage = execSync(`df -h "${tmpDir}"`, { encoding: 'utf8', timeout: 5000 });
    const lines = diskUsage.split('\n');
    if (lines.length > 1) {
      const usage = lines[1].split(/\s+/);
      diagnostics.disk.tmpSpace = usage[1]; // Available space
      diagnostics.disk.tmpUsage = usage[4]; // Usage percentage
    }
  } catch {
    // Ignore disk space check errors
  }

  return diagnostics;
}

export function logSystemDiagnostics(
  logger: { info: (message: string, data: unknown) => void },
  context: string = 'System Diagnostics'
) {
  const diagnostics = getSystemDiagnostics();

  logger.info(context, {
    cpu: diagnostics.cpu,
    memory: {
      totalGB: Math.round((diagnostics.memory.total / (1024 * 1024 * 1024)) * 100) / 100,
      freeGB: Math.round((diagnostics.memory.free / (1024 * 1024 * 1024)) * 100) / 100,
      usagePercent: Math.round(diagnostics.memory.usagePercent * 100) / 100,
    },
    software: diagnostics.software,
    containerization: diagnostics.containerization,
    disk: diagnostics.disk,
    warnings: generateWarnings(diagnostics),
  });
}

function generateWarnings(diagnostics: SystemDiagnostics): string[] {
  const warnings: string[] = [];

  if (diagnostics.memory.usagePercent > 90) {
    warnings.push('High memory usage detected (>90%)');
  }

  if (diagnostics.cpu.loadAverage[0] > diagnostics.cpu.count) {
    warnings.push('High CPU load detected');
  }

  if (diagnostics.containerization.isDocker || diagnostics.containerization.isKubernetes) {
    warnings.push('Running in containerized environment - performance may be limited');

    if (diagnostics.containerization.memoryLimit) {
      const limitGB = diagnostics.containerization.memoryLimit / (1024 * 1024 * 1024);
      warnings.push(`Memory limited to ${Math.round(limitGB * 100) / 100}GB by container`);
    }

    if (
      diagnostics.containerization.cpuLimit &&
      diagnostics.containerization.cpuLimit < diagnostics.cpu.count
    ) {
      warnings.push(`CPU limited to ${diagnostics.containerization.cpuLimit} cores by container`);
    }
  }

  if (
    !diagnostics.software.tesseractVersion ||
    diagnostics.software.tesseractVersion.includes('Not installed')
  ) {
    warnings.push('Tesseract OCR not available or not properly installed');
  }

  if (!diagnostics.software.poppler) {
    warnings.push('Poppler utils (pdftoppm) not available');
  }

  if (diagnostics.disk.tmpUsage && parseInt(diagnostics.disk.tmpUsage.replace('%', '')) > 90) {
    warnings.push('Low disk space in temp directory');
  }

  return warnings;
}
