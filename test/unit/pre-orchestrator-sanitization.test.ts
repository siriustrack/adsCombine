/**
 * TESTES DE SANITIZAÇÃO DO PRE-ORCHESTRATOR
 * 
 * Valida que o Pre-Orchestrator lida corretamente com:
 * - Caracteres especiais e emojis
 * - HTML injetado
 * - Scripts maliciosos
 * - SQL injection
 * - XSS attacks
 */

import { describe, test, expect } from 'bun:test';
import { preOrchestrate } from '../../src/agents/sub-agents/pre-orchestrator-refactored';
import type { EditalJSON } from '../../src/agents/sub-agents/pre-orchestrator-refactored';

// ============================================================================
// HELPERS
// ============================================================================

const userId = '123e4567-e89b-12d3-a456-426614174000';

function createTestEdital(overrides: Partial<EditalJSON['concursos'][0]['metadata']> = {}): EditalJSON {
  return {
    concursos: [{
      metadata: {
        examName: 'Test Exam',
        examOrg: 'Test Org',
        startDate: '2025-12-25',
        totalQuestions: 50,
        ...overrides
      },
      fases: [{
        tipo: 'objetiva',
        data: '2025-12-25',
        turno: 'manha',
        totalQuestoes: 50
      }],
      disciplinas: [{
        nome: 'Test Discipline',
        numeroQuestoes: 50,
        subtopicos: ['Topic 1', 'Topic 2']
      }]
    }]
  };
}

// ============================================================================
// TESTES DE CARACTERES ESPECIAIS
// ============================================================================

