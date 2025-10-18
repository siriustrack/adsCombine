#!/usr/bin/env bun
/**
 * Script para reprocessar editais do zero a partir dos arquivos text-only
 * Garante qualidade da extração antes de inserir no banco
 */

import { EditalProcessService } from '../src/core/services/editais/edital-process.service';
import { validateEditalIntegrity } from '../src/core/services/editais/edital-schema';
import fs from 'node:fs';
import path from 'node:path';

const TEXT_ONLY_DIR = path.join(__dirname, '../temp/editais-text-only');
const OUTPUT_DIR = path.join(__dirname, '../temp/editais-json-reprocessed');

// Lista de editais para reprocessar
const EDITAIS_TO_PROCESS = [
  'edital juiz sc.txt',
  'edital ENAC.txt',
  'edital MPRS.txt',
  'edital advogado da união.txt',
  'edital concurso cartórios rs.txt',
  'edital oab.txt',
  'edital prefeitura.txt',
];

interface ProcessResult {
  success: boolean;
  edital: string;
  duration?: number;
  error?: string;
  stats?: {
    concursos: number;
    disciplinas: number;
    materias: number;
    questoes: number;
    integridadeOK: boolean;
  };
}

async function reprocessEdital(fileName: string): Promise<ProcessResult> {
  const txtPath = path.join(TEXT_ONLY_DIR, fileName);
  const editalName = path.parse(fileName).name;
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📄 REPROCESSANDO: ${editalName}`);
  console.log('='.repeat(80));
  
  if (!fs.existsSync(txtPath)) {
    console.error(`❌ Arquivo não encontrado: ${txtPath}`);
    return { success: false, edital: editalName, error: 'File not found' };
  }

  const startTime = Date.now();
  
  try {
    // Ler conteúdo do texto
    console.log('📖 Lendo arquivo de texto...');
    const textContent = fs.readFileSync(txtPath, 'utf-8');
    console.log(`   ✓ ${textContent.length.toLocaleString()} caracteres lidos`);
    
    // Processar com Claude
    console.log('🤖 Processando com Claude Sonnet 4.5...');
    const editalService = new EditalProcessService();
    
    const processedData = await editalService.processWithClaude(textContent);
    
    // Validar integridade (mesmo fluxo da rota)
    console.log('✔️  Validando integridade do schema...');
    const validation = validateEditalIntegrity(processedData);
    
    if (!validation.isValid) {
      console.warn('⚠️  Validação encontrou problemas:');
      validation.errors.forEach(e => console.log(`   ❌ ${e}`));
      // Adiciona erros na validação do próprio dado
      processedData.validacao.erros.push(...validation.errors);
      processedData.validacao.avisos.push(...validation.warnings);
      processedData.validacao.integridadeOK = false;
    } else if (validation.warnings.length > 0) {
      console.warn('⚠️  Avisos de validação:');
      validation.warnings.forEach(w => console.log(`   • ${w}`));
      processedData.validacao.avisos.push(...validation.warnings);
    } else {
      console.log('   ✓ Validação passou sem erros');
    }
    
    // Salvar resultado
    const outputPath = path.join(OUTPUT_DIR, `${editalName}.json`);
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Adicionar metadata completa (mesmo fluxo da rota)
    const finalOutput = {
      ...processedData,
      metadataProcessamento: {
        ...processedData.metadataProcessamento,
        tempoProcessamento: parseInt(duration),
        processadoEm: new Date().toISOString(),
        fonte: 'reprocessamento-teste',
        arquivoOrigem: fileName,
      }
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2), 'utf-8');
    
    console.log(`\n✅ SUCESSO! Processado em ${duration}s`);
    console.log(`📊 Estatísticas:`);
    console.log(`   • Concursos: ${processedData.concursos.length}`);
    console.log(`   • Disciplinas: ${processedData.validacao.totalDisciplinas}`);
    console.log(`   • Matérias: ${processedData.validacao.totalMaterias}`);
    console.log(`   • Questões: ${processedData.validacao.totalQuestoes}`);
    console.log(`   • Integridade: ${processedData.validacao.integridadeOK ? '✓' : '✗'}`);
    
    if (processedData.validacao.avisos.length > 0) {
      console.log(`\n⚠️  Avisos (${processedData.validacao.avisos.length}):`);
      processedData.validacao.avisos.forEach(a => console.log(`   • ${a}`));
    }
    
    if (processedData.validacao.erros.length > 0) {
      console.log(`\n❌ Erros (${processedData.validacao.erros.length}):`);
      processedData.validacao.erros.forEach(e => console.log(`   • ${e}`));
    }
    
    console.log(`\n💾 Salvo em: ${outputPath}`);
    
    return { 
      success: true, 
      edital: editalName,
      duration: parseFloat(duration),
      stats: {
        concursos: processedData.concursos.length,
        disciplinas: processedData.validacao.totalDisciplinas,
        materias: processedData.validacao.totalMaterias,
        questoes: processedData.validacao.totalQuestoes,
        integridadeOK: processedData.validacao.integridadeOK,
      }
    };
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`\n❌ ERRO após ${duration}s:`);
    console.error(error instanceof Error ? error.message : 'Unknown error');
    
    return { 
      success: false, 
      edital: editalName, 
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: parseFloat(duration),
    };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          REPROCESSAMENTO DE EDITAIS - GARANTIA DE QUALIDADE               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\n📂 Diretório de entrada: ${TEXT_ONLY_DIR}`);
  console.log(`📂 Diretório de saída: ${OUTPUT_DIR}`);
  console.log(`📋 Total de editais: ${EDITAIS_TO_PROCESS.length}\n`);
  
  const results: ProcessResult[] = [];
  const startTime = Date.now();
  
  for (const editalFile of EDITAIS_TO_PROCESS) {
    const result = await reprocessEdital(editalFile);
    results.push(result);
    
    // Delay entre processamentos para evitar rate limit
    if (EDITAIS_TO_PROCESS.indexOf(editalFile) < EDITAIS_TO_PROCESS.length - 1) {
      console.log('\n⏸️  Aguardando 3s antes do próximo...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  // Resumo final
  console.log('\n\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                            RESUMO FINAL                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
  
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  console.log(`📊 Total processado: ${results.length} editais`);
  console.log(`✅ Sucessos: ${successCount}`);
  console.log(`❌ Falhas: ${failCount}`);
  console.log(`⏱️  Tempo total: ${totalDuration}s`);
  console.log(`📈 Taxa de sucesso: ${((successCount / results.length) * 100).toFixed(1)}%\n`);
  
  if (successCount > 0) {
    console.log('✅ Editais processados com sucesso:');
    results.filter(r => r.success).forEach(r => {
      console.log(`   ✓ ${r.edital}`);
      if (r.stats) {
        console.log(`     → ${r.stats.disciplinas} disciplinas, ${r.stats.materias} matérias, ${r.stats.questoes} questões`);
      }
    });
  }
  
  if (failCount > 0) {
    console.log('\n❌ Editais com falha:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   ✗ ${r.edital}`);
      console.log(`     Erro: ${r.error}`);
    });
  }
  
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         FIM DO REPROCESSAMENTO                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
  
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
