#!/usr/bin/env bun
/**
 * Teste rápido para validar o novo prompt com edital problemático
 * Testa apenas o Edital Juiz SC que tinha 3 blocos → deveria ter 14 disciplinas
 */

import { EditalProcessService } from '../src/core/services/editais/edital-process.service';
import { validateEditalIntegrity } from '../src/core/services/editais/edital-schema';
import fs from 'node:fs';
import path from 'node:path';

const TEXT_ONLY_DIR = path.join(__dirname, '../temp/editais-text-only');
const OUTPUT_DIR = path.join(__dirname, '../temp/editais-json-test-blocos-fix');

async function testEditalJuizSC() {
  const fileName = 'edital juiz sc.txt';
  const txtPath = path.join(TEXT_ONLY_DIR, fileName);
  const editalName = path.parse(fileName).name;
  
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         TESTE DO NOVO PROMPT - FIX BLOCOS vs DISCIPLINAS                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\n📄 Testando: ${editalName}`);
  console.log('📊 Extração anterior: 3 "blocos" (ERRADO)');
  console.log('🎯 Expectativa: 14 disciplinas reais\n');
  console.log('='.repeat(80));
  
  if (!fs.existsSync(txtPath)) {
    console.error(`❌ Arquivo não encontrado: ${txtPath}`);
    return;
  }

  const startTime = Date.now();
  
  try {
    // Ler conteúdo
    console.log('📖 Lendo arquivo de texto...');
    const textContent = fs.readFileSync(txtPath, 'utf-8');
    console.log(`   ✓ ${textContent.length.toLocaleString()} caracteres lidos`);
    
    // Processar com Claude usando NOVO PROMPT
    console.log('\n🤖 Processando com Claude Sonnet 4.5 (NOVO PROMPT EM INGLÊS)...');
    console.log('   ⚠️  Prompt atualizado com seção crítica sobre blocos vs disciplinas');
    const editalService = new EditalProcessService();
    
    const processedData = await editalService.processWithClaude(textContent);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Validar integridade
    console.log('\n✔️  Validando integridade do schema...');
    const validation = validateEditalIntegrity(processedData);
    
    if (!validation.isValid) {
      console.warn('⚠️  Validação encontrou problemas:');
      validation.errors.forEach(e => console.log(`   ❌ ${e}`));
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
    
    const finalOutput = {
      ...processedData,
      metadataProcessamento: {
        ...processedData.metadataProcessamento,
        tempoProcessamento: parseInt(duration),
        processadoEm: new Date().toISOString(),
        fonte: 'teste-blocos-fix',
        promptVersion: '2.0-english-blocks-fix',
        arquivoOrigem: fileName,
      }
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2), 'utf-8');
    
    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ PROCESSAMENTO CONCLUÍDO EM ${duration}s\n`);
    
    // Análise de resultados
    console.log('📊 ANÁLISE DE RESULTADOS:\n');
    console.log(`   Concursos extraídos: ${processedData.concursos.length}`);
    console.log(`   Disciplinas extraídas: ${processedData.validacao.totalDisciplinas}`);
    console.log(`   Matérias extraídas: ${processedData.validacao.totalMaterias}`);
    console.log(`   Questões totais: ${processedData.validacao.totalQuestoes}`);
    console.log(`   Integridade OK: ${processedData.validacao.integridadeOK ? '✓' : '✗'}`);
    
    // Lista de disciplinas
    console.log('\n📋 DISCIPLINAS EXTRAÍDAS:');
    processedData.concursos.forEach((concurso, idx) => {
      if (processedData.concursos.length > 1) {
        console.log(`\n   Concurso ${idx + 1}: ${concurso.metadata.examName}`);
      }
      concurso.disciplinas.forEach((disc, discIdx) => {
        const obs = disc.observacoes ? ` [${disc.observacoes}]` : '';
        console.log(`   ${discIdx + 1}. ${disc.nome} (${disc.numeroQuestoes} questões)${obs}`);
      });
    });
    
    // Comparação com resultado anterior
    console.log('\n' + '='.repeat(80));
    console.log('\n🔍 COMPARAÇÃO COM EXTRAÇÃO ANTERIOR:\n');
    console.log('   ❌ ANTES: 3 "disciplinas" (Bloco I, Bloco II, Bloco III)');
    console.log(`   ${processedData.validacao.totalDisciplinas >= 10 ? '✅' : '❌'} AGORA: ${processedData.validacao.totalDisciplinas} disciplinas`);
    
    if (processedData.validacao.totalDisciplinas >= 10) {
      console.log('\n   🎉 SUCESSO! Prompt corrigiu o problema de blocos vs disciplinas');
    } else {
      console.log('\n   ⚠️  AINDA TEM PROBLEMA - Menos de 10 disciplinas detectadas');
    }
    
    if (processedData.validacao.avisos.length > 0) {
      console.log('\n⚠️  AVISOS:');
      processedData.validacao.avisos.forEach(a => console.log(`   • ${a}`));
    }
    
    if (processedData.validacao.erros.length > 0) {
      console.log('\n❌ ERROS:');
      processedData.validacao.erros.forEach(e => console.log(`   • ${e}`));
    }
    
    console.log(`\n💾 Resultado salvo em: ${outputPath}`);
    console.log('\n' + '='.repeat(80));
    
    // Retornar resultado para análise programática
    return {
      success: processedData.validacao.totalDisciplinas >= 10,
      disciplinas: processedData.validacao.totalDisciplinas,
      expected: 14,
      duration: parseFloat(duration)
    };
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`\n❌ ERRO após ${duration}s:`);
    console.error(error instanceof Error ? error.message : 'Unknown error');
    console.error(error instanceof Error ? error.stack : '');
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: parseFloat(duration)
    };
  }
}

// Executar teste
testEditalJuizSC()
  .then((result) => {
    console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                         RESULTADO DO TESTE                                 ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
    
    if (result && result.success) {
      console.log('   ✅ TESTE PASSOU! Prompt corrigiu o problema.');
      console.log(`   📊 Extraídas: ${result.disciplinas} disciplinas (esperado: ${result.expected})`);
      console.log(`   ⏱️  Tempo: ${result.duration}s`);
      process.exit(0);
    } else if (result && !result.success && !result.error) {
      console.log('   ❌ TESTE FALHOU! Ainda extrai poucos disciplinas.');
      console.log(`   📊 Extraídas: ${result.disciplinas} disciplinas (esperado: ${result.expected})`);
      console.log(`   ⏱️  Tempo: ${result.duration}s`);
      process.exit(1);
    } else {
      console.log('   ❌ ERRO durante processamento');
      console.log(`   🐛 ${result?.error || 'Unknown error'}`);
      console.log(`   ⏱️  Tempo: ${result?.duration || 'N/A'}s`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('\n💥 ERRO FATAL:', err);
    process.exit(1);
  });
