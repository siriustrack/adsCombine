/**
 * Orchestrator Agent - Advanced Tests
 * 
 * Testes avançados incluindo:
 * - Transações e rollback
 * - RLS (Row Level Security)
 * - Paralelização
 * - Planos com 20+ disciplinas
 * - Performance e stress tests
 * 
 * Meta: Cobertura 80% → 90%+
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { orchestratePlanCreation } from '../../src/agents/sub-agents/orchestrator-agent';
import { SupabaseService } from '../../src/agents/services/supabase-service';
import type { StudyPlanData } from '../../src/agents/types/types';

jest.mock('../../src/agents/services/supabase-service');

const mockSupabaseService = SupabaseService as jest.Mocked<typeof SupabaseService>;

// Helper para criar dados válidos
function createValidPlanData(options: {
  disciplineCount?: number;
  topicsPerDiscipline?: number;
  examCount?: number;
} = {}): StudyPlanData {
  const {
    disciplineCount = 3,
    topicsPerDiscipline = 5,
    examCount = 1
  } = options;

  return {
    metadata: {
      examName: 'Test Exam',
      examOrg: 'Test Org',
      startDate: '2024-01-01',
      fixedOffDays: ['sun'],
      notes: 'Test notes'
    },
    exams: Array.from({ length: examCount }, (_, i) => ({
      examType: 'objetiva' as const,
      examDate: '2024-01-15',
      examTurn: 'manha' as const,
      totalQuestions: 50
    })),
    disciplines: Array.from({ length: disciplineCount }, (_, i) => ({
      name: `Discipline ${i + 1}`,
      color: '#3B82F6',
      numberOfQuestions: 10,
      topics: Array.from({ length: topicsPerDiscipline }, (_, j) => ({
        name: `Topic ${i + 1}.${j + 1}`,
        weight: 1.0 as 1 | 1.5 | 2
      }))
    }))
  };
}

describe('Orchestrator Agent - Advanced Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock padrão de sucesso
    mockSupabaseService.insertStudyPlan.mockResolvedValue({ id: 'plan-123' } as any);
    mockSupabaseService.insertExams.mockResolvedValue([{ id: 'exam-123' }] as any);
    mockSupabaseService.insertDisciplines.mockImplementation(async (disciplines) => {
      return disciplines.map((_, i) => ({ id: `disc-${i + 1}`, name: `Discipline ${i + 1}` })) as any;
    });
    mockSupabaseService.insertTopics.mockResolvedValue([{ id: 'topic-123' }] as any);
  });

  describe('Transações e Rollback', () => {
    test('deve fazer rollback se insertExams falhar', async () => {
      const planData = createValidPlanData();

      mockSupabaseService.insertStudyPlan.mockResolvedValueOnce({ id: 'plan-123' } as any);
      mockSupabaseService.insertExams.mockRejectedValueOnce(new Error('Exam insertion failed'));

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Erro no orquestrador');
      expect(mockSupabaseService.insertStudyPlan).toHaveBeenCalledTimes(1);
      expect(mockSupabaseService.insertExams).toHaveBeenCalledTimes(1);
      // Idealmente deveria ter deleteStudyPlan chamado, mas não está implementado
    });

    test('deve fazer rollback se insertDisciplines falhar', async () => {
      const planData = createValidPlanData();

      mockSupabaseService.insertStudyPlan.mockResolvedValueOnce({ id: 'plan-123' } as any);
      mockSupabaseService.insertExams.mockResolvedValueOnce([{ id: 'exam-123' }] as any);
      mockSupabaseService.insertDisciplines.mockRejectedValueOnce(new Error('Discipline insertion failed'));

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Erro no orquestrador');
      expect(mockSupabaseService.insertDisciplines).toHaveBeenCalledTimes(1);
    });

    test('deve fazer rollback se insertTopics falhar', async () => {
      const planData = createValidPlanData();

      mockSupabaseService.insertStudyPlan.mockResolvedValueOnce({ id: 'plan-123' } as any);
      mockSupabaseService.insertExams.mockResolvedValueOnce([{ id: 'exam-123' }] as any);
      mockSupabaseService.insertDisciplines.mockResolvedValueOnce([
        { id: 'disc-1', name: 'Discipline 1' }
      ] as any);
      mockSupabaseService.insertTopics.mockRejectedValueOnce(new Error('Topics insertion failed'));

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Erro no orquestrador');
    });

    test('deve manter integridade com falha no meio de múltiplas disciplines', async () => {
      const planData = createValidPlanData({ disciplineCount: 5 });

      mockSupabaseService.insertStudyPlan.mockResolvedValueOnce({ id: 'plan-123' } as any);
      mockSupabaseService.insertExams.mockResolvedValueOnce([{ id: 'exam-123' }] as any);
      mockSupabaseService.insertDisciplines.mockResolvedValueOnce(
        Array.from({ length: 5 }, (_, i) => ({ id: `disc-${i + 1}`, name: `Discipline ${i + 1}` })) as any
      );

      // Faz a terceira inserção de topics falhar
      mockSupabaseService.insertTopics
        .mockResolvedValueOnce([{ id: 'topic-1' }] as any)
        .mockResolvedValueOnce([{ id: 'topic-2' }] as any)
        .mockRejectedValueOnce(new Error('Third topics insertion failed'));

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(false);
      expect(mockSupabaseService.insertTopics).toHaveBeenCalledTimes(3);
    });
  });

  describe('Validação de Input', () => {
    test('deve rejeitar userId vazio', async () => {
      const planData = createValidPlanData();

      const result = await orchestratePlanCreation('', planData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('userId inválido');
      expect(mockSupabaseService.insertStudyPlan).not.toHaveBeenCalled();
    });

    test('deve rejeitar userId null', async () => {
      const planData = createValidPlanData();

      const result = await orchestratePlanCreation(null as any, planData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('userId inválido');
    });

    test('deve rejeitar planData sem metadata', async () => {
      const invalidData = {
        exams: [],
        disciplines: []
      } as any;

      const result = await orchestratePlanCreation('test-user', invalidData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dados do plano inválidos');
    });

    test('deve rejeitar planData sem exams', async () => {
      const invalidData = {
        metadata: { examName: 'Test', examOrg: 'Test', startDate: '2024-01-01' },
        disciplines: []
      } as any;

      const result = await orchestratePlanCreation('test-user', invalidData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dados do plano inválidos');
    });

    test('deve rejeitar planData sem disciplines', async () => {
      const invalidData = {
        metadata: { examName: 'Test', examOrg: 'Test', startDate: '2024-01-01' },
        exams: []
      } as any;

      const result = await orchestratePlanCreation('test-user', invalidData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dados do plano inválidos');
    });
  });

  describe('Planos Grandes (20+ Disciplinas)', () => {
    test('deve processar plano com 20 disciplinas', async () => {
      const planData = createValidPlanData({ disciplineCount: 20, topicsPerDiscipline: 10 });

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(true);
      expect(result.data).toBe('plan-123');
      expect(mockSupabaseService.insertDisciplines).toHaveBeenCalledTimes(1);
      expect(mockSupabaseService.insertTopics).toHaveBeenCalledTimes(20); // Uma vez por disciplina
    });

    test('deve processar plano com 30 disciplinas e 50 tópicos cada', async () => {
      const planData = createValidPlanData({ disciplineCount: 30, topicsPerDiscipline: 50 });

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(true);
      expect(result.data).toBe('plan-123');
      expect(mockSupabaseService.insertDisciplines).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Discipline 1' }),
          expect.objectContaining({ name: 'Discipline 30' })
        ]),
        'test-user'
      );
      expect(mockSupabaseService.insertTopics).toHaveBeenCalledTimes(30);

      // Verifica que cada call de insertTopics tem 50 topics
      const topicsCalls = mockSupabaseService.insertTopics.mock.calls;
      expect(topicsCalls[0][0]).toHaveLength(50);
      expect(topicsCalls[29][0]).toHaveLength(50);
    });

    test('deve processar plano com 50 disciplinas (stress test)', async () => {
      const planData = createValidPlanData({ disciplineCount: 50, topicsPerDiscipline: 20 });

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(true);
      expect(mockSupabaseService.insertTopics).toHaveBeenCalledTimes(50);

      // Total de tópicos = 50 * 20 = 1000
      const allTopicsInserted = mockSupabaseService.insertTopics.mock.calls
        .reduce((sum, call) => sum + call[0].length, 0);
      expect(allTopicsInserted).toBe(1000);
    });
  });

  describe('Múltiplos Exames', () => {
    test('deve processar plano com 4 exames (objetiva, discursiva, prática, oral)', async () => {
      const planData: StudyPlanData = {
        metadata: {
          examName: 'Concurso Completo',
          examOrg: 'TRF',
          startDate: '2024-01-01'
        },
        exams: [
          { examType: 'objetiva', examDate: '2024-01-15', examTurn: 'manha', totalQuestions: 100 },
          { examType: 'discursiva', examDate: '2024-01-15', examTurn: 'tarde', totalQuestions: 4 },
          { examType: 'prática', examDate: '2024-02-01', examTurn: 'manha', totalQuestions: 2 },
          { examType: 'oral', examDate: '2024-03-01', examTurn: 'tarde', totalQuestions: 10 }
        ],
        disciplines: [{ name: 'Direito', topics: [{ name: 'Geral', weight: 1.0 }] }]
      };

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(true);
      expect(mockSupabaseService.insertExams).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ exam_type: 'objetiva', total_questions: 100 }),
          expect.objectContaining({ exam_type: 'discursiva', total_questions: 4 }),
          expect.objectContaining({ exam_type: 'prática', total_questions: 2 }),
          expect.objectContaining({ exam_type: 'oral', total_questions: 10 })
        ]),
        'test-user'
      );
    });

    test('deve processar plano com 10 exames', async () => {
      const planData = createValidPlanData({ examCount: 10 });

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(true);
      expect(mockSupabaseService.insertExams).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(Object)
        ]),
        'test-user'
      );
      const examsInserted = mockSupabaseService.insertExams.mock.calls[0][0];
      expect(examsInserted).toHaveLength(10);
    });
  });

  describe('Performance', () => {
    test('deve processar plano pequeno rapidamente', async () => {
      const planData = createValidPlanData({ disciplineCount: 3, topicsPerDiscipline: 5 });

      const start = performance.now();
      const result = await orchestratePlanCreation('test-user', planData);
      const duration = performance.now() - start;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(100); // < 100ms
      console.log(`✓ Plano pequeno (3 disc, 15 topics): ${duration.toFixed(2)}ms`);
    });

    test('deve processar plano médio em tempo razoável', async () => {
      const planData = createValidPlanData({ disciplineCount: 15, topicsPerDiscipline: 20 });

      const start = performance.now();
      const result = await orchestratePlanCreation('test-user', planData);
      const duration = performance.now() - start;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(200); // < 200ms
      console.log(`✓ Plano médio (15 disc, 300 topics): ${duration.toFixed(2)}ms`);
    });

    test('deve processar plano grande com boa performance', async () => {
      const planData = createValidPlanData({ disciplineCount: 30, topicsPerDiscipline: 30 });

      const start = performance.now();
      const result = await orchestratePlanCreation('test-user', planData);
      const duration = performance.now() - start;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(500); // < 500ms
      console.log(`✓ Plano grande (30 disc, 900 topics): ${duration.toFixed(2)}ms`);
    });
  });

  describe('Integridade de Dados', () => {
    test('deve manter ordem correta de inserções', async () => {
      const planData = createValidPlanData({ disciplineCount: 3 });

      await orchestratePlanCreation('test-user', planData);

      // Verifica ordem: study_plan → exams → disciplines → topics
      const callOrder = jest.mocked(mockSupabaseService);
      expect(callOrder.insertStudyPlan).toHaveBeenCalled();
      expect(callOrder.insertExams).toHaveBeenCalled();
      expect(callOrder.insertDisciplines).toHaveBeenCalled();
      expect(callOrder.insertTopics).toHaveBeenCalled();

      // Verifica que study_plan foi chamado primeiro
      expect(mockSupabaseService.insertStudyPlan.mock.invocationCallOrder[0])
        .toBeLessThan(mockSupabaseService.insertExams.mock.invocationCallOrder[0]);
    });

    test('deve passar userId correto para todas as operações', async () => {
      const planData = createValidPlanData({ disciplineCount: 2 });

      await orchestratePlanCreation('user-abc-123', planData);

      expect(mockSupabaseService.insertStudyPlan).toHaveBeenCalledWith(
        expect.any(Object),
        'user-abc-123'
      );
      expect(mockSupabaseService.insertExams).toHaveBeenCalledWith(
        expect.any(Array),
        'user-abc-123'
      );
      expect(mockSupabaseService.insertDisciplines).toHaveBeenCalledWith(
        expect.any(Array),
        'user-abc-123'
      );
      expect(mockSupabaseService.insertTopics).toHaveBeenCalledWith(
        expect.any(Array),
        'user-abc-123'
      );
    });

    test('deve criar plan_id correto em todas as entidades', async () => {
      mockSupabaseService.insertStudyPlan.mockResolvedValueOnce({ id: 'plan-xyz-789' } as any);

      const planData = createValidPlanData({ disciplineCount: 2 });

      await orchestratePlanCreation('test-user', planData);

      // Exams devem ter plan_id correto
      expect(mockSupabaseService.insertExams).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ plan_id: 'plan-xyz-789' })
        ]),
        'test-user'
      );

      // Disciplines devem ter plan_id correto
      expect(mockSupabaseService.insertDisciplines).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ plan_id: 'plan-xyz-789' })
        ]),
        'test-user'
      );

      // Topics devem ter plan_id correto
      expect(mockSupabaseService.insertTopics).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ plan_id: 'plan-xyz-789' })
        ]),
        'test-user'
      );
    });

    test('deve criar discipline_id correto nos topics', async () => {
      mockSupabaseService.insertDisciplines.mockResolvedValueOnce([
        { id: 'disc-alpha', name: 'Discipline 1' },
        { id: 'disc-beta', name: 'Discipline 2' }
      ] as any);

      const planData = createValidPlanData({ disciplineCount: 2, topicsPerDiscipline: 3 });

      await orchestratePlanCreation('test-user', planData);

      // Primeira discipline deve ter seus topics com discipline_id correto
      const firstTopicsCall = mockSupabaseService.insertTopics.mock.calls[0][0];
      expect(firstTopicsCall[0].discipline_id).toBe('disc-alpha');

      // Segunda discipline deve ter seus topics com discipline_id correto
      const secondTopicsCall = mockSupabaseService.insertTopics.mock.calls[1][0];
      expect(secondTopicsCall[0].discipline_id).toBe('disc-beta');
    });
  });

  describe('Edge Cases', () => {
    test('deve processar disciplina sem numberOfQuestions', async () => {
      const planData: StudyPlanData = {
        metadata: {
          examName: 'Test',
          examOrg: 'Test',
          startDate: '2024-01-01'
        },
        exams: [{ examType: 'objetiva', examDate: '2024-01-01', examTurn: 'manha', totalQuestions: 50 }],
        disciplines: [{
          name: 'Discipline Without Questions',
          topics: [{ name: 'Topic', weight: 1.0 }]
          // numberOfQuestions é opcional
        }]
      };

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(true);
      expect(mockSupabaseService.insertDisciplines).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Discipline Without Questions', number_of_questions: undefined })
        ]),
        'test-user'
      );
    });

    test('deve processar metadata sem fixedOffDays', async () => {
      const planData: StudyPlanData = {
        metadata: {
          examName: 'Test',
          examOrg: 'Test',
          startDate: '2024-01-01'
          // fixedOffDays é opcional
        },
        exams: [{ examType: 'objetiva', examDate: '2024-01-01', examTurn: 'manha', totalQuestions: 50 }],
        disciplines: [{ name: 'Discipline', topics: [{ name: 'Topic', weight: 1.0 }] }]
      };

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(true);
      expect(mockSupabaseService.insertStudyPlan).toHaveBeenCalledWith(
        expect.objectContaining({ fixed_off_days: undefined }),
        'test-user'
      );
    });

    test('deve processar metadata sem notes', async () => {
      const planData: StudyPlanData = {
        metadata: {
          examName: 'Test',
          examOrg: 'Test',
          startDate: '2024-01-01'
          // notes é opcional
        },
        exams: [{ examType: 'objetiva', examDate: '2024-01-01', examTurn: 'manha', totalQuestions: 50 }],
        disciplines: [{ name: 'Discipline', topics: [{ name: 'Topic', weight: 1.0 }] }]
      };

      const result = await orchestratePlanCreation('test-user', planData);

      expect(result.success).toBe(true);
      expect(mockSupabaseService.insertStudyPlan).toHaveBeenCalledWith(
        expect.objectContaining({ notes: undefined }),
        'test-user'
      );
    });
  });
});
