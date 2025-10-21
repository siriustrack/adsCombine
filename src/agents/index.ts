import { preOrchestrate } from './sub-agents/pre-orchestrator';
import { orchestratePlanCreation } from './sub-agents/orchestrator-agent';
import { verifyAndFinalize } from './sub-agents/verifier-agent';
import type { StudyPlanInput, AgentResponse } from './types/types';
import { withRetry } from './utils/retry';
import { logError, logInfo } from './utils/logger';
import { retryWithFallback } from './utils/fallback-agent';

export async function createStudyPlan(input: StudyPlanInput): Promise<AgentResponse<string>> {
  logInfo('main-orchestrator', input.userId, 'Iniciando criação de plano de estudo');

  try {
    // Passo 1: Pre-orquestração e identificação com retry
    const preResult = await withRetry(
      () => preOrchestrate(input),
      { maxAttempts: 3, baseDelay: 1000, agentId: 'pre-orchestrator', userId: input.userId }
    );

    if (!preResult.success) {
      logError('main-orchestrator', input.userId, new Error(preResult.error), { step: 'pre-orchestrate' });
      return { success: false, error: preResult.error };
    }

    const plans = preResult.data!;
    if (plans.length === 0) {
      logError('main-orchestrator', input.userId, new Error('Nenhum plano identificado'), { step: 'identification' });
      return { success: false, error: 'Nenhum plano identificado' };
    }

    // Para múltiplos planos, processar um por vez (assumir 1 por enquanto)
    const planData = plans[0];
    logInfo('main-orchestrator', input.userId, 'Plano identificado', { examName: planData.metadata.examName });

    // Passo 2: Criação no banco com retry e fallback automático
    const fallbackResult = await retryWithFallback(
      async (data) => {
        const result = await withRetry(
          () => orchestratePlanCreation(input.userId, data),
          { maxAttempts: 3, baseDelay: 2000, agentId: 'orchestrator-agent', userId: input.userId }
        );
        if (!result.success) throw new Error(result.error);
        return result.data!;
      },
      planData,
      { userId: input.userId, operation: 'create' }
    );

    if (!fallbackResult.success) {
      logError('main-orchestrator', input.userId, new Error(fallbackResult.error || 'Erro desconhecido'), { step: 'creation', planData });
      return { success: false, error: fallbackResult.error };
    }

    const planId = fallbackResult.data as string;
    if (fallbackResult.fallbackApplied) {
      logInfo('main-orchestrator', input.userId, 'Plano criado com correção automática', { planId });
    } else {
      logInfo('main-orchestrator', input.userId, 'Plano criado no banco', { planId });
    }

    // Passo 3: Verificação e finalização com retry
    const verifyResult = await withRetry(
      () => verifyAndFinalize(planId, planData),
      { maxAttempts: 3, baseDelay: 1000, agentId: 'verifier-agent', userId: input.userId }
    );

    if (!verifyResult.success) {
      logError('main-orchestrator', input.userId, new Error(verifyResult.error), { step: 'verification', planId });
      // Notificação: Em produção, enviar email/log para admin
      console.error(`ALERTA: Plano ${planId} falhou na verificação para user ${input.userId}`);
      return { success: false, error: verifyResult.error };
    }

    logInfo('main-orchestrator', input.userId, 'Plano finalizado com sucesso', { planId });
    return { success: true, data: planId };
  } catch (error) {
    logError('main-orchestrator', input.userId, error, { input });
    // Notificação: Em produção, alertar usuário
    console.error(`CRÍTICO: Erro geral na criação de plano para user ${input.userId}: ${(error as Error).message}`);
    return { success: false, error: `Erro geral: ${(error as Error).message}` };
  }
}