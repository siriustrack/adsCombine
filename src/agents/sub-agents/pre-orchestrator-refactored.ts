/**
 * PRE-ORCHESTRATOR REFATORADO
 * 
 * Responsabilidade: Receber JSON extraído do EditalProcessService e normalizar
 * para o formato flat esperado pelos agentes de orquestração.
 * 
 * Transformações:
 * 1. JSON hierárquico (grupos → materias) → Flat (disciplines → topics)
 * 2. Filtrar fases inválidas → Apenas ENUMs válidos
 * 3. Gerar cores automáticas → Paleta predefinida
 * 4. Validar e normalizar campos → Garantir compatibilidade com database
 */

import type { 
  StudyPlanData, 
  StudyPlanMetadata,
  ExamData,
  DisciplineWithTopics,
  TopicData,
  AgentResponse 
} from '../types/types';

// ============================================================================
// TYPES PARA O JSON EXTRAÍDO (ESTRUTURA REAL)
// ============================================================================

interface EditalJSON {
  concursos: ConcursoJSON[];
}

interface ConcursoJSON {
  metadata: MetadataJSON;
  fases: FaseJSON[];
  disciplinas: DisciplinaJSON[];
}

interface MetadataJSON {
  examName: string;
  examOrg: string;
  cargo?: string;
  area?: string;
  startDate: string;
  examTurn?: string;
  totalQuestions: number;
  notes?: string;
}

interface FaseJSON {
  tipo: string; // "objetiva", "discursiva", "titulos", etc.
  data: string;
  turno: string;
  totalQuestoes?: number;
}

interface DisciplinaJSON {
  nome: string; // Pode ser "Grupo I", "Direito Constitucional", etc.
  numeroQuestoes?: number; // Pode estar no grupo
  materias?: MateriaJSON[]; // Se for grupo
  subtopicos?: string[]; // Se for disciplina simples
}

interface MateriaJSON {
  nome: string;
  numeroQuestoes?: number;
  subtopicos: string[];
}

// ============================================================================
// CONFIGURAÇÕES
// ============================================================================

const VALID_EXAM_TYPES = ['objetiva', 'discursiva', 'prática', 'oral'] as const;
const VALID_TURNS = ['manha', 'tarde', 'noite'] as const;

// Paleta de cores para disciplinas (rotação automática)
const COLOR_PALETTE = [
  '#3B82F6', // blue-500
  '#10B981', // green-500
  '#F59E0B', // yellow-500
  '#EF4444', // red-500
  '#8B5CF6', // purple-500
  '#EC4899', // pink-500
  '#14B8A6', // teal-500
  '#F97316', // orange-500
  '#6366F1', // indigo-500
  '#06B6D4', // cyan-500
];

// ============================================================================
// FUNÇÃO PRINCIPAL
// ============================================================================

export async function preOrchestrate(
  userId: string,
  editalId: string,
  editalJSON: EditalJSON
): Promise<AgentResponse<StudyPlanData>> {
  
  // 1. VALIDAÇÕES DE INPUT
  const validation = validateInput(userId, editalId, editalJSON);
  if (!validation.success) {
    return validation;
  }

  try {
    // Se tiver múltiplos concursos, usar apenas o primeiro
    const concurso = editalJSON.concursos[0];
    
    // 2. TRANSFORMAR METADADOS
    const metadata = transformMetadata(concurso);

    // 3. TRANSFORMAR EXAMS (filtrar fases válidas)
    const totalQuestoes = concurso.metadata.totalQuestions;
    const exams = transformExams(concurso.fases, totalQuestoes);
    if (exams.length === 0) {
      return { 
        success: false, 
        error: 'Nenhuma fase válida encontrada (objetiva, discursiva, prática ou oral)' 
      };
    }

    // 4. TRANSFORMAR DISCIPLINES (achatar hierarquia + gerar cores)
    const disciplines = transformDisciplines(concurso.disciplinas);
    if (disciplines.length === 0) {
      return { 
        success: false, 
        error: 'Nenhuma disciplina encontrada no edital' 
      };
    }

    // 5. RETORNAR ESTRUTURA NORMALIZADA
    const studyPlanData: StudyPlanData = {
      metadata,
      exams: [exams[0]], // Usar apenas primeira fase válida (PRIMARY KEY constraint)
      disciplines,
    };

    return { 
      success: true, 
      data: studyPlanData 
    };

  } catch (error) {
    return { 
      success: false, 
      error: `Erro no pre-orquestrador: ${(error as Error).message}` 
    };
  }
}

// ============================================================================
// VALIDAÇÕES
// ============================================================================

function validateInput(
  userId: string, 
  editalId: string, 
  editalJSON: EditalJSON
): AgentResponse<never> {
  
  // Validar userId
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    return { success: false, error: 'userId inválido: deve ser string UUID não vazia' };
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return { success: false, error: 'userId deve ser um UUID válido' };
  }

  // Validar editalId
  if (!editalId || typeof editalId !== 'string' || editalId.trim().length === 0) {
    return { success: false, error: 'editalId inválido: deve ser string não vazia' };
  }

  // Validar JSON
  if (!editalJSON || typeof editalJSON !== 'object') {
    return { success: false, error: 'editalJSON inválido: deve ser objeto' };
  }
  if (!editalJSON.concursos || !Array.isArray(editalJSON.concursos)) {
    return { success: false, error: 'editalJSON deve ter array de concursos' };
  }
  if (editalJSON.concursos.length === 0) {
    return { success: false, error: 'editalJSON deve ter pelo menos 1 concurso' };
  }

  const concurso = editalJSON.concursos[0];
  if (!concurso.fases || !Array.isArray(concurso.fases) || concurso.fases.length === 0) {
    return { success: false, error: 'concurso deve ter pelo menos 1 fase' };
  }

  return { success: true };
}

