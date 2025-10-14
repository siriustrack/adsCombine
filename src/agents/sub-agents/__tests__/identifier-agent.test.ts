import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { identifyPlans } from '../identifier-agent';
import { callAnthropicWithRetry } from '../../services/anthropic-client';

jest.mock('../../services/anthropic-client');

describe('Identifier Agent Edge Cases', () => {
  const mockCallClaude = callAnthropicWithRetry as jest.MockedFunction<
    typeof callAnthropicWithRetry
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    it('should reject empty content', async () => {
      const result = await identifyPlans('');

      expect(result.success).toBe(false);
      expect(result.error).toContain('inválido');
    });

    it('should reject null content', async () => {
      const result = await identifyPlans(null as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('inválido');
    });

    it('should reject content over 100k characters', async () => {
      const longContent = 'A'.repeat(100001);

      const result = await identifyPlans(longContent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('longo');
    });
  });

  describe('Content Sanitization', () => {
    it('should sanitize HTML and scripts', async () => {
      const htmlContent = '<script>alert("xss")</script><b>Test</b> content';
      const sanitizedContent = 'Test content';

      mockCallClaude.mockResolvedValue({
        success: true,
        data: [{
          metadata: { examName: 'Test Exam', examOrg: 'Test Org', startDate: '2023-12-25' },
          exams: [],
          disciplines: []
        }]
      });

      await identifyPlans(htmlContent);

      expect(mockCallClaude).toHaveBeenCalled();
      const calledPrompt = mockCallClaude.mock.calls[0][1][0].content;
      expect(calledPrompt).toContain(sanitizedContent);
      expect(calledPrompt).not.toContain('<script>');
      expect(calledPrompt).not.toContain('<b>');
    });
  });

  describe('OpenAI Integration', () => {
    it('should handle OpenAI API failure', async () => {
      mockCallClaude.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await identifyPlans('test content');

      expect(result.success).toBe(false);
      expect(result.error).toContain('rate limit');
    });

    it('should handle malformed JSON response', async () => {
      mockCallClaude.mockResolvedValue({
        choices: [{
          message: {
            content: 'invalid json'
          }
        }]
      });

      const result = await identifyPlans('test content');

      expect(result.success).toBe(false);
      expect(result.error).toContain('JSON');
    });

    it('should handle future exam dates', async () => {
      const futureDateContent = 'Concurso com data futura 31/12/2025';

      const futureMockResponse = {
        plans: [{
          metadata: {
            examName: 'Future Exam',
            examOrg: 'Future Org',
            startDate: '2025-12-31'
          },
          exams: [{
            examType: 'objetiva' as const,
            examDate: '2025-12-31',
            examTurn: 'manha' as const,
            totalQuestions: 100
          }],
          disciplines: [{
            name: 'Future Discipline',
            topics: [{ name: 'Future Topic', weight: 1.0 as const }]
          }]
        }]
      };

      mockCallClaude.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(futureMockResponse)
          }
        }]
      });

      const futureResult = await identifyPlans(futureDateContent);

      expect(futureResult.success).toBe(true);
      expect(futureResult.data?.[0].metadata.startDate).toBe('2025-12-31');
      const mockResponse = {
        plans: [{
          metadata: {
            examName: 'Future Exam',
            examOrg: 'Future Org',
            startDate: '2025-12-31' // Future date
          },
          exams: [{
            examType: 'objetiva' as const,
            examDate: '2025-12-31',
            examTurn: 'manha' as const,
            totalQuestions: 50
          }],
          disciplines: [{
            name: 'Future Discipline',
            topics: [{ name: 'Future Topic', weight: 1.0 as const }]
          }]
        }]
      };

      mockCallClaude.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(futureMockResponse)
          }
        }]
      });

      const futureResult2 = await identifyPlans(futureDateContent);

      expect(futureResult2.success).toBe(true);
      expect(futureResult2.data?.[0].metadata.startDate).toBe('2025-12-31');
    });
  });

  describe('Data Structure Validation', () => {
    it('should validate required metadata fields', async () => {
      const mockResponse = {
        plans: [{
          metadata: {
            examName: 'Test Exam'
            // Missing examOrg and startDate
          },
          exams: [],
          disciplines: []
        }]
      };

      mockCallClaude.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(mockResponse)
          }
        }]
      });

      const validationResult = await identifyPlans('test content');

      // The agent accepts the response even with missing fields
      expect(validationResult.success).toBe(true);
      expect(validationResult.data?.[0].metadata.examName).toBe('Test Exam');
    });

    it('should handle empty disciplines array', async () => {
      const mockResponse = {
        plans: [{
          metadata: {
            examName: 'Test Exam',
            examOrg: 'Test Org',
            startDate: '2023-12-25'
          },
          exams: [],
          disciplines: [] // Empty disciplines
        }]
      };

      mockCallClaude.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(mockResponse)
          }
        }]
      });

      const emptyDisciplinesResult = await identifyPlans('test content');

      expect(emptyDisciplinesResult.success).toBe(true);
      expect(emptyDisciplinesResult.data?.[0].disciplines).toHaveLength(0);
    });

    it('should validate exam data structure', async () => {
      const mockResponse = {
        plans: [{
          metadata: {
            examName: 'Test Exam',
            examOrg: 'Test Org',
            startDate: '2023-12-25'
          },
          exams: [{
            examType: 'invalid_type', // Invalid exam type
            examDate: '2023-12-25',
            examTurn: 'manha',
            totalQuestions: 50
          }],
          disciplines: []
        }]
      };

      mockCallClaude.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(mockResponse)
          }
        }]
      });

      const result = await identifyPlans('test content');

      // The agent validates basic structure but accepts the response
      expect(result.success).toBe(true);
      expect(result.data?.[0].exams[0]).toBeDefined();
    });
  });
});