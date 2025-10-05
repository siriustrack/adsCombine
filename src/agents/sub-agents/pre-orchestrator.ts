import type { StudyPlanInput, AgentResponse, StudyPlanData } from '../types/types';
import { identifyPlans } from './identifier-agent';

export async function preOrchestrate(input: StudyPlanInput): Promise<AgentResponse<StudyPlanData[]>> {
  // Validações de Input
  if (!input.userId || typeof input.userId !== 'string' || input.userId.trim().length === 0) {
    return { success: false, error: 'userId inválido: deve ser string UUID não vazia' };
  }
  // Verificar formato UUID básico (opcional, mas recomendado)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(input.userId)) {
    return { success: false, error: 'userId deve ser um UUID válido' };
  }

  try {
    // Chamar Agente Identificador
    const identificationResult = await identifyPlans(input.content);
    if (!identificationResult.success) {
      return { success: false, error: `Erro na identificação: ${identificationResult.error}` };
    }

    // Retornar dados para o próximo passo (Orquestrador)
    return { success: true, data: identificationResult.data };
  } catch (error) {
    return { success: false, error: `Erro no pre-orquestrador: ${(error as Error).message}` };
  }
}