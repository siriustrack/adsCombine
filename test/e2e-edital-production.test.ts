#!/usr/bin/env bun
/**
 * TESTE E2E - Simula EXATAMENTE o comportamento em produção
 * 
 * Este teste:
 * 1. Faz GET no mesmo arquivo que falhou em produção
 * 2. Processa com o mesmo serviço usado em produção
 * 3. Valida os resultados da mesma forma que produção valida
 * 
 * URL do edital: https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/98d8b11a-8a32-4f6b-9dae-6e42efa23116/a921f43e-4a5c-425b-a356-5e2ec2ca8c68.txt
 */

import { EditalProcessService } from '../src/core/services/editais/edital-process.service';

const PRODUCTION_URL = 'https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/98d8b11a-8a32-4f6b-9dae-6e42efa23116/a921f43e-4a5c-425b-a356-5e2ec2ca8c68.txt';

interface TestResult {
  success: boolean;
  duration: number;
  fetchTime: number;
  processingTime: number;
  stats: {
    contentLength: number;
    estimatedTokens: number;
    concursos: number;
    disciplinas: number;
    materias: number;
    questoes: number;
  };
  validationErrors: string[];
  validationWarnings: string[];
  parsedData?: any;
}

async function runE2ETest(): Promise<TestResult> {
  const startTime = Date.now();
  console.log('\n🚀 ========================================');
  console.log('   TESTE E2E - SIMULAÇÃO PRODUÇÃO');
  console.log('========================================\n');

  // FASE 1: FETCH DO CONTEÚDO (igual produção)
  console.log('📥 FASE 1: Fetching content...');
  console.log(`   URL: ${PRODUCTION_URL}`);
  
  const fetchStart = Date.now();
  const response = await fetch(PRODUCTION_URL);
  const content = await response.text();
  const fetchTime = Date.now() - fetchStart;
  
  console.log(`   ✅ Content fetched: ${content.length.toLocaleString()} bytes`);
  console.log(`   ⏱️  Time: ${(fetchTime / 1000).toFixed(2)}s\n`);

  // FASE 2: PROCESSAMENTO (sem chunking - Claude Sonnet 4.5 tem 200K tokens)
  console.log('🤖 FASE 2: Processing with Claude...');
  console.log(`   Content: ${content.length.toLocaleString()} chars (~${Math.floor(content.length / 4).toLocaleString()} tokens)`);
  console.log(`   Mode: Full document (no chunking needed)`);
  
  const service = new EditalProcessService();
  const processingStart = Date.now();
  
  // Criar um mock de job info para o processamento
  const mockJobInfo = {
    jobId: 'test-e2e-' + Date.now(),
    outputPath: '/tmp/test-output.json',
    publicPath: '/tmp/test-output.json'
  };

  let result: any;
  let parsedData: any;
  let processingError: Error | null = null;

  try {
    // Processamento direto sem chunking (Claude Sonnet 4.5 tem 200K tokens de contexto)
    // Nosso edital tem ~180K chars = ~45K tokens, cabe tranquilamente
    
    // @ts-ignore - acessando método privado para teste
    const rawResult = await service.processWithClaude(content);
    
    const processingTime = Date.now() - processingStart;
    console.log(`   ✅ Processing completed: ${(processingTime / 1000).toFixed(2)}s\n`);
    
    // Validar resultado
    console.log('🔍 FASE 3: Validation...');
    
    // Extrair dados
    result = rawResult;
    parsedData = result;
    
    // Calcular estatísticas
    const concursos = result.concursos?.length || 0;
    let totalDisciplinas = 0;
    let totalMaterias = 0;
    let totalQuestoes = 0;
    
    if (result.concursos) {
      for (const concurso of result.concursos) {
        if (concurso.disciplinas) {
          totalDisciplinas += concurso.disciplinas.length;
          for (const disciplina of concurso.disciplinas) {
            if (disciplina.materias) {
              totalMaterias += disciplina.materias.length;
            }
            totalQuestoes += disciplina.numeroQuestoes || 0;
          }
        }
      }
    }

    console.log('   📊 Estatísticas:');
    console.log(`      • Concursos: ${concursos}`);
    console.log(`      • Disciplinas: ${totalDisciplinas}`);
    console.log(`      • Matérias: ${totalMaterias}`);
    console.log(`      • Questões: ${totalQuestoes}\n`);

    // Validações (igual produção)
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!result.concursos || result.concursos.length === 0) {
      errors.push('Nenhum concurso encontrado no resultado');
    }

    for (const [idx, concurso] of (result.concursos || []).entries()) {
      const titulo = concurso.titulo || `Concurso ${idx + 1}`;

      // Validar metadata
      if (!concurso.metadata) {
        errors.push(`[${titulo}] Metadata ausente`);
      } else {
        // Validar data (problema identificado nos logs)
        if (concurso.metadata.startDate) {
          const datePattern = /^\d{4}-\d{2}-\d{2}$/;
          if (!datePattern.test(concurso.metadata.startDate)) {
            errors.push(`[${titulo}] startDate inválido: "${concurso.metadata.startDate}" (esperado: YYYY-MM-DD)`);
          }
        }
      }

      // Validar disciplinas
      if (!concurso.disciplinas || concurso.disciplinas.length === 0) {
        errors.push(`[${titulo}] Nenhuma disciplina encontrada`);
      } else {
        let somaQuestoes = 0;
        
        for (const [dIdx, disciplina] of concurso.disciplinas.entries()) {
          // Validar matérias (problema identificado nos logs)
          if (!disciplina.materias || disciplina.materias.length === 0) {
            errors.push(`[${titulo}] Disciplina "${disciplina.nome}" não possui matérias`);
          }

          // Validar número de questões
          const numQuestoes = disciplina.numeroQuestoes || 0;
          if (numQuestoes === 0) {
            warnings.push(`[${titulo}] Disciplina "${disciplina.nome}" com 0 questões`);
          }
          somaQuestoes += numQuestoes;
        }

        // Validar soma de questões (problema identificado nos logs)
        const totalProva = concurso.provas?.[0]?.metadata?.totalQuestoes || 
                           concurso.metadata?.totalQuestions || 0;
        
        if (totalProva > 0 && somaQuestoes !== totalProva) {
          errors.push(`[${titulo}] Soma das questões por disciplina (${somaQuestoes}) difere do total da prova objetiva (${totalProva})`);
        }
      }
    }

    console.log('   🔍 Validação de integridade:');
    if (errors.length > 0) {
      console.log(`      ❌ ERROS (${errors.length}):`);
      errors.forEach(err => console.log(`         • ${err}`));
    }
    if (warnings.length > 0) {
      console.log(`      ⚠️  WARNINGS (${warnings.length}):`);
      warnings.slice(0, 5).forEach(warn => console.log(`         • ${warn}`));
      if (warnings.length > 5) {
        console.log(`         ... e mais ${warnings.length - 5} warnings`);
      }
    }
    if (errors.length === 0 && warnings.length === 0) {
      console.log('      ✅ PASSOU - Nenhum erro ou warning');
    }

    const totalTime = Date.now() - startTime;

    return {
      success: errors.length === 0,
      duration: totalTime,
      fetchTime,
      processingTime,
      stats: {
        contentLength: content.length,
        estimatedTokens: Math.floor(content.length / 4),
        concursos,
        disciplinas: totalDisciplinas,
        materias: totalMaterias,
        questoes: totalQuestoes
      },
      validationErrors: errors,
      validationWarnings: warnings,
      parsedData
    };

  } catch (error: any) {
    processingError = error;
    const processingTime = Date.now() - processingStart;
    
    console.log(`   ❌ Processing FAILED: ${(processingTime / 1000).toFixed(2)}s`);
    console.log(`   Error: ${error.message}\n`);
    
    throw error;
  }
}

