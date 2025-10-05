import { describe, i      const result = await orchestratePlanCreation('test-user', invalidData as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('inválidos');xpect, jest, beforeEach } from '@jest/globals';
import { orchestratePlanCreation } from '../orchestrator-agent';
import { SupabaseService } from '../../services/supabase-service';

jest.mock('../../services/supabase-service');

describe('Orchestrator Agent Edge Cases', () => {
  const mockSupabaseService = SupabaseService as jest.Mocked<typeof SupabaseService>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    it('should reject invalid plan data structure', async () => {
      const invalidData = {
        metadata: { examName: 'Test' },
        // Missing exams and disciplines
      } as any;

      const result = await orchestratePlanCreation('test-user', invalidData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('estrutura');
    });

    it('should reject empty disciplines', async () => {
      const dataWithEmptyDisciplines = {
        metadata: {
          examName: 'Test Exam',
          examOrg: 'Test Org',
          startDate: '2023-12-25'
        },
        exams: [],
        disciplines: [] // Empty disciplines
      };

      const result = await orchestratePlanCreation('test-user', dataWithEmptyDisciplines);

      expect(result.success).toBe(false);
      expect(result.error).toContain('disciplinas');
    });
  });

  describe('Database Operations', () => {
    it('should handle study plan insertion failure', async () => {
      const validData = {
        metadata: {
          examName: 'Test Exam',
          examOrg: 'Test Org',
          startDate: '2023-12-25'
        },
        exams: [{
          examType: 'objetiva' as const,
          examDate: '2023-12-25',
          examTurn: 'manha' as const,
          totalQuestions: 50
        }],
        disciplines: [{
          name: 'Test Discipline',
          topics: [{ name: 'Test Topic', weight: 1.0 as const }]
        }]
      };

      mockSupabaseService.insertStudyPlan.mockRejectedValue(new Error('DB connection failed'));

      const result = await orchestratePlanCreation('test-user', validData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('study_plan');
    });

    it('should handle exam insertion failure with rollback', async () => {
      const validData = {
        metadata: {
          examName: 'Test Exam',
          examOrg: 'Test Org',
          startDate: '2023-12-25'
        },
        exams: [{
          examType: 'objetiva' as const,
          examDate: '2023-12-25',
          examTurn: 'manha' as const,
          totalQuestions: 50
        }],
        disciplines: [{
          name: 'Test Discipline',
          topics: [{ name: 'Test Topic', weight: 1.0 as const }]
        }]
      };

      mockSupabaseService.insertStudyPlan.mockResolvedValue({ id: 'plan-123' });
      mockSupabaseService.insertExams.mockRejectedValue(new Error('Exam insertion failed'));

      const result = await orchestratePlanCreation('test-user', validData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('rollback');
      // Should attempt to delete the created study plan
    });

    it('should handle discipline insertion failure', async () => {
      const validData = {
        metadata: {
          examName: 'Test Exam',
          examOrg: 'Test Org',
          startDate: '2023-12-25'
        },
        exams: [{
          examType: 'objetiva' as const,
          examDate: '2023-12-25',
          examTurn: 'manha' as const,
          totalQuestions: 50
        }],
        disciplines: [{
          name: 'Test Discipline',
          topics: [{ name: 'Test Topic', weight: 1.0 as const }]
        }]
      };

      mockSupabaseService.insertStudyPlan.mockResolvedValue({ id: 'plan-123' });
      mockSupabaseService.insertExams.mockResolvedValue([{ id: 'exam-123' }]);
      mockSupabaseService.insertDisciplines.mockRejectedValue(new Error('Discipline insertion failed'));

      const result = await orchestratePlanCreation('test-user', validData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('disciplines');
    });
  });

  describe('Data Integrity', () => {
    it('should handle duplicate discipline names', async () => {
      const dataWithDuplicates = {
        metadata: {
          examName: 'Test Exam',
          examOrg: 'Test Org',
          startDate: '2023-12-25'
        },
        exams: [{
          examType: 'objetiva' as const,
          examDate: '2023-12-25',
          examTurn: 'manha' as const,
          totalQuestions: 50
        }],
        disciplines: [
          {
            name: 'Duplicate Discipline',
            topics: [{ name: 'Topic 1', weight: 1.0 as const }]
          },
          {
            name: 'Duplicate Discipline', // Duplicate name
            topics: [{ name: 'Topic 2', weight: 1.0 as const }]
          }
        ]
      };

      mockSupabaseService.insertStudyPlan.mockResolvedValue({ id: 'plan-123' });
      mockSupabaseService.insertExams.mockResolvedValue([{ id: 'exam-123' }]);
      mockSupabaseService.insertDisciplines.mockResolvedValue([
        { id: 'disc-1', name: 'Duplicate Discipline' },
        { id: 'disc-2', name: 'Duplicate Discipline' }
      ]);

      const result = await orchestratePlanCreation('test-user', dataWithDuplicates);

      expect(result.success).toBe(true);
      // Should handle duplicates gracefully (depending on DB constraints)
    });

    it('should validate topic weights', async () => {
      const dataWithInvalidWeights = {
        metadata: {
          examName: 'Test Exam',
          examOrg: 'Test Org',
          startDate: '2023-12-25'
        },
        exams: [{
          examType: 'objetiva' as const,
          examDate: '2023-12-25',
          examTurn: 'manha' as const,
          totalQuestions: 50
        }],
        disciplines: [{
          name: 'Test Discipline',
          topics: [
            { name: 'Topic 1', weight: 1.0 as const },
            { name: 'Topic 2', weight: 3.0 as any } // Invalid weight
          ]
        }]
      };

      const result = await orchestratePlanCreation('test-user', dataWithInvalidWeights);

      expect(result.success).toBe(false);
      expect(result.error).toContain('weight');
    });
  });

  describe('Large Data Sets', () => {
    it('should handle many disciplines and topics', async () => {
      const largeData = {
        metadata: {
          examName: 'Large Exam',
          examOrg: 'Large Org',
          startDate: '2023-12-25'
        },
        exams: [{
          examType: 'objetiva' as const,
          examDate: '2023-12-25',
          examTurn: 'manha' as const,
          totalQuestions: 100
        }],
        disciplines: Array.from({ length: 20 }, (_, i) => ({
          name: `Discipline ${i + 1}`,
          topics: Array.from({ length: 10 }, (_, j) => ({
            name: `Topic ${i + 1}-${j + 1}`,
            weight: (1.0 + Math.random() * 1) as 1.0 | 1.5 | 2.0 // Random weight
          }))
        }))
      };

      mockSupabaseService.insertStudyPlan.mockResolvedValue({ id: 'plan-123' });
      mockSupabaseService.insertExams.mockResolvedValue([{ id: 'exam-123' }]);
      mockSupabaseService.insertDisciplines.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({ id: `disc-${i + 1}`, name: `Discipline ${i + 1}` }))
      );

      const result = await orchestratePlanCreation('test-user', largeData);

      expect(result.success).toBe(true);
      expect(mockSupabaseService.insertDisciplines).toHaveBeenCalledWith(
        expect.any(Array),
        'test-user'
      );
    });
  });
});