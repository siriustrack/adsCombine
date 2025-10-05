import { logError, logInfo, logWarning } from './logger';

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number; // em ms
  agentId: string;
  userId: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, baseDelay, agentId, userId } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logInfo(agentId, userId, `Tentativa ${attempt}/${maxAttempts}`, { attempt });
      const result = await fn();
      if (attempt > 1) {
        logInfo(agentId, userId, `Sucesso após ${attempt} tentativas`);
      }
      return result;
    } catch (error) {
      logWarning(agentId, userId, `Tentativa ${attempt} falhou: ${(error as Error).message}`, { attempt });

      if (attempt === maxAttempts) {
        logError(agentId, userId, error, { attempt, maxAttempts });
        throw error;
      }

      // Backoff exponencial: baseDelay * 2^(attempt-1)
      const delay = baseDelay * 2 ** (attempt - 1);
      logInfo(agentId, userId, `Aguardando ${delay}ms antes da próxima tentativa`, { delay });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Retry logic failed unexpectedly');
}