// Executar teste
console.clear();
console.log('\n╔══════════════════════════════════════╗');
console.log('║   E2E TEST - PRODUCTION SIMULATION   ║');
console.log('╚══════════════════════════════════════╝');

runE2ETest()
  .then((result) => {
    console.log('\n\n╔══════════════════════════════════════╗');
    console.log('║          RESULTADO FINAL             ║');
    console.log('╚══════════════════════════════════════╝\n');
    
    console.log(`Status: ${result.success ? '✅ SUCESSO' : '❌ FALHOU'}`);
    console.log(`Tempo total: ${(result.duration / 1000).toFixed(2)}s`);
    console.log(`  • Fetch: ${(result.fetchTime / 1000).toFixed(2)}s`);
    console.log(`  • Processing: ${(result.processingTime / 1000).toFixed(2)}s\n`);
    
    console.log('Estatísticas:');
    console.log(`  • Content: ${result.stats.contentLength.toLocaleString()} bytes`);
    console.log(`  • Estimated tokens: ~${result.stats.estimatedTokens.toLocaleString()}`);
    console.log(`  • Concursos: ${result.stats.concursos}`);
    console.log(`  • Disciplinas: ${result.stats.disciplinas}`);
    console.log(`  • Matérias: ${result.stats.materias}`);
    console.log(`  • Questões: ${result.stats.questoes}\n`);
    
    console.log('Validação:');
    console.log(`  • Erros: ${result.validationErrors.length}`);
    console.log(`  • Warnings: ${result.validationWarnings.length}\n`);
    
    if (!result.success) {
      console.log('❌ TESTE FALHOU - Mesmos problemas da produção reproduzidos!');
      console.log('   Agora podemos debugar com precisão.\n');
      process.exit(1);
    } else {
      console.log('✅ TESTE PASSOU - Problema RESOLVIDO!');
      console.log('   Diferente de produção. Investigar diferenças.\n');
      process.exit(0);
    }
  })
  .catch((error) => {
    console.error('\n\n╔══════════════════════════════════════╗');
    console.error('║          ERRO FATAL                  ║');
    console.error('╚══════════════════════════════════════╝\n');
    console.error(error);
    console.error('\n❌ Teste abortado por erro fatal\n');
    process.exit(1);
  });
