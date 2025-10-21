/**
 * Agente de Fallback Determinístico
 * 
 * OBJETIVO: Interceptar erros do orchestrator e corrigi-los automaticamente
 * SEM reprocessar Claude ($5), apenas sanitizar dados já processados
 * 
 * ERROS TRATADOS:
 * 1. duplicate key "uq_topic_per_discipline" - Tópicos duplicados
 * 2. invalid enum values - Já tratado por enum-normalizer
 * 3. constraint violations - Dados inválidos
 */

import logger from '../../lib/logger';
import type { StudyPlanData, TopicData, DisciplineWithTopics } from '../types/types';

export interface FallbackResult {
  success: boolean;
  data?: StudyPlanData;
  fixes?: string[];
  error?: string;
}

// =====================================================================
// ERROR DETECTION
// =====================================================================

/**
 * Detecta o tipo de erro baseado na mensagem
 */
export function detectErrorType(error: Error): string {
  const msg = error.message.toLowerCase();
  
  if (msg.includes('duplicate key') && msg.includes('uq_topic_per_discipline')) {
    return 'DUPLICATE_TOPICS';
  }
  if (msg.includes('invalid input value for enum')) {
    return 'INVALID_ENUM';
  }
  if (msg.includes('violates unique constraint')) {
    return 'UNIQUE_CONSTRAINT';
  }
  if (msg.includes('violates foreign key constraint')) {
    return 'FOREIGN_KEY';
  }
  
  return 'UNKNOWN';
}

// =====================================================================
// FIX 1: DUPLICATE TOPICS
// =====================================================================

/**
 * Remove tópicos duplicados de cada disciplina
 * Mantém apenas a primeira ocorrência
 */
function removeDuplicateTopics(planData: StudyPlanData): { fixed: StudyPlanData; removedCount: number } {
  let totalRemoved = 0;
  
  const fixedDisciplines = planData.disciplines.map(discipline => {
    const seen = new Set<string>();
    const uniqueTopics: TopicData[] = [];
    let removed = 0;
    
    discipline.topics.forEach(topic => {
      // Normalizar nome para comparação (trim, lowercase)
      const normalizedName = topic.name.trim().toLowerCase();
      
      if (!seen.has(normalizedName)) {
        seen.add(normalizedName);
        uniqueTopics.push(topic);
      } else {
        removed++;
        logger.info('[FALLBACK] Removendo tópico duplicado', {
          discipline: discipline.name,
          topic: topic.name
        });
      }
    });
    
    totalRemoved += removed;
    
    return {
      ...discipline,
      topics: uniqueTopics
    };
  });
  
  return {
    fixed: {
      ...planData,
      disciplines: fixedDisciplines
    },
    removedCount: totalRemoved
  };
}

// =====================================================================
// FIX 2: EMPTY TOPICS
// =====================================================================

/**
 * Remove disciplinas sem tópicos e garante pelo menos 1 tópico por disciplina
 */
function ensureTopicsInDisciplines(planData: StudyPlanData): { fixed: StudyPlanData; added: number } {
  let topicsAdded = 0;
  
  const fixedDisciplines = planData.disciplines
    .map(discipline => {
      if (!discipline.topics || discipline.topics.length === 0) {
        logger.warn('[FALLBACK] Disciplina sem tópicos, adicionando tópico genérico', {
          discipline: discipline.name
        });
        
        topicsAdded++;
        return {
          ...discipline,
          topics: [{
            name: `${discipline.name} - Conteúdo Geral`,
            weight: 1.0 as 1.0 | 1.5 | 2.0
          }]
        };
      }
      return discipline;
    })
    .filter(d => d.topics.length > 0);
  
  return {
    fixed: {
      ...planData,
      disciplines: fixedDisciplines
    },
    added: topicsAdded
  };
}

// =====================================================================
// FIX 3: INVALID CHARACTERS
// =====================================================================

/**
 * Sanitiza caracteres especiais que podem causar problemas
 */
function sanitizeStrings(planData: StudyPlanData): StudyPlanData {
  return {
    ...planData,
    disciplines: planData.disciplines.map(discipline => ({
      ...discipline,
      name: discipline.name.trim(),
      topics: discipline.topics.map(topic => ({
        ...topic,
        name: topic.name.trim()
      }))
    }))
  };
}

// =====================================================================
// MAIN FALLBACK LOGIC
// =====================================================================

/**
 * Aplica correções determinísticas nos dados do plano
 * NÃO reprocessa Claude, apenas sanitiza dados já existentes
 */
