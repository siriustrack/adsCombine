import type { StudyPlanInput, AgentResponse, StudyPlanData } from '../types/types';
import { identifyPlans } from './identifier-agent';
import type { EditalProcessado } from '../../core/services/editais/edital-schema';

/**
 * Converte EditalProcessado (formato edital-process) para StudyPlanData[] (formato orchestrator)
 */
function convertEditalToStudyPlans(edital: EditalProcessado): StudyPlanData[] {
  return edital.concursos.map(concurso => {
    // Mapear fases para exams
    const exams = concurso.fases?.map(fase => ({
      examType: fase.tipo as 'objetiva' | 'discursiva' | 'prática' | 'oral',
      examDate: fase.data || 'a divulgar',
      examTurn: fase.turno === 'nao_especificado' ? 'manha' : fase.turno as 'manha' | 'tarde' | 'noite',
      totalQuestions: fase.totalQuestoes || 0
    })) || [];

    // Mapear disciplinas + matérias para disciplines with topics
    const disciplines = concurso.disciplinas.map(disc => ({
      name: disc.nome,
      numberOfQuestions: disc.numeroQuestoes || undefined,
      topics: disc.materias.map(mat => ({
        name: mat.nome,
        weight: 1.0 as 1.0 | 1.5 | 2.0
      }))
    }));

    return {
      metadata: {
        examName: concurso.metadata.examName,
        examOrg: concurso.metadata.examOrg,
        startDate: concurso.metadata.startDate || new Date().toISOString().split('T')[0],
        notes: concurso.metadata.notes || undefined
      },
      exams,
      disciplines
    };
  });
}

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
    // ✅ NOVO: Detectar se content é JSON estruturado ou texto bruto
    if (typeof input.content === 'object' && input.content !== null) {
      // Verificar se tem estrutura de EditalProcessado
      if ('concursos' in input.content && Array.isArray(input.content.concursos)) {
        console.log('[PRE-ORCHESTRATOR] 📦 Received structured JSON, converting to StudyPlanData[]');
        const studyPlans = convertEditalToStudyPlans(input.content as any);
        return { success: true, data: studyPlans };
      }
    }

    // LEGADO: Content é texto bruto, usar identifier-agent
    console.log('[PRE-ORCHESTRATOR] 📝 Received text content, using identifier-agent');
    const identificationResult = await identifyPlans(input.content as string);
    if (!identificationResult.success) {
      return { success: false, error: `Erro na identificação: ${identificationResult.error}` };
    }

    // Retornar dados para o próximo passo (Orquestrador)
    return { success: true, data: identificationResult.data };
  } catch (error) {
    return { success: false, error: `Erro no pre-orquestrador: ${(error as Error).message}` };
  }
}
