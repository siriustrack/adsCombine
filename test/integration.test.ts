import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createStudyPlan } from '../src/agents/index';

jest.mock('../src/agents/sub-agents/pre-orchestrator', () => ({
  preOrchestrate: jest.fn(),
}));

jest.mock('../src/agents/sub-agents/orchestrator-agent', () => ({
  orchestratePlanCreation: jest.fn(),
}));

jest.mock('../src/agents/sub-agents/verifier-agent', () => ({
  verifyAndFinalize: jest.fn(),
}));

import { preOrchestrate } from '../src/agents/sub-agents/pre-orchestrator';
import { orchestratePlanCreation } from '../src/agents/sub-agents/orchestrator-agent';
import { verifyAndFinalize } from '../src/agents/sub-agents/verifier-agent';

describe('Study Plan Creation Integration', () => {
  const mockPreOrchestrate = preOrchestrate as jest.MockedFunction<typeof preOrchestrate>;
  const mockOrchestratePlanCreation = orchestratePlanCreation as jest.MockedFunction<typeof orchestratePlanCreation>;
  const mockVerifyAndFinalize = verifyAndFinalize as jest.MockedFunction<typeof verifyAndFinalize>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create study plan successfully', async () => {
    const input = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      content: 'Test exam content'
    };

    const preOrchestrateResponse = {
      success: true,
      data: [{
        metadata: { examName: 'Test Exam', examOrg: 'Test Org', startDate: '2023-12-25' },
        exams: [],
        disciplines: []
      }]
    };

    const orchestrateResponse = {
      success: true,
      data: 'plan-123'
    };

    const verifyResponse = {
      success: true,
      data: true
    };

    mockPreOrchestrate.mockResolvedValue(preOrchestrateResponse);
    mockOrchestratePlanCreation.mockResolvedValue(orchestrateResponse);
    mockVerifyAndFinalize.mockResolvedValue(verifyResponse);

    const result = await createStudyPlan(input);

    expect(result.success).toBe(true);
    expect(result.data).toBe('plan-123');
    expect(mockPreOrchestrate).toHaveBeenCalledWith(input);
    expect(mockOrchestratePlanCreation).toHaveBeenCalled();
    expect(mockVerifyAndFinalize).toHaveBeenCalled();
  });

  it('should handle pre-orchestrator failure', async () => {
    const input = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      content: 'Test content'
    };

    mockPreOrchestrate.mockResolvedValue({
      success: false,
      error: 'Invalid content'
    });

    const result = await createStudyPlan(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid content');
    expect(mockOrchestratePlanCreation).not.toHaveBeenCalled();
    expect(mockVerifyAndFinalize).not.toHaveBeenCalled();
  });

  it('should handle orchestrator failure with rollback', async () => {
    const input = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      content: 'Test content'
    };

    const preOrchestrateResponse = {
      success: true,
      data: [{
        metadata: { examName: 'Test Exam', examOrg: 'Test Org', startDate: '2023-12-25' },
        exams: [],
        disciplines: []
      }]
    };

    mockPreOrchestrate.mockResolvedValue(preOrchestrateResponse);
    mockOrchestratePlanCreation.mockResolvedValue({
      success: false,
      error: 'Database error'
    });

    const result = await createStudyPlan(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Database error');
    expect(mockVerifyAndFinalize).not.toHaveBeenCalled();
  });

  it('should handle verifier failure', async () => {
    const input = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      content: 'Test content'
    };

    const preOrchestrateResponse = {
      success: true,
      data: [{
        metadata: { examName: 'Test Exam', examOrg: 'Test Org', startDate: '2023-12-25' },
        exams: [],
        disciplines: []
      }]
    };

    const orchestrateResponse = {
      success: true,
      data: 'plan-123'
    };

    mockPreOrchestrate.mockResolvedValue(preOrchestrateResponse);
    mockOrchestratePlanCreation.mockResolvedValue(orchestrateResponse);
    mockVerifyAndFinalize.mockResolvedValue({
      success: false,
      error: 'Verification failed'
    });

    const result = await createStudyPlan(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Verification failed');
  });

  it('should handle multiple plans in content', async () => {
    const input = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      content: 'Multiple plans content'
    };

    const preOrchestrateResponse = {
      success: true,
      data: [
        {
          metadata: { examName: 'Exam 1', examOrg: 'Org 1', startDate: '2023-12-25' },
          exams: [],
          disciplines: []
        },
        {
          metadata: { examName: 'Exam 2', examOrg: 'Org 2', startDate: '2023-12-26' },
          exams: [],
          disciplines: []
        }
      ]
    };

    mockPreOrchestrate.mockResolvedValue(preOrchestrateResponse);
    mockOrchestratePlanCreation.mockResolvedValue({
      success: true,
      data: 'plan-123'
    });
    mockVerifyAndFinalize.mockResolvedValue({
      success: true,
      data: true
    });

    const result = await createStudyPlan(input);

    expect(result.success).toBe(true);
    expect(mockOrchestratePlanCreation).toHaveBeenCalledTimes(1); // Currently processes only first plan
    expect(mockVerifyAndFinalize).toHaveBeenCalledTimes(1);
  });
});