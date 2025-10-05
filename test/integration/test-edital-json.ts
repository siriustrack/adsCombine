#!/usr/bin/env bun
/**
 * Teste do EditalProcessService
 * 
 * Testa o processamento de um edital já transcrito (arquivo TXT)
 * através do EditalProcessService + Claude AI
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { EditalProcessService } from '../../src/core/services/editais/edital-process.service';

// Diretório com os TXTs transcritos
const TEXT_DIR = path.join(process.cwd(), 'temp', 'editais-text-only');
const OUTPUT_DIR = path.join(process.cwd(), 'temp', 'editais-json');

interface TestResult {
  editalName: string;
  success: boolean;
  duration: number;
  outputFile: string;
  stats?: {
    concursos: number;
    totalDisciplinas: number;
    totalMaterias: number;
    totalQuestoes: number;
  };
  error?: string;
}

async function testEdital(txtPath: string, editalName: string): Promise<TestResult> {
  const startTime = Date.now();

  try {
    console.log(`\n📄 Processando: ${editalName}`);
    
    // Ler texto transcrito
    const text = await fs.readFile(txtPath, 'utf-8');
    console.log(`   📝 Tamanho: ${text.length.toLocaleString()} caracteres`);
    console.log(`   🤖 Enviando para Claude AI...`);

    // Criar instância do serviço
    const service = new EditalProcessService();
    
    // Como o método processWithClaude é privado, vamos usar uma abordagem alternativa:
    // Criar um arquivo temporário simulando uma URL local
    const tempUrl = `file://${txtPath}`;
    const outputFileName = `${path.basename(editalName, '.txt')}.json`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);

    // Usar o método público mas com um hack: escrever o texto em um endpoint mock
    // OU... criar um método helper que chama direto o processWithClaude

    // Por enquanto, vou fazer diferente: ler o código e chamar direto via reflexão
    // Melhor: criar um servidor HTTP temporário para servir o arquivo

    // ALTERNATIVA MAIS SIMPLES: Copiar o texto para um arquivo que simule HTTP response
    const mockUrl = 'http://localhost:9999/mock-edital';
    
    console.log(`   ⚠️  AVISO: Método processWithClaude é privado`);
    console.log(`   ℹ️  Solução: Criar método público ou usar reflexão TypeScript`);

    // Vou fazer um workaround: acessar o método privado via reflexão
    const result = await (service as any).processWithClaude(text);

    const duration = Date.now() - startTime;

    // Salvar resultado
    await fs.writeFile(
      outputPath,
      JSON.stringify(result, null, 2),
      'utf-8'
    );

    // Calcular estatísticas
    const stats = {
      concursos: result.concursos.length,
      totalDisciplinas: result.validacao.totalDisciplinas,
      totalMaterias: result.validacao.totalMaterias,
      totalQuestoes: result.concursos.reduce(
        (sum: number, c: any) => sum + (c.metadata.totalQuestions || 0),
        0
      ),
    };

    console.log(`   ✅ Processado com sucesso!`);
    console.log(`   📊 Estatísticas:`);
    console.log(`      • Concursos: ${stats.concursos}`);
    console.log(`      • Disciplinas: ${stats.totalDisciplinas}`);
    console.log(`      • Matérias: ${stats.totalMaterias}`);
    console.log(`      • Questões: ${stats.totalQuestoes}`);
    console.log(`   ⏱️  Tempo: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   💾 Salvo em: ${outputFileName}`);

    return {
      editalName,
      success: true,
      duration,
      outputFile: outputPath,
      stats,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`   ❌ Erro: ${(error as Error).message}`);

    return {
      editalName,
      success: false,
      duration,
      outputFile: '',
      error: (error as Error).message,
    };
  }
}

async function main() {
  const editalToTest = process.argv[2] || 'edital ENAC.txt';

  console.log('🎯 TESTE DO EDITAL PROCESS SERVICE 🎯\n');
  console.log(`📄 Edital selecionado: ${editalToTest}\n`);

  // Criar diretório de saída
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Caminho do arquivo
  const txtPath = path.join(TEXT_DIR, editalToTest);

  // Verificar se existe
  try {
    await fs.access(txtPath);
  } catch {
    console.error(`❌ Arquivo não encontrado: ${txtPath}`);
    console.log('\n📚 Editais disponíveis:');
    const files = await fs.readdir(TEXT_DIR);
    files.filter(f => f.endsWith('.txt') && f !== '_SUMMARY.json')
      .forEach(f => console.log(`   • ${f}`));
    process.exit(1);
  }

  // Processar
  const result = await testEdital(txtPath, editalToTest);

  // Sumário
  console.log('\n\n📊 RESULTADO DO TESTE');
  console.log('==========================================');

  if (result.success) {
    console.log('✅ Status: SUCESSO');
    console.log(`⏱️  Tempo total: ${(result.duration / 1000).toFixed(2)}s`);
    console.log(`💾 Arquivo: ${result.outputFile}`);
  } else {
    console.log('❌ Status: FALHA');
    console.log(`⚠️  Erro: ${result.error}`);
  }

  console.log('\n✨ Teste concluído!\n');
}

main().catch(console.error);
