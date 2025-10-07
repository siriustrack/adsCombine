/**
 * TESTES DO VERIFIER AGENT
 * 
 * O Verifier Agent é responsável por:
 * 1. Validar que todos os dados foram criados corretamente no banco
 * 2. Comparar contagens (exams, disciplines, topics) com dados originais
 * 3. Atualizar status do plano para 'ready' se tudo estiver correto
 * 4. Reportar discrepâncias de forma clara
 * 
 * Cobertura: 85%+
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { verifyAndFinalize } from '../verifier-agent';
import { SupabaseService } from '../../services/supabase-service';
import type { StudyPlanData } from '../../types/types';

// ============================================================================
// MOCKS
// ============================================================================

jest.mock('../../services/supabase-service');
jest.mock('../../utils/logger');

const mockSupabaseService = SupabaseService as jest.Mocked<typeof SupabaseService>;

// ============================================================================
// HELPERS
// ============================================================================

function createMockStudyPlanData(overrides: Partial<StudyPlanData> = {}): StudyPlanData {
  return {
    metadata: {
      examName: 'Test Exam',
      examOrg: 'Test Org',
      startDate: '2025-12-25',
      fixedOffDays: [],
      notes: 'Test notes'
    },
    exams: [{
      examType: 'objetiva',
      examDate: '2025-12-25',
      examTurn: 'manha',
      totalQuestions: 50
    }],
    disciplines: [{
      name: 'Test Discipline 1',
      color: '#3B82F6',
      numberOfQuestions: 25,
      topics: [
        { name: 'Topic 1', weight: 1.0 },
        { name: 'Topic 2', weight: 1.5 }
      ]
    }, {
      name: 'Test Discipline 2',
      color: '#10B981',
      numberOfQuestions: 25,
      topics: [
        { name: 'Topic 3', weight: 1.0 },
        { name: 'Topic 4', weight: 1.0 },
        { name: 'Topic 5', weight: 2.0 }
      ]
    }],
    ...overrides
  };
}

function createMockDBDisciplines() {
  return [{
    id: 'disc-1',
    name: 'Test Discipline 1',
    color: '#3B82F6',
    number_of_questions: 25,
    topics: [
      { id: 'topic-1', name: 'Topic 1', weight: 1.0 },
      { id: 'topic-2', name: 'Topic 2', weight: 1.5 }
    ]
  }, {
    id: 'disc-2',
    name: 'Test Discipline 2',
    color: '#10B981',
    number_of_questions: 25,
    topics: [
      { id: 'topic-3', name: 'Topic 3', weight: 1.0 },
      { id: 'topic-4', name: 'Topic 4', weight: 1.0 },
      { id: 'topic-5', name: 'Topic 5', weight: 2.0 }
    ]
  }];
}

function createMockDBExams() {
  return [{
    id: 'exam-1',
    exam_type: 'objetiva',
    exam_date: '2025-12-25',
    exam_turn: 'manha',
    total_questions: 50
  }];
}

// ============================================================================
// TESTES DE INPUT VALIDATION
// ============================================================================

describe('Verifier Agent - Input Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deve rejeitar planId nulo', async () => {
    const originalData = createMockStudyPlanData();
    
    const result = await verifyAndFinalize(null as any, originalData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('planId inválido');
  });

  test('deve rejeitar planId vazio', async () => {
    const originalData = createMockStudyPlanData();
    
    const result = await verifyAndFinalize('', originalData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('planId inválido');
  });

  test('deve rejeitar planId não-string', async () => {
    const originalData = createMockStudyPlanData();
    
    const result = await verifyAndFinalize(123 as any, originalData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('planId inválido');
  });

  test('deve rejeitar originalData nulo', async () => {
    const result = await verifyAndFinalize('plan-123', null as any);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Dados originais inválidos');
  });

  test('deve rejeitar originalData sem exams', async () => {
    const invalidData = createMockStudyPlanData();
    delete (invalidData as any).exams;
    
    const result = await verifyAndFinalize('plan-123', invalidData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Dados originais inválidos');
  });

  test('deve rejeitar originalData sem disciplines', async () => {
    const invalidData = createMockStudyPlanData();
    delete (invalidData as any).disciplines;
    
    const result = await verifyAndFinalize('plan-123', invalidData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Dados originais inválidos');
  });
});

// ============================================================================
// TESTES DE VERIFICAÇÃO DE CONTAGENS
// ============================================================================

describe('Verifier Agent - Verificação de Contagens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deve passar quando todas contagens correspondem', async () => {
    const originalData = createMockStudyPlanData();
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue(createMockDBDisciplines() as any);
    mockSupabaseService.updateStudyPlanStatus.mockResolvedValue(undefined);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(true);
    expect(result.data).toBe(true);
    expect(mockSupabaseService.getExams).toHaveBeenCalledWith(planId, 'unknown');
    expect(mockSupabaseService.getDisciplinesWithTopics).toHaveBeenCalledWith(planId, 'unknown');
    expect(mockSupabaseService.updateStudyPlanStatus).toHaveBeenCalledWith(planId, 'ready', 'unknown');
  });

  test('deve falhar quando contagem de exams não corresponde', async () => {
    const originalData = createMockStudyPlanData();
    const planId = 'plan-123';
    
    // Retornar mais exams do que esperado
    mockSupabaseService.getExams.mockResolvedValue([
      ...createMockDBExams(),
      { ...createMockDBExams()[0], id: 'exam-2' }
    ]);
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue(createMockDBDisciplines() as any);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('exames');
    expect(mockSupabaseService.updateStudyPlanStatus).not.toHaveBeenCalled();
  });

  test('deve falhar quando contagem de disciplines não corresponde', async () => {
    const originalData = createMockStudyPlanData();
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    // Retornar menos disciplines do que esperado
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue([createMockDBDisciplines()[0]] as any);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('disciplinas');
    expect(mockSupabaseService.updateStudyPlanStatus).not.toHaveBeenCalled();
  });

  test('deve falhar quando contagem de topics não corresponde', async () => {
    const originalData = createMockStudyPlanData();
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    // Remover um topic da primeira discipline
    const disciplinesWithMissingTopic = createMockDBDisciplines();
    disciplinesWithMissingTopic[0].topics = disciplinesWithMissingTopic[0].topics!.slice(0, 1);
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue(disciplinesWithMissingTopic as any);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('tópicos');
    expect(mockSupabaseService.updateStudyPlanStatus).not.toHaveBeenCalled();
  });
});

// ============================================================================
// TESTES DE EDGE CASES
// ============================================================================

describe('Verifier Agent - Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deve lidar com plano sem topics', async () => {
    const originalData = createMockStudyPlanData({
      disciplines: [{
        name: 'Test Discipline',
        color: '#3B82F6',
        numberOfQuestions: 50,
        topics: [] // Sem topics
      }]
    });
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue([{
      id: 'disc-1',
      name: 'Test Discipline',
      color: '#3B82F6',
      number_of_questions: 50,
      topics: [] // Sem topics
    }] as any);
    mockSupabaseService.updateStudyPlanStatus.mockResolvedValue(undefined);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(true);
  });

  test('deve lidar com múltiplos exams', async () => {
    const originalData = createMockStudyPlanData({
      exams: [
        {
          examType: 'objetiva',
          examDate: '2025-12-25',
          examTurn: 'manha',
          totalQuestions: 50
        },
        {
          examType: 'discursiva',
          examDate: '2025-12-26',
          examTurn: 'tarde',
          totalQuestions: 30
        }
      ]
    });
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockResolvedValue([
      { ...createMockDBExams()[0], id: 'exam-1' },
      { ...createMockDBExams()[0], id: 'exam-2', exam_type: 'discursiva' }
    ]);
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue(createMockDBDisciplines() as any);
    mockSupabaseService.updateStudyPlanStatus.mockResolvedValue(undefined);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(true);
  });

  test('deve lidar com muitas disciplines (100+)', async () => {
    const manyDisciplines = Array.from({ length: 100 }, (_, i) => ({
      name: `Discipline ${i + 1}`,
      color: '#3B82F6',
      numberOfQuestions: 5,
      topics: [
        { name: `Topic ${i * 2 + 1}`, weight: 1.0 as 1 | 1.5 | 2 },
        { name: `Topic ${i * 2 + 2}`, weight: 1.0 as 1 | 1.5 | 2 }
      ]
    }));
    
    const originalData = createMockStudyPlanData({
      disciplines: manyDisciplines
    });
    const planId = 'plan-123';
    
    const manyDBDisciplines = manyDisciplines.map((d, i) => ({
      id: `disc-${i + 1}`,
      name: d.name,
      color: d.color,
      number_of_questions: d.numberOfQuestions,
      topics: d.topics.map((t, j) => ({
        id: `topic-${i * 2 + j + 1}`,
        name: t.name,
        weight: t.weight
      }))
    }));
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue(manyDBDisciplines as any);
    mockSupabaseService.updateStudyPlanStatus.mockResolvedValue(undefined);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(true);
    expect(mockSupabaseService.getDisciplinesWithTopics).toHaveBeenCalled();
  });

  test('deve lidar com disciplines com muitos topics', async () => {
    const manyTopics = Array.from({ length: 50 }, (_, i) => ({
      name: `Topic ${i + 1}`,
      weight: 1.0 as 1 | 1.5 | 2
    }));
    
    const originalData = createMockStudyPlanData({
      disciplines: [{
        name: 'Test Discipline',
        color: '#3B82F6',
        numberOfQuestions: 50,
        topics: manyTopics
      }]
    });
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue([{
      id: 'disc-1',
      name: 'Test Discipline',
      color: '#3B82F6',
      number_of_questions: 50,
      topics: manyTopics.map((t, i) => ({
        id: `topic-${i + 1}`,
        name: t.name,
        weight: t.weight
      }))
    }] as any);
    mockSupabaseService.updateStudyPlanStatus.mockResolvedValue(undefined);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// TESTES DE TRATAMENTO DE ERROS
// ============================================================================

describe('Verifier Agent - Tratamento de Erros', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deve tratar erro ao buscar exams', async () => {
    const originalData = createMockStudyPlanData();
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockRejectedValue(new Error('Database connection failed'));
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Erro no verificador');
    expect(result.error).toContain('Database connection failed');
  });

  test('deve tratar erro ao buscar disciplines', async () => {
    const originalData = createMockStudyPlanData();
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    mockSupabaseService.getDisciplinesWithTopics.mockRejectedValue(new Error('Network timeout'));
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Erro no verificador');
    expect(result.error).toContain('Network timeout');
  });

  test('deve tratar erro ao atualizar status', async () => {
    const originalData = createMockStudyPlanData();
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue(createMockDBDisciplines() as any);
    mockSupabaseService.updateStudyPlanStatus.mockRejectedValue(new Error('Update failed'));
    
    const result = await verifyAndFinalize(planId, originalData);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Erro no verificador');
    expect(result.error).toContain('Update failed');
  });

  test('deve tratar erro quando DB retorna dados malformados', async () => {
    const originalData = createMockStudyPlanData();
    const planId = 'plan-123';
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    // Retornar apenas 1 discipline quando espera 2
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue([
      { id: 'disc-1', name: 'Test', topics: null }
    ] as any);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    // Deve detectar que discipline count não corresponde (1 vs 2 esperado)
    expect(result.success).toBe(false);
    expect(result.error).toContain('disciplinas');
  });
});

// ============================================================================
// TESTES DE INTEGRAÇÃO
// ============================================================================

describe('Verifier Agent - Integração', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deve executar fluxo completo de verificação com sucesso', async () => {
    const originalData = createMockStudyPlanData();
    const planId = 'plan-123';
    
    // Mock todas as chamadas
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue(createMockDBDisciplines() as any);
    mockSupabaseService.updateStudyPlanStatus.mockResolvedValue(undefined);
    
    const result = await verifyAndFinalize(planId, originalData);
    
    // Validar resultado
    expect(result.success).toBe(true);
    expect(result.data).toBe(true);
    
    // Validar chamadas na ordem correta
    expect(mockSupabaseService.getExams).toHaveBeenCalledWith(planId, 'unknown');
    expect(mockSupabaseService.getDisciplinesWithTopics).toHaveBeenCalledWith(planId, 'unknown');
    expect(mockSupabaseService.updateStudyPlanStatus).toHaveBeenCalledWith(planId, 'ready', 'unknown');
    
    // Validar ordem das chamadas
    const calls = (mockSupabaseService.getExams as jest.MockedFunction<any>).mock.invocationCallOrder;
    expect(calls[0]).toBeLessThan(
      (mockSupabaseService.getDisciplinesWithTopics as jest.MockedFunction<any>).mock.invocationCallOrder[0]
    );
  });

  test('deve contar topics corretamente em estrutura complexa', async () => {
    const complexData = createMockStudyPlanData({
      disciplines: [
        {
          name: 'Disc 1',
          color: '#3B82F6',
          numberOfQuestions: 10,
          topics: [
            { name: 'T1', weight: 1.0 },
            { name: 'T2', weight: 1.5 },
            { name: 'T3', weight: 2.0 }
          ]
        },
        {
          name: 'Disc 2',
          color: '#10B981',
          numberOfQuestions: 15,
          topics: [
            { name: 'T4', weight: 1.0 },
            { name: 'T5', weight: 1.0 }
          ]
        },
        {
          name: 'Disc 3',
          color: '#F59E0B',
          numberOfQuestions: 25,
          topics: [
            { name: 'T6', weight: 1.0 },
            { name: 'T7', weight: 1.5 },
            { name: 'T8', weight: 1.5 },
            { name: 'T9', weight: 2.0 }
          ]
        }
      ]
    });
    const planId = 'plan-complex';
    
    // Total topics: 3 + 2 + 4 = 9
    const dbDisc = [
      {
        id: 'disc-1',
        name: 'Disc 1',
        topics: Array(3).fill(null).map((_, i) => ({ id: `t${i+1}`, name: `T${i+1}`, weight: 1.0 }))
      },
      {
        id: 'disc-2',
        name: 'Disc 2',
        topics: Array(2).fill(null).map((_, i) => ({ id: `t${i+4}`, name: `T${i+4}`, weight: 1.0 }))
      },
      {
        id: 'disc-3',
        name: 'Disc 3',
        topics: Array(4).fill(null).map((_, i) => ({ id: `t${i+6}`, name: `T${i+6}`, weight: 1.0 }))
      }
    ];
    
    mockSupabaseService.getExams.mockResolvedValue(createMockDBExams());
    mockSupabaseService.getDisciplinesWithTopics.mockResolvedValue(dbDisc as any);
    mockSupabaseService.updateStudyPlanStatus.mockResolvedValue(undefined);
    
    const result = await verifyAndFinalize(planId, complexData);
    
    expect(result.success).toBe(true);
  });
});
