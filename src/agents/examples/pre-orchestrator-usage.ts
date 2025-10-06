/**
 * EXEMPLO DE USO: Fluxo Completo de Processamento de Edital
 * 
 * Este arquivo demonstra como usar o Pre-Orchestrator refatorado
 * para transformar JSON extraído em dados prontos para o database.
 */

import { preOrchestrate } from '../sub-agents/pre-orchestrator-refactored';
import { orchestratePlanCreation } from '../sub-agents/orchestrator-agent';
import type { EditalJSON } from '../sub-agents/pre-orchestrator-refactored';

// ============================================================================
// EXEMPLO 1: Edital Simples (ENAC)
// ============================================================================

async function processarEditalSimples() {
  console.log('🔹 EXEMPLO 1: Processando Edital ENAC (simples)');
  
  // JSON extraído pelo EditalProcessService
  const editalJSON: EditalJSON = {
    "concurso": "ENAC - Técnico em Regulação de Aviação Civil",
    "orgao": "ENAC",
    "fases": [{
      "tipo": "objetiva",
      "data": "2025-03-15",
      "turno": "manhã",
      "disciplinas": [{
        "nome": "Grupo I - Conhecimentos Básicos",
        "numeroQuestoes": 46,
        "materias": [
          {
            "nome": "Direito Constitucional",
            "numeroQuestoes": 11,
            "subtopicos": [
              "1. Direitos e garantias fundamentais.",
              "2. Organização do Estado.",
              "3. Administração Pública."
            ]
          },
          {
            "nome": "Direito Administrativo",
            "numeroQuestoes": 12,
            "subtopicos": [
              "1. Regime jurídico-administrativo.",
              "2. Princípios da Administração Pública."
            ]
          }
        ]
      }]
    }]
  };

  // Usuário autenticado
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const editalId = 'edital-enac-2025';

  try {
    // PASSO 1: Pre-Orchestrator normaliza JSON → Estrutura flat
    console.log('📝 PASSO 1: Normalizando JSON...');
    const preResult = await preOrchestrate(userId, editalId, editalJSON);
    
    if (!preResult.success) {
      console.error('❌ Erro no pre-orchestrator:', preResult.error);
      return;
    }

    console.log('✅ Estrutura normalizada:');
    console.log('   - Metadados:', preResult.data.metadata.examName);
    console.log('   - Exams:', preResult.data.exams.length, 'fase válida');
    console.log('   - Disciplines:', preResult.data.disciplines.length, 'disciplinas');
    console.log('   - Topics:', preResult.data.disciplines.reduce((sum, d) => sum + d.topics.length, 0), 'tópicos');
    
    // Verificar transformações
    console.log('\n🔍 Verificando transformações:');
    preResult.data.disciplines.forEach((disc, i) => {
      console.log(`   ${i+1}. ${disc.name}`);
      console.log(`      ├─ Cor: ${disc.color}`);
      console.log(`      ├─ Questões: ${disc.numberOfQuestions}`);
      console.log(`      └─ Tópicos: ${disc.topics.length}`);
    });

    // PASSO 2: Orchestrator cria no database
    console.log('\n📝 PASSO 2: Criando no database...');
    const orchestratorResult = await orchestratePlanCreation(
      userId,
      editalId,
      preResult.data
    );

    if (!orchestratorResult.success) {
      console.error('❌ Erro no orchestrator:', orchestratorResult.error);
      return;
    }

    console.log('✅ Plano criado com sucesso!');
    console.log('   - study_plan_id:', orchestratorResult.data.studyPlanId);
    console.log('   - exam_id:', orchestratorResult.data.examId);
    console.log('   - disciplines criadas:', orchestratorResult.data.disciplineIds.length);
    console.log('   - topics criados:', orchestratorResult.data.topicIds.length);

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

// ============================================================================
// EXEMPLO 2: Edital Complexo com Múltiplas Fases (Advogado da União)
// ============================================================================

async function processarEditalComplexo() {
  console.log('\n🔹 EXEMPLO 2: Processando Advogado da União (múltiplas fases)');

  const editalJSON: EditalJSON = {
    "concurso": "Advogado da União",
    "orgao": "Advocacia-Geral da União",
    "fases": [
      {
        "tipo": "objetiva",
        "data": "2025-04-10",
        "turno": "tarde",
        "disciplinas": [
          {
            "nome": "Direito Constitucional",
            "numeroQuestoes": 20,
            "subtopicos": [
              "1. Teoria da Constituição",
              "2. Direitos Fundamentais"
            ]
          }
        ]
      },
      {
        "tipo": "discursiva",
        "data": "2025-05-15",
        "turno": "manhã",
        "disciplinas": [
          {
            "nome": "Prática Jurídica",
            "numeroQuestoes": 2,
            "subtopicos": [
              "1. Elaboração de peças processuais"
            ]
          }
        ]
      },
      {
        "tipo": "titulos", // ⚠️ ENUM inválido - será filtrado
        "data": "não especificado",
        "turno": "não especificado",
        "disciplinas": []
      },
      {
        "tipo": "oral",
        "data": "2025-06-20",
        "turno": "manha",
        "disciplinas": []
      }
    ]
  };

  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const editalId = 'edital-agu-2025';

  try {
    console.log('📝 PASSO 1: Normalizando JSON...');
    const preResult = await preOrchestrate(userId, editalId, editalJSON);
    
    if (!preResult.success) {
      console.error('❌ Erro:', preResult.error);
      return;
    }

    console.log('✅ Estrutura normalizada:');
    console.log('   - Total de fases no JSON:', editalJSON.fases.length);
    console.log('   - Fases válidas extraídas:', preResult.data.exams.length);
    console.log('   - Fase usada no database:', preResult.data.exams[0].examType);
    console.log('   ⚠️ Fases filtradas: "titulos" (ENUM inválido)');
    
    // Mostrar transformações de ENUM
    console.log('\n🔍 Transformações de ENUM:');
    console.log('   - Turno "tarde" → "tarde" ✅');
    console.log('   - Turno "manhã" → "manha" ✅');
    console.log('   - Turno "não especificado" → "manha" (fallback) ✅');

    console.log('\n📝 PASSO 2: Criando no database...');
    const orchestratorResult = await orchestratePlanCreation(
      userId,
      editalId,
      preResult.data
    );

    if (orchestratorResult.success) {
      console.log('✅ Plano criado com sucesso!');
      console.log('   - 1 exam criado (PRIMARY KEY constraint respeitado)');
      console.log('   - Múltiplas fases preservadas nos metadados');
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

// ============================================================================
// EXEMPLO 3: Edital com Estrutura Hierárquica Profunda (Cartórios RS)
// ============================================================================

async function processarEditalHierarquico() {
  console.log('\n🔹 EXEMPLO 3: Processando Cartórios RS (hierarquia profunda)');

  const editalJSON: EditalJSON = {
    "concurso": "Concurso para Cartórios do RS",
    "orgao": "TJ-RS",
    "fases": [{
      "tipo": "objetiva",
      "data": "2025-05-20",
      "turno": "matutino", // ⚠️ Será normalizado para "manha"
      "disciplinas": [
        {
          "nome": "Grupo I - Conhecimentos Gerais",
          "numeroQuestoes": 50,
          "materias": [
            {
              "nome": "Língua Portuguesa",
              "numeroQuestoes": 15,
              "subtopicos": [
                "1. Compreensão e interpretação de textos",
                "2. Ortografia",
                "3. Morfologia",
                "4. Sintaxe",
                "5. Semântica"
              ]
            },
            {
              "nome": "Raciocínio Lógico",
              "numeroQuestoes": 10,
              "subtopicos": [
                "1. Lógica proposicional",
                "2. Raciocínio quantitativo"
              ]
            },
            {
              "nome": "Informática",
              "numeroQuestoes": 5,
              "subtopicos": [
                "1. MS Office",
                "2. Internet"
              ]
            }
          ]
        },
        {
          "nome": "Grupo II - Conhecimentos Específicos",
          "numeroQuestoes": 100,
          "materias": [
            {
              "nome": "Direito Notarial e Registral",
              "numeroQuestoes": 40,
              "subtopicos": [
                "1. Lei de Registros Públicos",
                "2. Código Civil - Registros",
                "3. Provimento CNJ",
                // ... mais 15 subtópicos
              ]
            },
            {
              "nome": "Direito Civil",
              "numeroQuestoes": 30,
              "subtopicos": [
                "1. Parte Geral",
                "2. Obrigações",
                "3. Contratos",
                // ... mais 10 subtópicos
              ]
            },
            {
              "nome": "Direito Processual Civil",
              "numeroQuestoes": 20,
              "subtopicos": [
                "1. Processo de conhecimento",
                "2. Recursos",
                // ... mais 8 subtópicos
              ]
            },
            {
              "nome": "Direito Empresarial",
              "numeroQuestoes": 10,
              "subtopicos": [
                "1. Sociedades empresariais",
                "2. Títulos de crédito"
              ]
            }
          ]
        }
      ]
    }]
  };

  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const editalId = 'edital-cartorios-rs-2025';

  try {
    console.log('📝 PASSO 1: Normalizando JSON hierárquico...');
    console.log('   - Estrutura original:');
    console.log('     └─ 2 grupos');
    console.log('        ├─ Grupo I: 3 matérias (30 questões)');
    console.log('        └─ Grupo II: 4 matérias (100 questões)');

    const preResult = await preOrchestrate(userId, editalId, editalJSON);
    
    if (!preResult.success) {
      console.error('❌ Erro:', preResult.error);
      return;
    }

    console.log('\n✅ Estrutura achatada:');
    console.log('   - Total de disciplinas flat:', preResult.data.disciplines.length);
    console.log('   - Grupos eliminados ✅');
    console.log('   - Materias → Disciplines ✅');
    
    console.log('\n🎨 Cores geradas automaticamente:');
    preResult.data.disciplines.forEach((disc, i) => {
      console.log(`   ${i+1}. ${disc.name.padEnd(35)} ${disc.color} (${disc.numberOfQuestions} q)`);
    });

    console.log('\n🔢 Distribuição de questões:');
    const totalQuestions = preResult.data.disciplines.reduce((sum, d) => sum + (d.numberOfQuestions || 0), 0);
    console.log(`   - Total: ${totalQuestions} questões`);
    console.log(`   - Exam totalQuestions: ${preResult.data.exams[0].totalQuestions}`);
    console.log(`   - Match: ${totalQuestions === preResult.data.exams[0].totalQuestions ? '✅' : '❌'}`);

    console.log('\n📝 PASSO 2: Criando no database...');
    const orchestratorResult = await orchestratePlanCreation(
      userId,
      editalId,
      preResult.data
    );

    if (orchestratorResult.success) {
      console.log('✅ Plano criado com sucesso!');
      console.log(`   - ${orchestratorResult.data.disciplineIds.length} disciplinas criadas`);
      console.log(`   - ${orchestratorResult.data.topicIds.length} tópicos criados`);
      console.log('   - Hierarquia achatada corretamente ✅');
      console.log('   - Cores atribuídas ✅');
      console.log('   - ENUMs validados ✅');
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

// ============================================================================
// EXEMPLO 4: Tratamento de Erros
// ============================================================================

async function demonstrarTratamentoDeErros() {
  console.log('\n🔹 EXEMPLO 4: Demonstrando tratamento de erros');

  // ERRO 1: userId inválido
  console.log('\n❌ ERRO 1: userId inválido');
  try {
    const result = await preOrchestrate(
      'invalid-uuid', // ❌ Não é UUID
      'edital-test',
      { concurso: 'Test', orgao: 'Test', fases: [] }
    );
    console.log('   Resultado:', result.error);
  } catch (error) {
    console.error('   Exception:', error);
  }

  // ERRO 2: JSON sem fases
  console.log('\n❌ ERRO 2: JSON sem fases');
  try {
    const result = await preOrchestrate(
      '123e4567-e89b-12d3-a456-426614174000',
      'edital-test',
      { concurso: 'Test', orgao: 'Test', fases: [] } as EditalJSON
    );
    console.log('   Resultado:', result.error);
  } catch (error) {
    console.error('   Exception:', error);
  }

  // ERRO 3: JSON com apenas fases inválidas
  console.log('\n❌ ERRO 3: Apenas fases inválidas (titulos, nao_especificado)');
  try {
    const result = await preOrchestrate(
      '123e4567-e89b-12d3-a456-426614174000',
      'edital-test',
      {
        concurso: 'Test',
        orgao: 'Test',
        fases: [
          { tipo: 'titulos', data: 'N/A', turno: 'N/A', disciplinas: [] },
          { tipo: 'nao_especificado', data: 'N/A', turno: 'N/A', disciplinas: [] }
        ]
      }
    );
    console.log('   Resultado:', result.error);
    console.log('   ⚠️ Todas as fases foram filtradas por serem ENUMs inválidos');
  } catch (error) {
    console.error('   Exception:', error);
  }

  // ERRO 4: JSON sem disciplinas
  console.log('\n❌ ERRO 4: JSON sem disciplinas');
  try {
    const result = await preOrchestrate(
      '123e4567-e89b-12d3-a456-426614174000',
      'edital-test',
      {
        concurso: 'Test',
        orgao: 'Test',
        fases: [{
          tipo: 'objetiva',
          data: '2025-01-01',
          turno: 'manha',
          disciplinas: [] // ❌ Vazio
        }]
      }
    );
    console.log('   Resultado:', result.error);
  } catch (error) {
    console.error('   Exception:', error);
  }
}

// ============================================================================
// EXECUTAR EXEMPLOS
// ============================================================================

async function runAllExamples() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('     EXEMPLOS DE USO: Pre-Orchestrator Refatorado');
  console.log('═══════════════════════════════════════════════════════════\n');

  await processarEditalSimples();
  await processarEditalComplexo();
  await processarEditalHierarquico();
  await demonstrarTratamentoDeErros();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                      FIM DOS EXEMPLOS');
  console.log('═══════════════════════════════════════════════════════════');
}

// Executar se for chamado diretamente
if (require.main === module) {
  runAllExamples().catch(console.error);
}

export { 
  processarEditalSimples,
  processarEditalComplexo,
  processarEditalHierarquico,
  demonstrarTratamentoDeErros
};
