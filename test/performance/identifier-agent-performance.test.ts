/**
 * Identifier Agent - Performance Tests
 * 
 * Testa performance do agente com diferentes tamanhos de conteúdo
 * e cenários de múltiplos planos.
 * 
 * Métricas:
 * - Latência por tamanho de conteúdo
 * - Throughput de processamento
 * - Degradação com aumento de conteúdo
 * - Consumo de memória
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { identifyPlans } from '../../src/agents/sub-agents/identifier-agent';
import { callOpenAIWithFallback } from '../../src/agents/services/openai-client';

jest.mock('../../src/agents/services/openai-client');

const mockCallOpenAI = callOpenAIWithFallback as jest.MockedFunction<typeof callOpenAIWithFallback>;

// Helper para criar mock response válido
function createMockResponse(planCount: number = 1) {
  const plans = Array.from({ length: planCount }, (_, i) => ({
    metadata: {
      examName: `Concurso Test ${i + 1}`,
      examOrg: `Org ${i + 1}`,
      startDate: '2024-01-01',
      fixedOffDays: ['sun'],
      notes: 'Test notes'
    },
    exams: [{
      examType: 'objetiva' as const,
      examDate: '2024-01-15',
      examTurn: 'manha' as const,
      totalQuestions: 50
    }],
    disciplines: [{
      name: `Disciplina ${i + 1}`,
      color: '#3B82F6',
      numberOfQuestions: 10,
      topics: [
        { name: `Tópico ${i + 1}.1`, weight: 1.0 as 1 | 1.5 | 2 },
        { name: `Tópico ${i + 1}.2`, weight: 1.5 as 1 | 1.5 | 2 }
      ]
    }]
  }));

  return { plans };
}

// Helper para criar conteúdo de teste
function createTestContent(sizeInChars: number): string {
  const baseContent = `
    CONCURSO PÚBLICO
    Edital de Abertura Nº 001/2024
    
    O Tribunal Regional Federal da 4ª Região torna público que realizará concurso público para o provimento de vagas.
    
    DISCIPLINAS E CONTEÚDO PROGRAMÁTICO:
    
    1. Direito Constitucional (20 questões)
    - Constitucionalismo e história constitucional do Brasil
    - Teoria geral dos direitos fundamentais
    - Controle de constitucionalidade
    - Organização do Estado brasileiro
    
    2. Direito Administrativo (15 questões)
    - Princípios da Administração Pública
    - Atos administrativos
    - Licitações e contratos
    - Serviços públicos
    
    3. Direito Civil (15 questões)
    - Parte geral do Código Civil
    - Obrigações e contratos
    - Direito das coisas
    - Direito de família
    
    CRONOGRAMA:
    Prova Objetiva: 30/04/2024 - Manhã - 100 questões
    Prova Discursiva: 17/06/2024 - Tarde - 4 questões
  `;

  // Repete o conteúdo até atingir o tamanho desejado
  const repetitions = Math.ceil(sizeInChars / baseContent.length);
  return baseContent.repeat(repetitions).slice(0, sizeInChars);
}

describe('Identifier Agent - Performance Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallOpenAI.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify(createMockResponse(1))
        }
      }]
    } as any);
  });

  describe('Latência por Tamanho de Conteúdo', () => {
    test('deve processar conteúdo de 10k caracteres em tempo razoável', async () => {
      const content = createTestContent(10000);
      const start = performance.now();

      const result = await identifyPlans(content);

      const duration = performance.now() - start;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // < 5s
      console.log(`✓ 10k chars: ${duration.toFixed(2)}ms`);
    });

    test('deve rejeitar conteúdo de 50k caracteres (excede tokens)', async () => {
      const content = createTestContent(50000);
      const start = performance.now();

      const result = await identifyPlans(content);

      const duration = performance.now() - start;

      expect(result.success).toBe(false);
      expect(result.error).toContain('tokens');
      expect(duration).toBeLessThan(100); // Validação rápida
      console.log(`✓ 50k chars rejection: ${duration.toFixed(2)}ms`);
    });

    test('deve rejeitar conteúdo > 100k caracteres', async () => {
      const content = createTestContent(100001);
      const start = performance.now();

      const result = await identifyPlans(content);

      const duration = performance.now() - start;

      expect(result.success).toBe(false);
      expect(result.error).toContain('longo');
      expect(duration).toBeLessThan(100); // Validação rápida
      console.log(`✓ Rejection (>100k): ${duration.toFixed(2)}ms`);
    });

    test('deve rejeitar conteúdo próximo ao limite (99k)', async () => {
      const content = createTestContent(99000);
      const start = performance.now();

      const result = await identifyPlans(content);

      const duration = performance.now() - start;

      expect(result.success).toBe(false);
      expect(result.error).toContain('tokens');
      expect(duration).toBeLessThan(100); // Validação rápida
      console.log(`✓ 99k chars rejection (tokens): ${duration.toFixed(2)}ms`);
    });
  });

  describe('Degradação de Performance', () => {
    test('deve manter degradação linear com aumento de conteúdo', async () => {
      const sizes = [1000, 5000, 10000, 25000];
      const timings: number[] = [];

      for (const size of sizes) {
        const content = createTestContent(size);
        const start = performance.now();
        await identifyPlans(content);
        const duration = performance.now() - start;
        timings.push(duration);
        console.log(`  ${size} chars: ${duration.toFixed(2)}ms`);
      }

      // Verifica que crescimento não é exponencial
      // (timing[3] / timing[0]) deve ser < (size[3] / size[0]) * 2
      const timeRatio = timings[3] / timings[0];
      const sizeRatio = sizes[3] / sizes[0];

      expect(timeRatio).toBeLessThan(sizeRatio * 2);
      console.log(`✓ Degradação: ${timeRatio.toFixed(2)}x para ${sizeRatio}x de conteúdo`);
    });
  });

  describe('Múltiplos Planos', () => {
    test('deve processar múltiplos planos no mesmo texto', async () => {
      const multiPlanContent = `
        CONCURSO 1: TRF4 - Juiz Federal
        Prova: 30/04/2024 - 100 questões
        Disciplinas: Direito Constitucional, Civil, Penal

        CONCURSO 2: TJSC - Juiz Estadual
        Prova: 15/05/2024 - 80 questões
        Disciplinas: Direito Processual Civil, Penal, Constitucional

        CONCURSO 3: MPF - Procurador
        Prova: 01/06/2024 - 120 questões
        Disciplinas: Direito Administrativo, Constitucional, Penal
      `;

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(createMockResponse(3))
          }
        }]
      } as any);

      const start = performance.now();
      const result = await identifyPlans(multiPlanContent);
      const duration = performance.now() - start;

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(duration).toBeLessThan(6000); // < 6s
      console.log(`✓ 3 planos: ${duration.toFixed(2)}ms`);
    });

    test('deve processar até 10 planos com conteúdo moderado', async () => {
      const content = createTestContent(8000); // Conteúdo dentro do limite de tokens

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(createMockResponse(10))
          }
        }]
      } as any);

      const start = performance.now();
      const result = await identifyPlans(content);
      const duration = performance.now() - start;

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(10);
      expect(duration).toBeLessThan(5000); // < 5s
      console.log(`✓ 10 planos: ${duration.toFixed(2)}ms`);
    });
  });

  describe('Consumo de Memória', () => {
    test('deve manter consumo de memória controlado com conteúdo grande', async () => {
      const content = createTestContent(80000);
      const memBefore = process.memoryUsage().heapUsed;

      await identifyPlans(content);

      const memAfter = process.memoryUsage().heapUsed;
      const memDelta = (memAfter - memBefore) / 1024 / 1024; // MB

      expect(memDelta).toBeLessThan(50); // < 50MB
      console.log(`✓ Memory delta: ${memDelta.toFixed(2)}MB`);
    });
  });

  describe('Throughput', () => {
    test('deve processar múltiplos requests em sequência', async () => {
      const content = createTestContent(5000);
      const iterations = 10;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await identifyPlans(content);
      }

      const duration = performance.now() - start;
      const throughput = (iterations / duration) * 1000; // requests/segundo

      expect(throughput).toBeGreaterThan(1); // > 1 request/segundo
      console.log(`✓ Throughput: ${throughput.toFixed(2)} requests/segundo`);
      console.log(`  (${duration.toFixed(2)}ms para ${iterations} requests)`);
    });
  });

  describe('Token Limit Validation', () => {
    test('deve rejeitar conteúdo que excede limite de tokens', async () => {
      // Cria conteúdo que resulta em ~4000 tokens (prompt + content)
      const largeContent = createTestContent(12000); // ~3000 tokens de conteúdo
      const start = performance.now();

      const result = await identifyPlans(largeContent);

      const duration = performance.now() - start;

      // Deve ser rejeitado por exceder limite de tokens
      expect(result.success).toBe(false);
      expect(result.error).toContain('tokens');
      expect(duration).toBeLessThan(100); // Validação rápida
      console.log(`✓ Token limit rejection: ${duration.toFixed(2)}ms`);
    });

    test('deve aceitar conteúdo dentro do limite de tokens', async () => {
      const content = createTestContent(8000); // ~2000 tokens
      const start = performance.now();

      const result = await identifyPlans(content);

      const duration = performance.now() - start;

      expect(result.success).toBe(true);
      console.log(`✓ Within token limit: ${duration.toFixed(2)}ms`);
    });
  });
});
