/**
 * E2E Test Setup Helpers
 * 
 * Utilitários para configurar e limpar ambiente de testes E2E
 * Inclui gestão de database, loading de editais, e cleanup
 */

import { SupabaseService } from '../../src/agents/services/supabase-service';
import { supabase } from '../../src/config/supabase';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logInfo, logError } from '../../src/agents/utils/logger';

export interface EditalFile {
  name: string;
  path: string;
  size: number;
  content?: any;
}

/**
 * Lista de editais disponíveis para testes E2E
 */
export const AVAILABLE_EDITAIS: EditalFile[] = [
  { name: 'ENAC', path: 'edital ENAC.json', size: 58 }, // ~58KB
  { name: 'Advogado da União', path: 'edital advogado da união.json', size: 17 }, // ~17KB
  { name: 'Cartórios RS', path: 'edital concurso cartórios rs.json', size: 116 }, // ~116KB (LARGEST)
  { name: 'MPRS', path: 'edital MPRS.json', size: 48 }, // ~48KB
  { name: 'Juiz SC', path: 'edital juiz sc.json', size: 23 }, // ~23KB
  { name: 'OAB', path: 'edital oab.json', size: 23 }, // ~23KB
  { name: 'Prefeitura', path: 'edital prefeitura.json', size: 23 }, // ~23KB
];

/**
 * Carrega conteúdo de um edital JSON
 */
