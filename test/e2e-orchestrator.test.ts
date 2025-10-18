#!/usr/bin/env bun
/**
 * Teste E2E: Orchestrator Agent com MCP Supabase
 * 
 * Este teste demonstra a orquestração inteligente de agentes IA
 * para transformar JSONs de editais em registros estruturados no banco.
 */

import { editalOrchestratorAgent } from '../src/core/agents/edital-orchestrator.agent';
import fs from 'node:fs';
import path from 'node:path';
import type { EditalProcessado } from '../src/core/services/editais/edital-schema';

// Dados de teste
const TEST_USER_ID = '98d8b11a-8a32-4f6b-9dae-6e42efa23116';
const TEST_EDITAIS_DIR = path.join(__dirname, '../temp/editais-json');

// Lista de editais para testar
const EDITAIS_TO_TEST = [
  'edital juiz sc.json',
  'edital ENAC.json',
  'edital MPRS.json',
  'edital advogado da união.json',
  'edital concurso cartórios rs.json',
  'edital oab.json',
  'edital prefeitura.json',
];

interface TestSummary {
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    edital: string;
    success: boolean;
    edital_file_id?: string;
    study_plan_id?: string;
    stats?: {
      exams: number;
      disciplines: number;
      topics: number;
    };
    errors: string[];
    duration: number;
  }>;
}