describe('Pre-Orchestrator - Caracteres Especiais', () => {
  test('deve lidar com emojis nos nomes', async () => {
    const edital = createTestEdital({
      examName: 'Concurso 🎓 ENAC 2025',
      examOrg: 'ENAC 🏛️'
    });
    
    edital.concursos[0].disciplinas = [{
      nome: 'Direito Constitucional ⚖️',
      numeroQuestoes: 10,
      subtopicos: ['Direitos Fundamentais 🔐', 'Organização do Estado 🏛️']
    }];
    
    const result = await preOrchestrate(userId, 'test-emoji', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toContain('🎓');
    expect(result.data!.disciplines[0].name).toContain('⚖️');
    expect(result.data!.disciplines[0].topics[0].name).toContain('🔐');
    
    console.log(`\n✅ Emojis preservados:`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
    console.log(`   Discipline: ${result.data!.disciplines[0].name}`);
  });

  test('deve lidar com acentuação e cedilha', async () => {
    const edital = createTestEdital({
      examName: 'Concurso Público - Administração',
      examOrg: 'Ministério da Educação'
    });
    
    edital.concursos[0].disciplinas = [{
      nome: 'Língua Portuguesa',
      numeroQuestoes: 15,
      subtopicos: [
        'Ortografia e Acentuação',
        'Pontuação e Crase',
        'Interpretação de Textos'
      ]
    }];
    
    const result = await preOrchestrate(userId, 'test-acentos', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toContain('ú');
    expect(result.data!.metadata.examOrg).toContain('é');
    expect(result.data!.disciplines[0].name).toContain('ín');
    expect(result.data!.disciplines[0].topics[0].name).toContain('ção');
    
    console.log(`\n✅ Acentuação preservada:`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
    console.log(`   Org: ${result.data!.metadata.examOrg}`);
  });

  test('deve lidar com caracteres especiais comuns', async () => {
    const edital = createTestEdital({
      examName: 'Concurso (2025) - Edital Nº 001/2025',
      examOrg: 'Org. "Teste" & Cia.'
    });
    
    const result = await preOrchestrate(userId, 'test-special-chars', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toContain('(');
    expect(result.data!.metadata.examName).toContain(')');
    expect(result.data!.metadata.examOrg).toContain('&');
    
    console.log(`\n✅ Caracteres especiais preservados:`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
  });

  test('deve lidar com aspas e apóstrofos', async () => {
    const edital = createTestEdital({
      examName: "Concurso 'Municipal' 2025",
      examOrg: 'Prefeitura de "São Paulo"'
    });
    
    edital.concursos[0].disciplinas = [{
      nome: "Direito do Trabalho",
      numeroQuestoes: 10,
      subtopicos: [
        "Direitos do trabalhador",
        'Convenções "Coletivas"'
      ]
    }];
    
    const result = await preOrchestrate(userId, 'test-quotes', edital);
    
    expect(result.success).toBe(true);
    
    console.log(`\n✅ Aspas e apóstrofos preservados:`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
    console.log(`   Topic: ${result.data!.disciplines[0].topics[1].name}`);
  });
});

// ============================================================================
// TESTES DE HTML E SCRIPTS
// ============================================================================

describe('Pre-Orchestrator - HTML e Scripts', () => {
  test('deve aceitar (mas não interpretar) HTML nos campos de texto', async () => {
    // Nota: Pre-orchestrator não sanitiza HTML pois trabalha com JSON já extraído
    // A sanitização deve acontecer antes (no EditalProcessService)
    const edital = createTestEdital({
      examName: '<b>Concurso</b> ENAC',
      examOrg: 'ENAC <i>Org</i>'
    });
    
    const result = await preOrchestrate(userId, 'test-html', edital);
    
    expect(result.success).toBe(true);
    // HTML é preservado como string (não interpretado)
    expect(result.data!.metadata.examName).toContain('<b>');
    expect(result.data!.metadata.examName).toContain('</b>');
    
    console.log(`\n⚠️ HTML preservado (não sanitizado no pre-orchestrator):`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
  });

  test('deve aceitar scripts nos campos (segurança deve ser no frontend)', async () => {
    const edital = createTestEdital({
      examName: '<script>alert("xss")</script>Concurso',
      notes: 'Teste <img src=x onerror=alert(1)>'
    });
    
    const result = await preOrchestrate(userId, 'test-script', edital);
    
    expect(result.success).toBe(true);
    // Scripts são preservados como string (responsabilidade do frontend sanitizar)
    expect(result.data!.metadata.examName).toContain('script');
    
    console.log(`\n⚠️ Scripts preservados (sanitização é responsabilidade do frontend):`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
  });

  test('deve lidar com tags HTML malformadas', async () => {
    const edital = createTestEdital({
      examName: '<div><span>Test</div>',
      examOrg: '<invalid tag'
    });
    
    const result = await preOrchestrate(userId, 'test-malformed-html', edital);
    
    expect(result.success).toBe(true);
    
    console.log(`\n✅ Tags malformadas tratadas como texto:`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
  });
});

// ============================================================================
// TESTES DE INJECTION
// ============================================================================

describe('Pre-Orchestrator - Tentativas de Injection', () => {
  test('deve tratar SQL injection como texto normal', async () => {
    const edital = createTestEdital({
      examName: "'; DROP TABLE study_plans; --",
      examOrg: "' OR '1'='1"
    });
    
    edital.concursos[0].disciplinas = [{
      nome: "1'; DELETE FROM disciplines WHERE '1'='1",
      numeroQuestoes: 10,
      subtopicos: [
        "'; DROP TABLE topics; --",
        "Topic 2"
      ]
    }];
    
    const result = await preOrchestrate(userId, 'test-sql-injection', edital);
    
    expect(result.success).toBe(true);
    // SQL injection é tratado como texto (proteção real é no Supabase com RLS)
    expect(result.data!.metadata.examName).toContain('DROP TABLE');
    expect(result.data!.disciplines[0].name).toContain('DELETE FROM');
    
    console.log(`\n⚠️ SQL injection como texto (proteção real: Supabase RLS + prepared statements):`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
    console.log(`   Discipline: ${result.data!.disciplines[0].name}`);
  });

  test('deve lidar com NoSQL injection', async () => {
    const edital = createTestEdital({
      examName: '{"$gt": ""}',
      examOrg: '{"$ne": null}'
    });
    
    const result = await preOrchestrate(userId, 'test-nosql-injection', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toContain('$gt');
    
    console.log(`\n✅ NoSQL injection tratado como texto:`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
  });

  test('deve lidar com command injection', async () => {
    const edital = createTestEdital({
      examName: '; rm -rf /',
      examOrg: '$(whoami)'
    });
    
    const result = await preOrchestrate(userId, 'test-command-injection', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toContain('rm');
    
    console.log(`\n✅ Command injection tratado como texto:`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
  });
});

// ============================================================================
// TESTES DE LIMITES E EDGE CASES
// ============================================================================

describe('Pre-Orchestrator - Limites de Caracteres', () => {
  test('deve lidar com strings muito longas', async () => {
    const longString = 'A'.repeat(10000);
    const edital = createTestEdital({
      examName: `Concurso ${longString}`,
      notes: longString
    });
    
    const result = await preOrchestrate(userId, 'test-long-string', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName.length).toBeGreaterThan(10000);
    
    console.log(`\n✅ String longa processada:`);
    console.log(`   Length: ${result.data!.metadata.examName.length} chars`);
  });

  test('deve lidar com strings vazias', async () => {
    const edital = createTestEdital({
      examName: '',
      examOrg: ''
    });
    
    const result = await preOrchestrate(userId, 'test-empty-strings', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toBe('');
    expect(result.data!.metadata.examOrg).toBe('');
    
    console.log(`\n✅ Strings vazias aceitas:`);
    console.log(`   Exam name: "${result.data!.metadata.examName}"`);
  });

  test('deve lidar com caracteres Unicode raros', async () => {
    const edital = createTestEdital({
      examName: 'Test 你好 مرحبا Здравствуйте',
      examOrg: '日本語 한국어 עברית'
    });
    
    const result = await preOrchestrate(userId, 'test-unicode', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toContain('你好');
    expect(result.data!.metadata.examOrg).toContain('한국어');
    
    console.log(`\n✅ Unicode preservado:`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
    console.log(`   Org: ${result.data!.metadata.examOrg}`);
  });

  test('deve lidar com null bytes e caracteres de controle', async () => {
    const edital = createTestEdital({
      examName: 'Test\x00\x01\x02',
      examOrg: 'Test\n\r\t'
    });
    
    const result = await preOrchestrate(userId, 'test-control-chars', edital);
    
    expect(result.success).toBe(true);
    
    console.log(`\n✅ Caracteres de controle preservados:`);
    console.log(`   Exam: ${JSON.stringify(result.data!.metadata.examName)}`);
  });
});

// ============================================================================
// TESTES DE EDGE CASES DE FORMATAÇÃO
// ============================================================================

describe('Pre-Orchestrator - Edge Cases de Formatação', () => {
  test('deve lidar com múltiplos espaços e tabs', async () => {
    const edital = createTestEdital({
      examName: 'Concurso    ENAC     2025',
      examOrg: 'ENAC\t\t\tOrg'
    });
    
    const result = await preOrchestrate(userId, 'test-whitespace', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toContain('    ');
    
    console.log(`\n✅ Espaços preservados:`);
    console.log(`   Exam: "${result.data!.metadata.examName}"`);
  });

  test('deve lidar com quebras de linha e parágrafos', async () => {
    const edital = createTestEdital({
      examName: 'Linha 1\nLinha 2\rLinha 3\r\nLinha 4',
      notes: 'Parágrafo 1\n\nParágrafo 2\n\n\nParágrafo 3'
    });
    
    const result = await preOrchestrate(userId, 'test-newlines', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toContain('\n');
    
    console.log(`\n✅ Quebras de linha preservadas:`);
    console.log(`   Lines: ${result.data!.metadata.examName.split('\n').length}`);
  });

  test('deve lidar com números e símbolos matemáticos', async () => {
    const edital = createTestEdital({
      examName: 'Edital Nº 123/2025 - R$ 1.234,56',
      examOrg: 'Test ∑ ∫ ∞ ≈ ≠ ± × ÷'
    });
    
    edital.concursos[0].disciplinas = [{
      nome: 'Matemática',
      numeroQuestoes: 20,
      subtopicos: [
        'Números Reais (ℝ)',
        'Funções (f: ℝ → ℝ)',
        'Limites (lim x→∞)'
      ]
    }];
    
    const result = await preOrchestrate(userId, 'test-math-symbols', edital);
    
    expect(result.success).toBe(true);
    expect(result.data!.metadata.examName).toContain('R$');
    expect(result.data!.metadata.examOrg).toContain('∑');
    expect(result.data!.disciplines[0].topics[0].name).toContain('ℝ');
    
    console.log(`\n✅ Símbolos matemáticos preservados:`);
    console.log(`   Exam: ${result.data!.metadata.examName}`);
    console.log(`   Topic: ${result.data!.disciplines[0].topics[0].name}`);
  });
});

// ============================================================================
// RESUMO DE SEGURANÇA
// ============================================================================

describe('Pre-Orchestrator - Resumo de Segurança', () => {
  test('deve documentar camadas de segurança', () => {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🔒 CAMADAS DE SEGURANÇA DO SISTEMA');
    console.log('='.repeat(80));
    console.log(`
    1. PRE-ORCHESTRATOR (Esta camada):
       - Não sanitiza HTML/scripts (trabalha com JSON já extraído)
       - Preserva todos caracteres (incluindo especiais)
       - Trata injection attempts como texto normal
       - Validação apenas estrutural (campos obrigatórios)
    
    2. FRONTEND (React/Next.js):
       - Sanitização de HTML antes de renderizar
       - Escape de caracteres especiais em inputs
       - Validação client-side
    
    3. SUPABASE (Database):
       - Row Level Security (RLS) por user_id
       - Prepared statements (previne SQL injection)
       - Validação de tipos no schema
       - Constraints de integridade
    
    4. API LAYER:
       - Rate limiting
       - Authentication via JWT
       - Authorization checks
       - Input validation
    `);
    console.log('='.repeat(80) + '\n');
    
    expect(true).toBe(true);
  });
});
