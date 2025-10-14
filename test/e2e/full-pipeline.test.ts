/**
 * E2E Tests - Full Pipeline (Happy Path)
 * 
 * Testa o pipeline completo: JSON → Identifier (Claude Sonnet 4.5) → Orchestrator → Database
 * Usa editais reais de temp/editais-json/
 * User ID: 98d8b11a-8a32-4f6b-9dae-6e42efa23116
 * 
 * FOCO: Qualidade e integridade dos dados, não contagens exatas.
 * A IA (Claude Sonnet 4.5) decide semanticamente a estrutura correta.
 */

import { createStudyPlan } from '../../src/agents/index';
import {
  loadEditalContent,
  cleanupUserData,
  validatePlanInDatabase,
  AVAILABLE_EDITAIS,
} from '../helpers/e2e-setup';
import type { StudyPlanInput } from '../../src/agents/types/types';

// User ID de teste (conforme solicitado)
const TEST_USER_ID = '98d8b11a-8a32-4f6b-9dae-6e42efa23116';

describe('E2E - Full Pipeline (Happy Path)', () => {
  // Cleanup após cada teste para evitar interferências
  afterEach(async () => {
    await cleanupUserData(TEST_USER_ID);
  });

  /**
   * Teste 1: Processar edital pequeno (ENAC - 58KB)
   * Timeout: 60s (GPT-4.1-mini pode ser lento em primeira chamada)
   */
  test('deve processar edital completo do ENAC (pequeno)', async () => {
    // 1. Carregar edital
    const editalContent = loadEditalContent('ENAC');
    expect(editalContent).toBeDefined();
    expect(editalContent.concursos).toHaveLength(1);

    const concurso = editalContent.concursos[0];
    expect(concurso.metadata).toBeDefined();
    expect(concurso.metadata.examName).toBe('2º Exame Nacional dos Cartórios - ENAC 2025.2');

    // 2. Preparar input para createStudyPlan
    const input: StudyPlanInput = {
      userId: TEST_USER_ID,
      content: JSON.stringify(editalContent),
    };

    // 3. Executar pipeline completo
    const startTime = Date.now();
    const result = await createStudyPlan(input);
    const executionTime = Date.now() - startTime;

    // 4. Validar resultado do pipeline
    if (!result.success) {
      console.error('❌ Pipeline falhou:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe('string'); // planId é UUID string
    expect(result.error).toBeUndefined();

    const planId = result.data!;

    // 5. Validar que plano existe no banco
    const validation = await validatePlanInDatabase(planId, TEST_USER_ID);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // 6. Validar qualidade dos dados (não contagens exatas - a IA decide)
    expect(validation.counts.studyPlans).toBe(1);
    expect(validation.counts.exams).toBeGreaterThan(0); // Tem exames
    expect(validation.counts.disciplines).toBeGreaterThan(0); // Tem disciplinas
    expect(validation.counts.topics).toBeGreaterThan(0); // Tem tópicos

    console.log('✅ ENAC processado:', {
      planId,
      executionTime: `${executionTime}ms`,
      counts: validation.counts,
    });
  }, 240000); // Timeout de 240s (4 minutos) - MVP focado em qualidade, não velocidade

  /**
   * Teste 2: Processar edital médio (Advogado da União - 17KB)
   * Timeout: 60s
   */
  test('deve processar edital médio (Advogado da União)', async () => {
    const editalContent = loadEditalContent('Advogado da União');
    expect(editalContent).toBeDefined();

    const input: StudyPlanInput = {
      userId: TEST_USER_ID,
      content: JSON.stringify(editalContent),
    };

    const startTime = Date.now();
    const result = await createStudyPlan(input);
    const executionTime = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const planId = result.data!;
    const validation = await validatePlanInDatabase(planId, TEST_USER_ID);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // Validar qualidade dos dados (não contagens exatas)
    expect(validation.counts.exams).toBeGreaterThan(0);
    expect(validation.counts.disciplines).toBeGreaterThan(0);
    expect(validation.counts.topics).toBeGreaterThan(0);

    console.log('✅ Advogado da União processado:', {
      planId,
      executionTime: `${executionTime}ms`,
      counts: validation.counts,
    });
  }, 240000); // Timeout de 240s (4 minutos) - MVP focado em qualidade, não velocidade

  /**
   * Teste 3: Processar edital grande (Cartórios RS - 116KB - LARGEST)
   * Timeout: 90s (edital complexo)
   */
  test('deve processar edital grande (Cartórios RS - maior edital)', async () => {
    const editalContent = loadEditalContent('Cartórios RS');
    expect(editalContent).toBeDefined();

    const input: StudyPlanInput = {
      userId: TEST_USER_ID,
      content: JSON.stringify(editalContent),
    };

    const startTime = Date.now();
    const result = await createStudyPlan(input);
    const executionTime = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const planId = result.data!;
    const validation = await validatePlanInDatabase(planId, TEST_USER_ID);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // Validar qualidade dos dados (edital grande complexo)
    expect(validation.counts.exams).toBeGreaterThan(0);
    expect(validation.counts.disciplines).toBeGreaterThan(0);
    expect(validation.counts.topics).toBeGreaterThan(50); // Edital grande = muitos tópicos

    console.log('✅ Cartórios RS (LARGEST) processado:', {
      planId,
      executionTime: `${executionTime}ms`,
      counts: validation.counts,
    });
  }, 240000); // Timeout de 240s (4 minutos) - MVP focado em qualidade, não velocidade

  /**
   * Teste 4: Validar estrutura de dados complexa (MPRS)
   * Valida integridade referencial e qualidade dos dados
   */
  test('deve validar qualidade de dados em edital complexo (MPRS)', async () => {
    const editalContent = loadEditalContent('MPRS');

    const input: StudyPlanInput = {
      userId: TEST_USER_ID,
      content: JSON.stringify(editalContent),
    };

    const result = await createStudyPlan(input);
    expect(result.success).toBe(true);

    const planId = result.data!;
    const validation = await validatePlanInDatabase(planId, TEST_USER_ID);

    // Validar qualidade dos dados
    expect(validation.counts.studyPlans).toBe(1);
    expect(validation.counts.exams).toBeGreaterThan(0);
    expect(validation.counts.disciplines).toBeGreaterThan(0);
    expect(validation.counts.topics).toBeGreaterThan(100); // MPRS é grande

    // Validar que não há erros
    expect(validation.valid).toBe(true);
    if (validation.errors.length > 0) {
      console.error('Erros de validação:', validation.errors);
    }
    expect(validation.errors).toHaveLength(0);

    console.log('✅ MPRS validado:', {
      planId,
      counts: validation.counts,
      quality: 'Dados estruturados e integridade mantida'
    });
  }, 240000); // Timeout de 240s (4 minutos) - MVP focado em qualidade, não velocidade

  /**
   * Teste 5: Validar integridade referencial (OAB)
   * Garante que todas as FKs estão corretas: plan_id, discipline_id
   */
  test('deve manter integridade referencial completa (OAB)', async () => {
    const editalContent = loadEditalContent('OAB');

    const input: StudyPlanInput = {
      userId: TEST_USER_ID,
      content: JSON.stringify(editalContent),
    };

    const result = await createStudyPlan(input);
    expect(result.success).toBe(true);

    const planId = result.data!;

    // Buscar manualmente no banco para validar FKs
    const { supabase } = await import('../../src/config/supabase');

    // 1. Validar study_plan existe
    const { data: plan, error: planError } = await supabase
      .from('study_plans')
      .select('*')
      .eq('id', planId)
      .single();

    expect(planError).toBeNull();
    expect(plan).toBeDefined();
    expect(plan.user_id).toBe(TEST_USER_ID);

    // 2. Validar exams têm plan_id correto
    const { data: exams, error: examsError } = await supabase
      .from('exams')
      .select('*')
      .eq('plan_id', planId);

    expect(examsError).toBeNull();
    expect(exams).toBeDefined();
    expect(exams!.length).toBeGreaterThan(0);
    
    for (const exam of exams!) {
      expect(exam.plan_id).toBe(planId);
    }

    // 3. Validar disciplines têm plan_id correto
    const { data: disciplines, error: disciplinesError } = await supabase
      .from('disciplines')
      .select('*')
      .eq('plan_id', planId);

    expect(disciplinesError).toBeNull();
    expect(disciplines).toBeDefined();
    expect(disciplines!.length).toBeGreaterThan(0);

    const disciplineIds = disciplines!.map(d => d.id);
    for (const disc of disciplines!) {
      expect(disc.plan_id).toBe(planId);
    }

    // 4. Validar topics têm plan_id e discipline_id corretos
    const { data: topics, error: topicsError } = await supabase
      .from('topics')
      .select('*')
      .in('discipline_id', disciplineIds);

    expect(topicsError).toBeNull();
    expect(topics).toBeDefined();
    expect(topics!.length).toBeGreaterThan(0);

    for (const topic of topics!) {
      expect(topic.plan_id).toBe(planId);
      expect(disciplineIds).toContain(topic.discipline_id);
    }

    console.log('✅ Integridade referencial validada:', {
      planId,
      userId: TEST_USER_ID,
      exams: exams!.length,
      disciplines: disciplines!.length,
      topics: topics!.length,
      allFKsValid: true,
    });
  }, 240000); // Timeout de 240s (4 minutos) - MVP focado em qualidade, não velocidade
});
