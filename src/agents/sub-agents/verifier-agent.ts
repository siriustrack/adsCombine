import { SupabaseService } from '../services/supabase-service';
import type { StudyPlanData, AgentResponse } from '../types/types';
import { logError, logInfo } from '../utils/logger';

export async function verifyAndFinalize(planId: string, originalData: StudyPlanData): Promise<AgentResponse<boolean>> {
  // Validações de Input
  if (!planId || typeof planId !== 'string') {
    return { success: false, error: 'planId inválido' };
  }
  if (!originalData || !originalData.exams || !originalData.disciplines) {
    return { success: false, error: 'Dados originais inválidos' };
  }

  logInfo('verifier-agent', 'unknown', 'Iniciando verificação', { planId });

  try {
    // Buscar dados criados no banco
    const exams = await SupabaseService.getExams(planId, 'unknown');
    const disciplines = await SupabaseService.getDisciplinesWithTopics(planId, 'unknown');

    // Comparar com original (simplificado: contar itens)
    const originalExamCount = originalData.exams.length;
    const originalDisciplineCount = originalData.disciplines.length;
    const originalTopicCount = originalData.disciplines.reduce((sum, d) => sum + d.topics.length, 0);

    if (exams.length !== originalExamCount || disciplines.length !== originalDisciplineCount) {
      logError('verifier-agent', 'unknown', new Error('Contagem não corresponde'), {
        planId,
        originalExamCount,
        dbExamCount: exams.length,
        originalDisciplineCount,
        dbDisciplineCount: disciplines.length
      });
      return { success: false, error: 'Contagem de exames ou disciplinas não corresponde' };
    }

    const dbTopicCount = disciplines.reduce((sum, d) => sum + (d.topics?.length || 0), 0);
    if (dbTopicCount !== originalTopicCount) {
      logError('verifier-agent', 'unknown', new Error('Contagem de tópicos não corresponde'), {
        planId,
        originalTopicCount,
        dbTopicCount
      });
      return { success: false, error: 'Contagem de tópicos não corresponde' };
    }

    // Se tudo ok, atualizar status para 'ready'
    await SupabaseService.updateStudyPlanStatus(planId, 'ready', 'unknown');

    logInfo('verifier-agent', 'unknown', 'Verificação concluída com sucesso', { planId });
    return { success: true, data: true };
  } catch (error) {
    logError('verifier-agent', 'unknown', error, { planId, originalData });
    return { success: false, error: `Erro no verificador: ${(error as Error).message}` };
  }
}