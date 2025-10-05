#!/usr/bin/env bun
/**
 * Script para transcrever todos os PDFs de editais DIRETAMENTE
 * Usa ProcessPdfService sem precisar da API
 * 
 * Uso: bun test/integration/transcribe-editais-direct.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service';

const TEST_EDITAIS_DIR = path.join(__dirname, '../../docs/editais-test');
const OUTPUT_DIR = path.join(__dirname, '../../temp/editais-transcribed');

interface TranscriptionResult {
  editalName: string;
  success: boolean;
  textLength: number;
  duration: number;
  outputFile: string;
  error?: string;
}

/**
 * Transcreve um PDF diretamente
 */
async function transcribePDF(pdfPath: string): Promise<TranscriptionResult> {
  const editalName = path.basename(pdfPath);
  const startTime = Date.now();
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📄 Transcrevendo: ${editalName}`);
  console.log('='.repeat(80));
  
  try {
    // Ler arquivo PDF
    const fileBuffer = fs.readFileSync(pdfPath);
    const base64Data = fileBuffer.toString('base64');
    const dataUrl = `data:application/pdf;base64,${base64Data}`;
    
    console.log(`   📦 Tamanho do arquivo: ${(fileBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   🔄 Processando com ProcessPdfService...`);
    
    // Processar PDF
    const pdfService = new ProcessPdfService();
    const result = await pdfService.execute({
      fileId: path.parse(editalName).name,
      url: dataUrl,
      mimeType: 'application/pdf',
    });
    
    if (result.error) {
      throw new Error(result.error.message);
    }
    
    const extractedText = result.value;
    
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('Nenhum texto extraído do PDF');
    }
    
    // Salvar texto extraído
    const outputFileName = `${path.parse(editalName).name}.txt`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);
    
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, extractedText, 'utf8');
    
    const duration = Date.now() - startTime;
    
    console.log(`\n   ✅ SUCESSO!`);
    console.log(`   📝 Texto extraído: ${extractedText.length.toLocaleString()} caracteres`);
    console.log(`   💾 Salvo em: ${path.basename(outputPath)}`);
    console.log(`   ⏱️  Tempo: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    
    return {
      editalName,
      success: true,
      textLength: extractedText.length,
      duration,
      outputFile: outputPath,
    };
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    console.error(`\n   ❌ ERRO: ${error.message}`);
    
    return {
      editalName,
      success: false,
      textLength: 0,
      duration,
      outputFile: '',
      error: error.message,
    };
  }
}

/**
 * Transcreve todos os PDFs
 */
async function transcribeAll() {
  console.log('\n' + '🎯'.repeat(40));
  console.log('TRANSCRIÇÃO DIRETA DE EDITAIS (sem API)');
  console.log('🎯'.repeat(40) + '\n');
  
  // Listar PDFs
  const pdfFiles = fs.readdirSync(TEST_EDITAIS_DIR)
    .filter(f => f.endsWith('.pdf'))
    .sort();
  
  console.log(`📚 Encontrados ${pdfFiles.length} PDFs:\n`);
  pdfFiles.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
  console.log('');
  
  // Criar diretório de saída
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Processar cada PDF
  const results: TranscriptionResult[] = [];
  
  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    const pdfPath = path.join(TEST_EDITAIS_DIR, pdfFile);
    
    console.log(`\n[${ i + 1}/${pdfFiles.length}]`);
    
    const result = await transcribePDF(pdfPath);
    results.push(result);
    
    // Aguardar um pouco entre processamentos
    if (i < pdfFiles.length - 1) {
      console.log('\n   ⏳ Aguardando 1 segundo...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Salvar sumário
  const summaryPath = path.join(OUTPUT_DIR, '_SUMMARY.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), 'utf8');
  
  // Estatísticas finais
  console.log('\n' + '='.repeat(80));
  console.log('📊 RESUMO FINAL DA TRANSCRIÇÃO');
  console.log('='.repeat(80));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n✅ Sucessos: ${successful.length}/${results.length}`);
  console.log(`❌ Falhas: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    console.log(`\n📝 Textos extraídos:`);
    for (const r of successful) {
      console.log(`   • ${r.editalName.padEnd(40)} ${r.textLength.toLocaleString().padStart(10)} chars  (${(r.duration/1000).toFixed(1)}s)`);
    }
    
    const totalChars = successful.reduce((acc, r) => acc + r.textLength, 0);
    const avgChars = totalChars / successful.length;
    const totalTime = results.reduce((acc, r) => acc + r.duration, 0);
    
    console.log(`\n📈 Estatísticas:`);
    console.log(`   • Total de caracteres: ${totalChars.toLocaleString()}`);
    console.log(`   • Média por edital: ${Math.round(avgChars).toLocaleString()} chars`);
    console.log(`   • Tempo total: ${(totalTime/1000).toFixed(1)}s (${(totalTime/60000).toFixed(1)} minutos)`);
    console.log(`   • Tempo médio por edital: ${(totalTime/1000/results.length).toFixed(1)}s`);
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Falhas:`);
    for (const r of failed) {
      console.log(`   • ${r.editalName}: ${r.error}`);
    }
  }
  
  console.log(`\n💾 Arquivos salvos em: ${OUTPUT_DIR}`);
  console.log(`📄 Sumário salvo em: ${summaryPath}`);
  
  console.log('\n' + '='.repeat(80));
  console.log('🎉 TRANSCRIÇÃO CONCLUÍDA!');
  console.log('='.repeat(80) + '\n');
  
  process.exit(failed.length > 0 ? 1 : 0);
}

// Executar
transcribeAll().catch(error => {
  console.error('\n❌ ERRO FATAL:', error);
  console.error(error.stack);
  process.exit(1);
});
