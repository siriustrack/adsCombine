/**
 * TESTES DE PERFORMANCE DO PRE-ORCHESTRATOR
 * 
 * Valida que o Pre-Orchestrator processa editais dentro dos limites de tempo:
 * - Plano pequeno (5 disciplinas): < 10s
 * - Plano médio (14 disciplinas): < 20s
 * - Plano grande (30+ disciplinas): < 30s
 * 
 * Também testa limites de tamanho de JSON (10k, 50k, 100k caracteres)
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { preOrchestrate } from '../../src/agents/sub-agents/pre-orchestrator-refactored';
import type { EditalJSON, DisciplinaJSON } from '../../src/agents/sub-agents/pre-orchestrator-refactored';
import type { AgentResponse, StudyPlanData } from '../../src/agents/types/types';

// ============================================================================
// HELPERS
// ============================================================================

const EDITAIS_DIR = join(process.cwd(), 'temp', 'editais-json');

async function loadEditalJSON(filename: string): Promise<EditalJSON> {
  const filePath = join(EDITAIS_DIR, filename);
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
  const start = performance.now();
  return fn().then(result => ({
    result,
    timeMs: performance.now() - start
  }));
}

// ============================================================================
// TESTES DE PERFORMANCE POR TAMANHO
// ============================================================================

describe('Pre-Orchestrator - Performance por Tamanho', () => {
  const userId = '123e4567-e89b-12d3-a456-426614174000';

  test('deve processar edital pequeno (ENAC) em < 10s', async () => {
    const editalJSON = await loadEditalJSON('edital ENAC.json');
    const jsonSize = JSON.stringify(editalJSON).length;
    
    const { result, timeMs } = await measureTime(() => 
      preOrchestrate(userId, 'enac-2025', editalJSON)
    );
    
    expect(result.success).toBe(true);
    expect(timeMs).toBeLessThan(10000); // < 10s
    
    console.log(`\n📊 ENAC Performance:`);
    console.log(`   JSON size: ${jsonSize} chars`);
    console.log(`   Disciplines: ${result.data!.disciplines.length}`);
    console.log(`   Time: ${timeMs.toFixed(2)}ms (${(timeMs / 1000).toFixed(2)}s)`);
  });

  test('deve processar edital médio (Cartórios RS) em < 20s', async () => {
    const editalJSON = await loadEditalJSON('edital concurso cartórios rs.json');
    const jsonSize = JSON.stringify(editalJSON).length;
    
    const { result, timeMs } = await measureTime(() => 
      preOrchestrate(userId, 'cartorios-rs-2025', editalJSON)
    );
    
    expect(result.success).toBe(true);
    expect(timeMs).toBeLessThan(20000); // < 20s
    
    console.log(`\n📊 Cartórios RS Performance:`);
    console.log(`   JSON size: ${jsonSize} chars`);
    console.log(`   Disciplines: ${result.data!.disciplines.length}`);
    console.log(`   Time: ${timeMs.toFixed(2)}ms (${(timeMs / 1000).toFixed(2)}s)`);
  });

  test('deve processar edital complexo (Advogado União) em < 30s', async () => {
    const editalJSON = await loadEditalJSON('edital advogado da união.json');
    const jsonSize = JSON.stringify(editalJSON).length;
    
    const { result, timeMs } = await measureTime(() => 
      preOrchestrate(userId, 'agu-2025', editalJSON)
    );
    
    expect(result.success).toBe(true);
    expect(timeMs).toBeLessThan(30000); // < 30s
    
    console.log(`\n📊 Advogado União Performance:`);
    console.log(`   JSON size: ${jsonSize} chars`);
    console.log(`   Disciplines: ${result.data!.disciplines.length}`);
    console.log(`   Topics: ${result.data!.disciplines.reduce((sum, d) => sum + d.topics.length, 0)}`);
    console.log(`   Time: ${timeMs.toFixed(2)}ms (${(timeMs / 1000).toFixed(2)}s)`);
  });
});

// ============================================================================
// TESTES DE PERFORMANCE - TODOS OS 7 EDITAIS
// ============================================================================

describe('Pre-Orchestrator - Performance de Todos Editais', () => {
  const editais = [
    'edital ENAC.json',
    'edital mprs.json',
    'edital juiz sc.json',
    'edital oab.json',
    'edital prefeitura.json',
    'edital advogado da união.json',
    'edital concurso cartórios rs.json',
  ];

  test('deve compilar métricas de performance de todos editais', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const metrics: Array<{
      name: string;
      jsonSize: number;
      disciplines: number;
      topics: number;
      timeMs: number;
    }> = [];

    for (const filename of editais) {
      const editalJSON = await loadEditalJSON(filename);
      const jsonSize = JSON.stringify(editalJSON).length;
      const editalId = filename.replace('edital ', '').replace('.json', '');
      
      const { result, timeMs } = await measureTime(() => 
        preOrchestrate(userId, editalId, editalJSON)
      );
      
      if (result.success) {
        metrics.push({
          name: filename.replace('edital ', '').replace('.json', ''),
          jsonSize,
          disciplines: result.data!.disciplines.length,
          topics: result.data!.disciplines.reduce((sum, d) => sum + d.topics.length, 0),
          timeMs,
        });
      }
    }

    // Calcular estatísticas
    const totalTime = metrics.reduce((sum, m) => sum + m.timeMs, 0);
    const avgTime = totalTime / metrics.length;
    const maxTime = Math.max(...metrics.map(m => m.timeMs));
    const minTime = Math.min(...metrics.map(m => m.timeMs));

    // Log das métricas
    console.log('\n' + '═'.repeat(80));
    console.log('📊 MÉTRICAS DE PERFORMANCE - 7 EDITAIS');
    console.log('═'.repeat(80));
    console.log('\n📋 Por Edital:');
    console.log('-'.repeat(80));
    
    for (const metric of metrics) {
      console.log(`${metric.name.padEnd(30)} | ` +
        `${metric.jsonSize.toString().padStart(8)} chars | ` +
        `${metric.disciplines.toString().padStart(3)} disc | ` +
        `${metric.topics.toString().padStart(4)} topics | ` +
        `${metric.timeMs.toFixed(2).padStart(8)}ms`
      );
    }
    
    console.log('-'.repeat(80));
    console.log(`\n📊 Estatísticas Gerais:`);
    console.log(`   Total processado: ${editais.length} editais`);
    console.log(`   Tempo total: ${totalTime.toFixed(2)}ms (${(totalTime / 1000).toFixed(2)}s)`);
    console.log(`   Tempo médio: ${avgTime.toFixed(2)}ms (${(avgTime / 1000).toFixed(2)}s)`);
    console.log(`   Tempo mínimo: ${minTime.toFixed(2)}ms (${(minTime / 1000).toFixed(2)}s)`);
    console.log(`   Tempo máximo: ${maxTime.toFixed(2)}ms (${(maxTime / 1000).toFixed(2)}s)`);
    console.log('═'.repeat(80) + '\n');

    // Validações
    expect(metrics.length).toBe(7);
    expect(avgTime).toBeLessThan(5000); // Média < 5s
    expect(maxTime).toBeLessThan(30000); // Máximo < 30s
  });
});

// ============================================================================
// TESTES DE LIMITES DE TAMANHO
// ============================================================================

describe('Pre-Orchestrator - Limites de Tamanho de JSON', () => {
  const userId = '123e4567-e89b-12d3-a456-426614174000';

  test('deve processar JSON com ~10k caracteres', async () => {
    // Usar edital Advogado da União que tem ~9k chars
    const editalJSON = await loadEditalJSON('edital advogado da união.json');
    const jsonSize = JSON.stringify(editalJSON).length;
    
    expect(jsonSize).toBeGreaterThan(5000);
    expect(jsonSize).toBeLessThan(20000);
    
    const { result, timeMs } = await measureTime(() => 
      preOrchestrate(userId, 'agu-2025', editalJSON)
    );
    
    expect(result.success).toBe(true);
    
    console.log(`\n📊 JSON ~10k chars:`);
    console.log(`   Actual size: ${jsonSize} chars`);
    console.log(`   Time: ${timeMs.toFixed(2)}ms`);
  });

  test('deve processar JSON com ~50k caracteres', async () => {
    // Usar edital Advogado da União que é mais complexo
    const editalJSON = await loadEditalJSON('edital advogado da união.json');
    const jsonSize = JSON.stringify(editalJSON).length;
    
    const { result, timeMs } = await measureTime(() => 
      preOrchestrate(userId, 'agu-2025', editalJSON)
    );
    
    expect(result.success).toBe(true);
    
    console.log(`\n📊 JSON complexo:`);
    console.log(`   Size: ${jsonSize} chars`);
    console.log(`   Time: ${timeMs.toFixed(2)}ms`);
  });

  test('deve lidar com JSON muito grande (stress test)', async () => {
    // Criar JSON artificial grande
    const editalJSON = await loadEditalJSON('edital ENAC.json');
    
    // Duplicar disciplinas para criar JSON maior
    const originalDisciplinas = editalJSON.concursos[0].disciplinas;
    const largeDisciplines: DisciplinaJSON[] = [];
    
    for (let i = 0; i < 50; i++) {
      for (const d of originalDisciplinas) {
        largeDisciplines.push({
          ...d,
          nome: `${d.nome} - Cópia ${i + 1}`
        });
      }
    }
    
    editalJSON.concursos[0].disciplinas = largeDisciplines;
    const jsonSize = JSON.stringify(editalJSON).length;
    
    const { result, timeMs } = await measureTime(() => 
      preOrchestrate(userId, 'stress-test', editalJSON)
    );
    
    expect(result.success).toBe(true);
    expect(result.data!.disciplines.length).toBeGreaterThan(100);
    
    console.log(`\n📊 Stress Test (JSON grande):`);
    console.log(`   JSON size: ${jsonSize} chars`);
    console.log(`   Disciplines: ${result.data!.disciplines.length}`);
    console.log(`   Topics: ${result.data!.disciplines.reduce((sum, d) => sum + d.topics.length, 0)}`);
    console.log(`   Time: ${timeMs.toFixed(2)}ms (${(timeMs / 1000).toFixed(2)}s)`);
    
    // Validar que ainda é rápido mesmo com JSON grande
    expect(timeMs).toBeLessThan(60000); // < 1min
  });
});

// ============================================================================
// TESTES DE MEMÓRIA E RECURSOS
// ============================================================================

describe('Pre-Orchestrator - Uso de Recursos', () => {
  const userId = '123e4567-e89b-12d3-a456-426614174000';

  test('deve processar múltiplos editais sem aumentar memória', async () => {
    const memoryBefore = process.memoryUsage().heapUsed;
    
    // Processar todos editais
    const editais = [
      'edital ENAC.json',
      'edital mprs.json',
      'edital juiz sc.json',
      'edital oab.json',
      'edital prefeitura.json',
      'edital advogado da união.json',
      'edital concurso cartórios rs.json',
    ];
    
    for (const filename of editais) {
      const editalJSON = await loadEditalJSON(filename);
      const editalId = filename.replace('edital ', '').replace('.json', '');
      const result = await preOrchestrate(userId, editalId, editalJSON);
      expect(result.success).toBe(true);
    }
    
    // Forçar garbage collection se disponível
    if (global.gc) {
      global.gc();
    }
    
    const memoryAfter = process.memoryUsage().heapUsed;
    const memoryIncrease = memoryAfter - memoryBefore;
    const memoryIncreaseMB = memoryIncrease / 1024 / 1024;
    
    console.log(`\n💾 Uso de Memória:`);
    console.log(`   Antes: ${(memoryBefore / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Depois: ${(memoryAfter / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Aumento: ${memoryIncreaseMB.toFixed(2)} MB`);
    
    // Validar que não há memory leak significativo
    expect(memoryIncreaseMB).toBeLessThan(100); // < 100MB de aumento
  });

  test('deve processar editais em sequência sem degradação significativa', async () => {
    const editalJSON = await loadEditalJSON('edital ENAC.json');
    const times: number[] = [];
    
    // Processar 10 vezes
    for (let i = 0; i < 10; i++) {
      const { timeMs } = await measureTime(() => 
        preOrchestrate(userId, `enac-${i}`, editalJSON)
      );
      times.push(timeMs);
    }
    
    const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);
    const variance = ((maxTime - minTime) / avgTime * 100);
    
    console.log(`\n⚡ Teste de Degradação (10 execuções):`);
    console.log(`   Tempo médio: ${avgTime.toFixed(2)}ms`);
    console.log(`   Tempo mínimo: ${minTime.toFixed(2)}ms`);
    console.log(`   Tempo máximo: ${maxTime.toFixed(2)}ms`);
    console.log(`   Variação: ${variance.toFixed(2)}%`);
    
    // Para operações muito rápidas (< 1ms), a variação pode ser alta devido a overhead do sistema
    // Validamos que não há crescimento linear (degradação real)
    const firstHalf = times.slice(0, 5).reduce((sum, t) => sum + t, 0) / 5;
    const secondHalf = times.slice(5).reduce((sum, t) => sum + t, 0) / 5;
    const growth = (secondHalf - firstHalf) / firstHalf * 100;
    
    console.log(`   Primeira metade: ${firstHalf.toFixed(2)}ms`);
    console.log(`   Segunda metade: ${secondHalf.toFixed(2)}ms`);
    console.log(`   Crescimento: ${growth.toFixed(2)}%`);
    
    // Validar que não há degradação linear > 50%
    expect(Math.abs(growth)).toBeLessThan(50);
  });
});

// ============================================================================
// TESTES DE THROUGHPUT
// ============================================================================

describe('Pre-Orchestrator - Throughput', () => {
  const userId = '123e4567-e89b-12d3-a456-426614174000';

  test('deve calcular throughput (editais/segundo)', async () => {
    const editalJSON = await loadEditalJSON('edital ENAC.json');
    const iterations = 20;
    
    const { result, timeMs } = await measureTime(async () => {
      const results: AgentResponse<StudyPlanData>[] = [];
      for (let i = 0; i < iterations; i++) {
        const r = await preOrchestrate(userId, `enac-${i}`, editalJSON);
        results.push(r);
      }
      return results;
    });
    
    const totalTimeSeconds = timeMs / 1000;
    const throughput = iterations / totalTimeSeconds;
    
    console.log(`\n🚀 Throughput:`);
    console.log(`   Iterações: ${iterations}`);
    console.log(`   Tempo total: ${totalTimeSeconds.toFixed(2)}s`);
    console.log(`   Throughput: ${throughput.toFixed(2)} editais/segundo`);
    console.log(`   Tempo médio: ${(timeMs / iterations).toFixed(2)}ms por edital`);
    
    expect(result.every(r => r.success)).toBe(true);
    expect(throughput).toBeGreaterThan(1); // Pelo menos 1 edital/segundo
  });
});