// ============================================================================
// TRANSFORMAÇÕES
// ============================================================================

/**
 * Transforma metadados do concurso
 */
function transformMetadata(concurso: ConcursoJSON): StudyPlanMetadata {
  return {
    examName: concurso.metadata.examName,
    examOrg: concurso.metadata.examOrg,
    startDate: normalizeDate(concurso.metadata.startDate),
    fixedOffDays: [], // Pode ser configurado depois pelo usuário
    notes: concurso.metadata.notes || `Extraído de edital. ${concurso.fases.length} fase(s) identificada(s).`,
  };
}

/**
 * Transforma fases em exams (filtrar apenas tipos válidos)
 */
function transformExams(fases: FaseJSON[], totalQuestoes: number): ExamData[] {
  const validExams: ExamData[] = [];

  for (const fase of fases) {
    // Normalizar tipo para lowercase e remover acentos
    const tipoNormalizado = normalizeTipo(fase.tipo);

    // Verificar se é um tipo válido
    if (!VALID_EXAM_TYPES.includes(tipoNormalizado as any)) {
      console.warn(`⚠️ Tipo de fase ignorado: "${fase.tipo}" (não é objetiva/discursiva/prática/oral)`);
      continue;
    }

    // Normalizar turno
    const turnoNormalizado = normalizeTurno(fase.turno);
    if (!VALID_TURNS.includes(turnoNormalizado as any)) {
      console.warn(`⚠️ Turno inválido: "${fase.turno}", usando "manha" como padrão`);
    }

    validExams.push({
      examType: tipoNormalizado as 'objetiva' | 'discursiva' | 'prática' | 'oral',
      examDate: normalizeDate(fase.data),
      examTurn: (VALID_TURNS.includes(turnoNormalizado as any) ? turnoNormalizado : 'manha') as 'manha' | 'tarde' | 'noite',
      totalQuestions: fase.totalQuestoes || totalQuestoes,
    });
  }

  return validExams;
}

/**
 * Transforma disciplinas hierárquicas em flat + gera cores
 */
function transformDisciplines(disciplinas: DisciplinaJSON[]): DisciplineWithTopics[] {
  const allDisciplines: DisciplineWithTopics[] = [];
  let colorIndex = 0;

  for (const disciplina of disciplinas) {
    
    // CASO 1: Disciplina é um grupo com matérias
    if (disciplina.materias && disciplina.materias.length > 0) {
      for (const materia of disciplina.materias) {
        allDisciplines.push({
          name: materia.nome,
          color: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
          numberOfQuestions: materia.numeroQuestoes || 0,
          topics: materia.subtopicos.map(subtopico => ({
            name: subtopico,
            weight: 1.0, // Peso padrão, pode ser inferido depois
          })),
        });
        colorIndex++;
      }
    } 
    // CASO 2: Disciplina simples com subtópicos diretos
    else if (disciplina.subtopicos && disciplina.subtopicos.length > 0) {
      allDisciplines.push({
        name: disciplina.nome,
        color: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
        numberOfQuestions: disciplina.numeroQuestoes || 0,
        topics: disciplina.subtopicos.map(subtopico => ({
          name: subtopico,
          weight: 1.0,
        })),
      });
      colorIndex++;
    }
    // CASO 3: Ignorar se não tem conteúdo
    else {
      console.warn(`⚠️ Disciplina sem conteúdo: "${disciplina.nome}"`);
    }
  }

  return allDisciplines;
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================

/**
 * Normaliza tipo de fase para ENUM válido
 */
function normalizeTipo(tipo: string): string {
  return tipo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .trim();
}

/**
 * Normaliza turno para ENUM válido
 */
function normalizeTurno(turno: string): string {
  const turnoNormalizado = turno
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // Mapeamento de variações
  const mapping: Record<string, string> = {
    'manha': 'manha',
    'manhã': 'manha',
    'matutino': 'manha',
    'tarde': 'tarde',
    'vespertino': 'tarde',
    'noite': 'noite',
    'noturno': 'noite',
    'nao_especificado': 'manha', // Padrão
    'nao especificado': 'manha',
  };

  return mapping[turnoNormalizado] || 'manha';
}

/**
 * Normaliza data para formato YYYY-MM-DD
 */
function normalizeDate(date: string): string {
  if (!date || date.toLowerCase().includes('divulgar')) {
    return new Date().toISOString().split('T')[0]; // Data atual como fallback
  }
  
  // Se já estiver em formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  // Tentar parsear outros formatos
  try {
    const parsed = new Date(date);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  } catch (error) {
    // Ignorar erro de parsing
  }

  // Fallback: data atual
  return new Date().toISOString().split('T')[0];
}

// ============================================================================
// EXPORTS
// ============================================================================

export { EditalJSON, ConcursoJSON, FaseJSON, DisciplinaJSON, MateriaJSON };