export function loadEditalContent(editalName: string): any {
  const edital = AVAILABLE_EDITAIS.find(e => e.name === editalName);
  if (!edital) {
    throw new Error(`Edital ${editalName} não encontrado. Disponíveis: ${AVAILABLE_EDITAIS.map(e => e.name).join(', ')}`);
  }

  const editalPath = join(__dirname, '../../temp/editais-json', edital.path);
  try {
    const content = readFileSync(editalPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Erro ao carregar edital ${editalName}: ${(error as Error).message}`);
  }
}

/**
 * Limpa todos os dados de um usuário no banco de dados
 * Ordem: topics → disciplines → exams → study_plans
 */
export async function cleanupUserData(userId: string): Promise<void> {
  logInfo('e2e-cleanup', userId, 'Iniciando cleanup de dados de teste');

  try {
    // 1. Buscar todos os study_plans do usuário
    const { data: plans, error: plansError } = await supabase
      .from('study_plans')
      .select('id')
      .eq('user_id', userId);

    if (plansError) throw plansError;
    if (!plans || plans.length === 0) {
      logInfo('e2e-cleanup', userId, 'Nenhum plano encontrado para limpar');
      return;
    }

    const planIds = plans.map(p => p.id);
    logInfo('e2e-cleanup', userId, `Encontrados ${planIds.length} planos para limpar`, { planIds });

    // 2. Buscar todas as disciplines dos planos
    const { data: disciplines, error: disciplinesError } = await supabase
      .from('disciplines')
      .select('id')
      .in('plan_id', planIds);

    if (disciplinesError) throw disciplinesError;

    const disciplineIds = disciplines?.map(d => d.id) || [];
    if (disciplineIds.length > 0) {
      logInfo('e2e-cleanup', userId, `Encontradas ${disciplineIds.length} disciplinas para limpar`);

      // 3. Deletar topics (FK: discipline_id)
      const { error: topicsError } = await supabase
        .from('topics')
        .delete()
        .in('discipline_id', disciplineIds);

      if (topicsError) {
        logError('e2e-cleanup', userId, topicsError, { step: 'delete-topics' });
      } else {
        logInfo('e2e-cleanup', userId, 'Topics deletados');
      }

      // 4. Deletar disciplines
      const { error: deleteDisciplinesError } = await supabase
        .from('disciplines')
        .delete()
        .in('id', disciplineIds);

      if (deleteDisciplinesError) {
        logError('e2e-cleanup', userId, deleteDisciplinesError, { step: 'delete-disciplines' });
      } else {
        logInfo('e2e-cleanup', userId, 'Disciplines deletadas');
      }
    }

    // 5. Deletar exams (FK: plan_id)
    const { error: examsError } = await supabase
      .from('exams')
      .delete()
      .in('plan_id', planIds);

    if (examsError) {
      logError('e2e-cleanup', userId, examsError, { step: 'delete-exams' });
    } else {
      logInfo('e2e-cleanup', userId, 'Exams deletados');
    }

    // 6. Deletar study_plans
    const { error: plansDeleteError } = await supabase
      .from('study_plans')
      .delete()
      .in('id', planIds);

    if (plansDeleteError) {
      logError('e2e-cleanup', userId, plansDeleteError, { step: 'delete-plans' });
    } else {
      logInfo('e2e-cleanup', userId, 'Study plans deletados');
    }

    logInfo('e2e-cleanup', userId, '✅ Cleanup concluído com sucesso');
  } catch (error) {
    logError('e2e-cleanup', userId, error, { step: 'cleanup' });
    throw error;
  }
}

/**
 * Valida se um plano foi criado corretamente no banco
 */
export async function validatePlanInDatabase(planId: string, userId: string): Promise<{
  valid: boolean;
  counts: {
    studyPlans: number;
    exams: number;
    disciplines: number;
    topics: number;
  };
  errors: string[];
}> {
  const errors: string[] = [];
  const counts = { studyPlans: 0, exams: 0, disciplines: 0, topics: 0 };

  try {
    // 1. Validar study_plan
    const { data: plan, error: planError } = await supabase
      .from('study_plans')
      .select('*')
      .eq('id', planId)
      .eq('user_id', userId)
      .single();

    if (planError || !plan) {
      errors.push(`Study plan ${planId} não encontrado`);
    } else {
      counts.studyPlans = 1;

      // 2. Validar exams
      const { data: exams, error: examsError } = await supabase
        .from('exams')
        .select('*')
        .eq('plan_id', planId);

      if (examsError) {
        errors.push(`Erro ao buscar exams: ${examsError.message}`);
      } else {
        counts.exams = exams?.length || 0;
      }

      // 3. Validar disciplines
      const { data: disciplines, error: disciplinesError } = await supabase
        .from('disciplines')
        .select('*')
        .eq('plan_id', planId);

      if (disciplinesError) {
        errors.push(`Erro ao buscar disciplines: ${disciplinesError.message}`);
      } else {
        counts.disciplines = disciplines?.length || 0;

        // 4. Validar topics
        if (disciplines && disciplines.length > 0) {
          const disciplineIds = disciplines.map(d => d.id);
          const { data: topics, error: topicsError } = await supabase
            .from('topics')
            .select('*')
            .in('discipline_id', disciplineIds);

          if (topicsError) {
            errors.push(`Erro ao buscar topics: ${topicsError.message}`);
          } else {
            counts.topics = topics?.length || 0;
          }
        }
      }
    }
  } catch (error) {
    errors.push(`Erro na validação: ${(error as Error).message}`);
  }

  return {
    valid: errors.length === 0,
    counts,
    errors,
  };
}

/**
 * Busca contagens esperadas de um edital JSON
 * 
 * IMPORTANTE: Esta função NÃO deve tentar "entender" a estrutura do edital.
 * A IA (identifier-agent) já fez isso. Aqui apenas contamos o que a IA extraiu.
 * 
 * Esta função existe APENAS para validação dos testes E2E, simulando o que
 * o identifier-agent DEVERIA retornar após normalização.
 */
export function getExpectedCounts(editalContent: any): {
  exams: number;
  disciplines: number;
  topics: number;
} {
  const concurso = editalContent.concursos?.[0];
  if (!concurso) {
    throw new Error('Estrutura de edital inválida: concursos[0] não encontrado');
  }

  // Para os testes E2E, vamos contar o que REALMENTE foi extraído pela IA
  // em vez de tentar adivinhar a estrutura do JSON.
  // 
  // Como a IA deve normalizar tudo, vamos fazer uma contagem "inteligente"
  // que detecta semanticamente grupos vs disciplinas pela estrutura.
  
  const disciplinas = concurso.disciplinas || [];
  let totalDisciplines = 0;
  let totalTopics = 0;

  // Heurística: Se alguma "disciplina" tem muitas sub-materias (> 5), provavelmente é um agrupador
  // Se as materias têm subtopicos, então: materias=disciplines, subtopicos=topics
  // Caso contrário: disciplinas=disciplines, materias=topics
  
  const firstDisciplina = disciplinas[0];
  const hasSubtopics = firstDisciplina?.materias?.some((m: any) => 
    m.subtopicos && m.subtopicos.length > 0
  );

  if (hasSubtopics) {
    // Estrutura: disciplinas → materias (disciplines) → subtopicos (topics)
    for (const grupo of disciplinas) {
      const materias = grupo.materias || [];
      totalDisciplines += materias.length;
      
      for (const materia of materias) {
        const subtopicos = materia.subtopicos || [];
        totalTopics += subtopicos.length;
      }
    }
  } else {
    // Estrutura: disciplinas (disciplines) → materias (topics)
    totalDisciplines = disciplinas.length;
    
    for (const disciplina of disciplinas) {
      const materias = disciplina.materias || [];
      totalTopics += materias.length;
    }
  }

  // Contar exames válidos (mesmo critério da IA)
  const validExamTypes = ['objetiva', 'discursiva', 'prática', 'oral'];
  const fases = concurso.fases || [];
  const validFases = fases.filter((fase: any) => validExamTypes.includes(fase.tipo));

  return {
    exams: validFases.length,
    disciplines: totalDisciplines,
    topics: totalTopics,
  };
}

/**
 * Aguarda até que o plano esteja com status 'ready'
 * Útil para testes assíncronos
 */
export async function waitForPlanReady(
  planId: string,
  maxWaitMs: number = 30000,
  checkIntervalMs: number = 500
): Promise<{ success: boolean; finalStatus?: string; error?: string }> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const { data: plan, error } = await supabase
      .from('study_plans')
      .select('status')
      .eq('id', planId)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    if (plan.status === 'ready') {
      return { success: true, finalStatus: 'ready' };
    }

    if (plan.status === 'error') {
      return { success: false, finalStatus: 'error', error: 'Plan status is error' };
    }

    // Aguardar antes de checar novamente
    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }

  return { success: false, error: `Timeout após ${maxWaitMs}ms` };
}