export async function applyFallbackFixes(
  planData: StudyPlanData,
  error: Error
): Promise<FallbackResult> {
  try {
    const errorType = detectErrorType(error);
    const fixes: string[] = [];
    let fixedData = { ...planData };
    
    logger.info('[FALLBACK] 🔧 Aplicando correções automáticas', {
      errorType,
      errorMessage: error.message
    });
    
    // Fix 1: Remover tópicos duplicados (sempre aplicar)
    const { fixed: afterDuplicates, removedCount } = removeDuplicateTopics(fixedData);
    if (removedCount > 0) {
      fixes.push(`Removidos ${removedCount} tópicos duplicados`);
      fixedData = afterDuplicates;
    }
    
    // Fix 2: Garantir tópicos em disciplinas
    const { fixed: afterTopics, added } = ensureTopicsInDisciplines(fixedData);
    if (added > 0) {
      fixes.push(`Adicionados ${added} tópicos genéricos em disciplinas vazias`);
      fixedData = afterTopics;
    }
    
    // Fix 3: Sanitizar strings
    fixedData = sanitizeStrings(fixedData);
    fixes.push('Strings sanitizadas');
    
    // Validação final
    const validation = validateFixedData(fixedData);
    if (!validation.isValid) {
      logger.error('[FALLBACK] ❌ Validação falhou após correções', {
        errors: validation.errors
      });
      return {
        success: false,
        error: `Validação falhou: ${validation.errors.join(', ')}`
      };
    }
    
    logger.info('[FALLBACK] ✅ Correções aplicadas com sucesso', {
      fixes,
      disciplines: fixedData.disciplines.length,
      totalTopics: fixedData.disciplines.reduce((acc, d) => acc + d.topics.length, 0)
    });
    
    return {
      success: true,
      data: fixedData,
      fixes
    };
    
  } catch (fallbackError) {
    logger.error('[FALLBACK] ❌ Erro ao aplicar correções', {
      error: fallbackError instanceof Error ? fallbackError.message : 'Unknown',
      stack: fallbackError instanceof Error ? fallbackError.stack : undefined
    });
    
    return {
      success: false,
      error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
    };
  }
}

// =====================================================================
// VALIDATION
// =====================================================================

function validateFixedData(planData: StudyPlanData): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validar metadata
  if (!planData.metadata?.examName) {
    errors.push('metadata.examName ausente');
  }
  
  // Validar exams
  if (!planData.exams || planData.exams.length === 0) {
    errors.push('Nenhum exam encontrado');
  }
  
  // Validar disciplines
  if (!planData.disciplines || planData.disciplines.length === 0) {
    errors.push('Nenhuma discipline encontrada');
  }
  
  // Validar topics
  planData.disciplines?.forEach((discipline, idx) => {
    if (!discipline.topics || discipline.topics.length === 0) {
      errors.push(`Discipline ${idx} (${discipline.name}) sem topics`);
    }
    
    // Verificar duplicatas (não deveria ter mais)
    const topicNames = discipline.topics.map(t => t.name.trim().toLowerCase());
    const uniqueNames = new Set(topicNames);
    if (topicNames.length !== uniqueNames.size) {
      errors.push(`Discipline ${discipline.name} ainda tem duplicatas`);
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// =====================================================================
// RETRY WITH FALLBACK
// =====================================================================

/**
 * Tenta executar função, se falhar aplica fallback e tenta novamente
 * DETERMINÍSTICO: Máximo 1 retry após fallback
 */
export async function retryWithFallback<T>(
  fn: (data: StudyPlanData) => Promise<T>,
  planData: StudyPlanData,
  context: { userId: string; operation: string }
): Promise<{ success: boolean; data?: T; error?: string; fallbackApplied?: boolean }> {
  
  try {
    // Tentativa 1: Dados originais
    logger.info('[FALLBACK] Tentativa 1: Dados originais', context);
    const result = await fn(planData);
    return { success: true, data: result };
    
  } catch (error) {
    const err = error as Error;
    logger.warn('[FALLBACK] ⚠️  Tentativa 1 falhou, aplicando fallback', {
      ...context,
      error: err.message
    });
    
    // Aplicar fallback
    const fallbackResult = await applyFallbackFixes(planData, err);
    
    if (!fallbackResult.success || !fallbackResult.data) {
      logger.error('[FALLBACK] ❌ Fallback falhou', {
        ...context,
        error: fallbackResult.error
      });
      return {
        success: false,
        error: `Fallback falhou: ${fallbackResult.error}`,
        fallbackApplied: false
      };
    }
    
    try {
      // Tentativa 2: Dados corrigidos
      logger.info('[FALLBACK] Tentativa 2: Dados corrigidos pelo fallback', {
        ...context,
        fixes: fallbackResult.fixes
      });
      
      const result = await fn(fallbackResult.data);
      
      logger.info('[FALLBACK] ✅ Sucesso após fallback!', {
        ...context,
        fixes: fallbackResult.fixes
      });
      
      return {
        success: true,
        data: result,
        fallbackApplied: true
      };
      
    } catch (retryError) {
      const retryErr = retryError as Error;
      logger.error('[FALLBACK] ❌ Tentativa 2 falhou mesmo após fallback', {
        ...context,
        originalError: err.message,
        retryError: retryErr.message,
        fixes: fallbackResult.fixes
      });
      
      return {
        success: false,
        error: `Retry falhou: ${retryErr.message}`,
        fallbackApplied: true
      };
    }
  }
}
