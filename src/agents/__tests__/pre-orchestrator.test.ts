/**
 * TESTES DO PRE-ORCHESTRATOR REFATORADO
 * 
 * Testa a normalização de JSON hierárquico → estrutura flat
 * com os 7 editais reais extraídos.
 * 
 * Validações:
 * - Estrutura hierárquica achatada corretamente
 * - ENUMs inválidos filtrados
 * - Cores geradas automaticamente
 * - Constraints do database respeitados
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { preOrchestrate, type EditalJSON } from '../sub-agents/pre-orchestrator-refactored';

// ============================================================================
// HELPERS
// ============================================================================

const EDITAIS_DIR = join(process.cwd(), 'temp', 'editais-json');

async function loadEditalJSON(filename: string): Promise<EditalJSON> {
  const filePath = join(EDITAIS_DIR, filename);
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

const VALID_EXAM_TYPES = ['objetiva', 'discursiva', 'prática', 'oral'];
const VALID_TURNS = ['manha', 'tarde', 'noite'];
const HEX_COLOR_REGEX = /^#[0-9A-F]{6}$/i;

// ============================================================================
// TESTES COM EDITAL ENAC (Simples, 1 fase)
// ============================================================================

describe('Pre-Orchestrator - Edital ENAC', () => {
  let editalJSON: EditalJSON;
  
  beforeAll(async () => {
    editalJSON = await loadEditalJSON('edital ENAC.json');
  });

  test('deve carregar JSON do ENAC corretamente', () => {
    expect(editalJSON).toBeDefined();
    expect(editalJSON.concursos).toBeDefined();
    expect(editalJSON.concursos[0].metadata.examName).toContain('ENAC');
    expect(editalJSON.concursos[0].fases).toBeDefined();
    expect(editalJSON.concursos[0].fases.length).toBeGreaterThan(0);
  });

  test('deve normalizar estrutura hierárquica para flat', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'enac-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.disciplines).toBeDefined();
    expect(Array.isArray(result.data!.disciplines)).toBe(true);
    
    // Verificar que não tem grupos, apenas disciplinas
    const hasGrupos = result.data!.disciplines.some(d => 
      d.name.toLowerCase().includes('grupo')
    );
    expect(hasGrupos).toBe(false);
  });

  test('deve gerar cores para todas as disciplinas', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'enac-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    
    for (const discipline of result.data!.disciplines) {
      expect(discipline.color).toBeDefined();
      expect(HEX_COLOR_REGEX.test(discipline.color!)).toBe(true);
    }
  });

  test('deve gerar apenas 1 exam (PRIMARY KEY constraint)', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'enac-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    expect(result.data!.exams).toBeDefined();
    expect(result.data!.exams.length).toBe(1);
  });

  test('deve validar ENUMs de exam', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'enac-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    
    const exam = result.data!.exams[0];
    expect(VALID_EXAM_TYPES).toContain(exam.examType);
    expect(VALID_TURNS).toContain(exam.examTurn);
  });

  test('deve criar topics para cada discipline', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'enac-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    
    // Deve ter pelo menos uma disciplina com topics
    const disciplinesComTopics = result.data!.disciplines.filter(
      d => d.topics && d.topics.length > 0
    );
    expect(disciplinesComTopics.length).toBeGreaterThan(0);
    
    // Validar estrutura dos topics
    for (const discipline of disciplinesComTopics) {
      for (const topic of discipline.topics) {
        expect(topic.name).toBeDefined();
        expect(topic.weight).toBeDefined();
        expect([1.0, 1.5, 2.0]).toContain(topic.weight);
      }
    }
  });
});

// ============================================================================
// TESTES COM EDITAL ADVOGADO DA UNIÃO (Complexo, 6 fases)
// ============================================================================

describe('Pre-Orchestrator - Edital Advogado da União', () => {
  let editalJSON: EditalJSON;
  
  beforeAll(async () => {
    editalJSON = await loadEditalJSON('edital advogado da união.json');
  });

  test('deve carregar JSON do Advogado da União', () => {
    expect(editalJSON).toBeDefined();
    expect(editalJSON.concursos[0].metadata.examName).toContain('Advogado');
    expect(editalJSON.concursos[0].fases.length).toBeGreaterThanOrEqual(1);
  });

  test('deve filtrar fases inválidas (titulos, nao_especificado)', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'agu-2025';
    
    // Contar fases válidas no JSON original
    const fasesValidas = editalJSON.concursos[0].fases.filter(fase => {
      const tipo = fase.tipo.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return VALID_EXAM_TYPES.includes(tipo);
    });
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    expect(result.data!.exams.length).toBe(1); // Usa apenas primeira fase válida
    
    // Verificar que fase selecionada é válida
    const exam = result.data!.exams[0];
    expect(VALID_EXAM_TYPES).toContain(exam.examType);
  });

  test('deve normalizar turnos variados', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'agu-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    
    const exam = result.data!.exams[0];
    expect(VALID_TURNS).toContain(exam.examTurn);
  });

  test('deve processar todas disciplinas de múltiplas fases', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'agu-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    expect(result.data!.disciplines.length).toBeGreaterThan(0);
    
    // Todas devem ter cor
    for (const discipline of result.data!.disciplines) {
      expect(discipline.color).toBeDefined();
      expect(HEX_COLOR_REGEX.test(discipline.color!)).toBe(true);
    }
  });
});

// ============================================================================
// TESTES COM EDITAL CARTÓRIOS RS (Hierárquico profundo)
// ============================================================================

describe('Pre-Orchestrator - Edital Cartórios RS', () => {
  let editalJSON: EditalJSON;
  
  beforeAll(async () => {
    editalJSON = await loadEditalJSON('edital concurso cartórios rs.json');
  });

  test('deve carregar JSON do Cartórios RS', () => {
    expect(editalJSON).toBeDefined();
    expect(editalJSON.concursos[0].metadata.examName).toContain('Rio Grande do Sul');
    expect(editalJSON.concursos[0].fases).toBeDefined();
  });

  test('deve achatar estrutura com múltiplos grupos', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'cartorios-rs-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    
    // Contar matérias no JSON original
    let totalMaterias = 0;
    for (const disciplina of editalJSON.concursos[0].disciplinas) {
      if (disciplina.materias) {
        totalMaterias += disciplina.materias.length;
      } else if (disciplina.subtopicos) {
        totalMaterias += 1; // Disciplina simples
      }
    }
    
    // Deve ter achatado corretamente
    expect(result.data!.disciplines.length).toBe(totalMaterias);
  });

  test('deve preservar número de questões ao achatar', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'cartorios-rs-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    
    // Total de questões deve bater com metadata
    const totalQuestoes = editalJSON.concursos[0].metadata.totalQuestions;
    expect(result.data!.exams[0].totalQuestions).toBe(totalQuestoes);
  });

  test('deve gerar cores únicas para cada disciplina', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'cartorios-rs-2025';
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    
    const cores = new Set<string>();
    for (const discipline of result.data!.disciplines) {
      expect(discipline.color).toBeDefined();
      cores.add(discipline.color!);
    }
    
    // Deve haver pelo menos algumas cores diferentes (paleta de 10)
    expect(cores.size).toBeGreaterThan(1);
    expect(cores.size).toBeLessThanOrEqual(10); // Paleta definida
  });
});

// ============================================================================
// TESTES COM TODOS OS 7 EDITAIS
// ============================================================================

describe('Pre-Orchestrator - Todos os Editais', () => {
  const editais = [
    'edital ENAC.json',
    'edital mprs.json',
    'edital juiz sc.json',
    'edital oab.json',
    'edital prefeitura.json',
    'edital advogado da união.json',
    'edital concurso cartórios rs.json',
  ];

  test.each(editais)('deve processar %s sem erros', async (filename) => {
    const editalJSON = await loadEditalJSON(filename);
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = filename.replace('edital ', '').replace('.json', '');
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  test.each(editais)('deve gerar metadados para %s', async (filename) => {
    const editalJSON = await loadEditalJSON(filename);
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = filename.replace('edital ', '').replace('.json', '');
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata).toBeDefined();
    expect(result.data!.metadata.examName).toBeDefined();
    expect(result.data!.metadata.examOrg).toBeDefined();
    expect(result.data!.metadata.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test.each(editais)('deve ter apenas 1 exam para %s', async (filename) => {
    const editalJSON = await loadEditalJSON(filename);
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = filename.replace('edital ', '').replace('.json', '');
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    expect(result.data!.exams.length).toBe(1);
  });

  test.each(editais)('deve ter disciplinas com cores para %s', async (filename) => {
    const editalJSON = await loadEditalJSON(filename);
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = filename.replace('edital ', '').replace('.json', '');
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    expect(result.data!.disciplines.length).toBeGreaterThan(0);
    
    for (const discipline of result.data!.disciplines) {
      expect(discipline.color).toBeDefined();
      expect(HEX_COLOR_REGEX.test(discipline.color!)).toBe(true);
    }
  });

  test.each(editais)('deve ter topics com weights para %s', async (filename) => {
    const editalJSON = await loadEditalJSON(filename);
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = filename.replace('edital ', '').replace('.json', '');
    
    const result = await preOrchestrate(userId, editalId, editalJSON);
    
    expect(result.success).toBe(true);
    
    // Filtrar disciplinas com topics
    const disciplinesComTopics = result.data!.disciplines.filter(
      d => d.topics && d.topics.length > 0
    );
    
    expect(disciplinesComTopics.length).toBeGreaterThan(0);
    
    for (const discipline of disciplinesComTopics) {
      for (const topic of discipline.topics) {
        expect(topic.name).toBeDefined();
        expect(topic.weight).toBeDefined();
        expect(typeof topic.weight).toBe('number');
      }
    }
  });
});

// ============================================================================
// TESTES DE VALIDAÇÃO
// ============================================================================

describe('Pre-Orchestrator - Validações', () => {
  let editalJSON: EditalJSON;
  
  beforeAll(async () => {
    editalJSON = await loadEditalJSON('edital ENAC.json');
  });

  test('deve rejeitar userId inválido', async () => {
    const result = await preOrchestrate(
      'invalid-uuid',
      'test',
      editalJSON
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('UUID válido');
  });

  test('deve rejeitar editalId vazio', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    
    const result = await preOrchestrate(
      userId,
      '',
      editalJSON
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('editalId');
  });

  test('deve rejeitar JSON sem fases', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'test';
    const invalidJSON = {
      concursos: [{
        metadata: {
          examName: 'Test',
          examOrg: 'Test',
          startDate: '2025-01-01',
          totalQuestions: 100,
        },
        fases: [],
        disciplinas: []
      }]
    } as EditalJSON;
    
    const result = await preOrchestrate(userId, editalId, invalidJSON);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('pelo menos 1 fase');
  });

  test('deve rejeitar JSON com apenas fases inválidas', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const editalId = 'test';
    const invalidJSON = {
      concursos: [{
        metadata: {
          examName: 'Test',
          examOrg: 'Test',
          startDate: '2025-01-01',
          totalQuestions: 100,
        },
        fases: [{
          tipo: 'titulos',
          data: 'N/A',
          turno: 'N/A',
        }],
        disciplinas: []
      }]
    } as EditalJSON;
    
    const result = await preOrchestrate(userId, editalId, invalidJSON);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Nenhuma fase válida');
  });
});

// ============================================================================
// TESTES DE ESTATÍSTICAS
// ============================================================================

describe('Pre-Orchestrator - Estatísticas dos 7 Editais', () => {
  test('deve compilar estatísticas de todos os editais', async () => {
    const editais = [
      'edital ENAC.json',
      'edital mprs.json',
      'edital juiz sc.json',
      'edital oab.json',
      'edital prefeitura.json',
      'edital advogado da união.json',
      'edital concurso cartórios rs.json',
    ];

    const stats = {
      totalEditais: 0,
      totalDisciplines: 0,
      totalTopics: 0,
      totalQuestions: 0,
      editaisComSucesso: 0,
      editaisComErro: 0,
    };

    for (const filename of editais) {
      stats.totalEditais++;
      
      try {
        const editalJSON = await loadEditalJSON(filename);
        const userId = '123e4567-e89b-12d3-a456-426614174000';
        const editalId = filename.replace('edital ', '').replace('.json', '');
        
        const result = await preOrchestrate(userId, editalId, editalJSON);
        
        if (result.success) {
          stats.editaisComSucesso++;
          stats.totalDisciplines += result.data!.disciplines.length;
          stats.totalTopics += result.data!.disciplines.reduce(
            (sum, d) => sum + d.topics.length,
            0
          );
          stats.totalQuestions += result.data!.exams[0].totalQuestions;
        } else {
          stats.editaisComErro++;
        }
      } catch (error) {
        stats.editaisComErro++;
      }
    }

    // Log das estatísticas
    console.log('\n📊 ESTATÍSTICAS DOS 7 EDITAIS:');
    console.log('═══════════════════════════════════════');
    console.log(`Total de editais processados: ${stats.totalEditais}`);
    console.log(`✅ Sucessos: ${stats.editaisComSucesso}`);
    console.log(`❌ Erros: ${stats.editaisComErro}`);
    console.log(`📚 Total de disciplines: ${stats.totalDisciplines}`);
    console.log(`📖 Total de topics: ${stats.totalTopics}`);
    console.log(`❓ Total de questões: ${stats.totalQuestions}`);
    console.log('═══════════════════════════════════════\n');

    // Validações
    expect(stats.totalEditais).toBe(7);
    expect(stats.editaisComSucesso).toBe(7);
    expect(stats.editaisComErro).toBe(0);
    expect(stats.totalDisciplines).toBeGreaterThan(0);
    expect(stats.totalTopics).toBeGreaterThan(0);
    expect(stats.totalQuestions).toBeGreaterThan(0);
  });
});