async function testSingleEdital(editalPath: string): Promise<any> {
  const editalName = path.basename(editalPath);
  console.log(`\n📄 Testando: ${editalName}`);
  console.log('─'.repeat(60));

  const startTime = Date.now();

  try {
    // Carregar JSON
    const editalJson: EditalProcessado = JSON.parse(
      fs.readFileSync(editalPath, 'utf-8')
    );

    console.log(`   ✓ JSON carregado`);
    console.log(`     • Nome: ${editalJson.concursos[0]?.metadata?.examName || 'N/A'}`);
    console.log(`     • Órgão: ${editalJson.concursos[0]?.metadata?.examOrg || 'N/A'}`);
    console.log(`     • Concursos: ${editalJson.concursos.length}`);
    console.log(`     • Disciplinas: ${editalJson.validacao.totalDisciplinas}`);
    console.log(`     • Matérias: ${editalJson.validacao.totalMaterias}`);
    console.log(`     • Questões: ${editalJson.validacao.totalQuestoes}\n`);

    // Executar orquestração
    console.log('   🤖 Iniciando orquestração de agentes...');
    
    const result = await editalOrchestratorAgent.orchestrate({
      user_id: TEST_USER_ID,
      edital_json: editalJson,
      edital_file_url: `https://storage.example.com/editais/${editalName}`,
      edital_bucket_path: `98d8b11a-8a32-4f6b-9dae-6e42efa23116/${editalName.replace('.json', '.pdf')}`, // Path no bucket
      file_name: editalName.replace('.json', '.pdf'),
      file_size: fs.statSync(editalPath).size,
      mime_type: 'application/pdf',
      json_url: `https://storage.example.com/editais-json/${editalName}`,
      transcription_url: `https://storage.example.com/editais-txt/${editalName.replace('.json', '.txt')}`,
    });

    const duration = Date.now() - startTime;

    if (result.success) {
      console.log(`\n   ✅ Sucesso! (${(duration / 1000).toFixed(2)}s)`);
      console.log(`      • Edital File ID: ${result.edital_file_id}`);
      console.log(`      • Study Plan ID: ${result.study_plan_id}`);
      console.log(`      • Exames: ${result.stats.exams}`);
      console.log(`      • Disciplinas: ${result.stats.disciplines}`);
      console.log(`      • Topics: ${result.stats.topics}`);
      
      if (result.warnings.length > 0) {
        console.log(`\n   ⚠️  Warnings (${result.warnings.length}):`);
        result.warnings.forEach(w => console.log(`      • ${w}`));
      }
    } else {
      console.log(`\n   ❌ Falhou! (${(duration / 1000).toFixed(2)}s)`);
      console.log(`      Erros (${result.errors.length}):`);
      result.errors.forEach(e => console.log(`      • ${e}`));
    }

    return {
      edital: editalName,
      success: result.success,
      edital_file_id: result.edital_file_id,
      study_plan_id: result.study_plan_id,
      stats: result.stats,
      errors: result.errors,
      duration,
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`\n   ❌ Erro crítico! (${(duration / 1000).toFixed(2)}s)`);
    console.log(`      ${error instanceof Error ? error.message : 'Unknown error'}`);

    return {
      edital: editalName,
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      duration,
    };
  }
}

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     TESTE E2E: Orchestrator Agent + MCP Supabase          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`📂 Diretório de editais: ${TEST_EDITAIS_DIR}`);
  console.log(`👤 User ID: ${TEST_USER_ID}\n`);

  const summary: TestSummary = {
    total: 0,
    successful: 0,
    failed: 0,
    results: [],
  };

  // Testar cada edital
  for (const editalFile of EDITAIS_TO_TEST) {
    const editalPath = path.join(TEST_EDITAIS_DIR, editalFile);
    
    if (!fs.existsSync(editalPath)) {
      console.log(`\n⚠️  Arquivo não encontrado: ${editalFile}`);
      continue;
    }

    summary.total++;
    const result = await testSingleEdital(editalPath);
    summary.results.push(result);
    
    if (result.success) {
      summary.successful++;
    } else {
      summary.failed++;
    }

    // Pausa entre testes
    if (summary.total < EDITAIS_TO_TEST.length) {
      console.log('\n   ⏸️  Aguardando 2s antes do próximo teste...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Resumo final
  console.log('\n\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    RESUMO DOS TESTES                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`📊 Total de testes: ${summary.total}`);
  console.log(`✅ Sucessos: ${summary.successful}`);
  console.log(`❌ Falhas: ${summary.failed}`);
  console.log(`📈 Taxa de sucesso: ${((summary.successful / summary.total) * 100).toFixed(1)}%\n`);

  if (summary.successful > 0) {
    console.log('🎉 Testes bem-sucedidos:');
    summary.results
      .filter(r => r.success)
      .forEach(r => {
        console.log(`   ✓ ${r.edital}`);
        console.log(`     → Study Plan: ${r.study_plan_id}`);
        console.log(`     → ${r.stats?.disciplines} disciplinas, ${r.stats?.topics} topics`);
        console.log(`     → Tempo: ${(r.duration / 1000).toFixed(2)}s\n`);
      });
  }

  if (summary.failed > 0) {
    console.log('❌ Testes com falha:');
    summary.results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`   ✗ ${r.edital}`);
        if (r.errors.length > 0) {
          console.log(`     Erros:`);
          r.errors.slice(0, 3).forEach(e => console.log(`     • ${e}`));
          if (r.errors.length > 3) {
            console.log(`     ... e mais ${r.errors.length - 3} erros`);
          }
        }
        console.log('');
      });
  }

  // Estatísticas agregadas
  if (summary.successful > 0) {
    const totalDisciplinas = summary.results
      .filter(r => r.success && r.stats)
      .reduce((acc, r) => acc + (r.stats?.disciplines || 0), 0);
    
    const totalTopics = summary.results
      .filter(r => r.success && r.stats)
      .reduce((acc, r) => acc + (r.stats?.topics || 0), 0);

    const avgDuration = summary.results
      .filter(r => r.success)
      .reduce((acc, r) => acc + r.duration, 0) / summary.successful;

    console.log('📈 Estatísticas Agregadas:');
    console.log(`   • Total de disciplinas criadas: ${totalDisciplinas}`);
    console.log(`   • Total de topics criados: ${totalTopics}`);
    console.log(`   • Tempo médio por edital: ${(avgDuration / 1000).toFixed(2)}s\n`);
  }

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                     FIM DOS TESTES                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Sair com código de erro se houver falhas
  if (summary.failed > 0) {
    process.exit(1);
  }
}

// Executar testes
runAllTests().catch(error => {
  console.error('\n💥 Erro fatal ao executar testes:');
  console.error(error);
  process.exit(1);
});
