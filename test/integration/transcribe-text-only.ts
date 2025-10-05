#!/usr/bin/env bun
/**
 * Transcrição RÁPIDA dos Editais
 * 
 * Extrai apenas o texto básico do pdf-parse, sem OCR,
 * para ter os arquivos TXT rapidamente e poder prosseguir com os testes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import pdfParse from 'pdf-parse';
import { sanitizeText } from '../../src/utils/textSanitizer';

// Diretórios
const EDITAIS_DIR = path.join(process.cwd(), 'docs', 'editais-test');
const OUTPUT_DIR = path.join(process.cwd(), 'temp', 'editais-text-only');

interface TranscriptionResult {
  editalName: string;
  success: boolean;
  textLength: number;
  duration: number;
  outputFile: string;
  error?: string;
}

async function extractTextFromPDF(pdfPath: string): Promise<string> {
  const buffer = await fs.readFile(pdfPath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function transcribePDF(pdfPath: string, pdfName: string): Promise<TranscriptionResult> {
  const startTime = Date.now();

  try {
    console.log(`\n📄 Extraindo texto: ${pdfName}`);
    console.log(`   📦 Tamanho: ${((await fs.stat(pdfPath)).size / 1024).toFixed(2)} KB`);
    
    // Extrair texto com pdf-parse (SEM OCR)
    const text = await extractTextFromPDF(pdfPath);
    
    if (!text || text.trim().length === 0) {
      return {
        editalName: pdfName,
        success: false,
        textLength: 0,
        duration: Date.now() - startTime,
        outputFile: '',
        error: 'Nenhum texto extraído do PDF'
      };
    }

    // Sanitizar
    const sanitized = sanitizeText(text);
    const duration = Date.now() - startTime;

    // Salvar arquivo TXT
    const outputFileName = `${path.basename(pdfName, '.pdf')}.txt`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);
    await fs.writeFile(outputPath, sanitized, 'utf-8');

    console.log(`   ✅ Extraído: ${sanitized.length.toLocaleString()} caracteres`);
    console.log(`   ⏱️  Tempo: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   💾 Salvo em: ${outputFileName}`);

    return {
      editalName: pdfName,
      success: true,
      textLength: sanitized.length,
      duration,
      outputFile: outputPath
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`   ❌ Erro: ${(error as Error).message}`);
    
    return {
      editalName: pdfName,
      success: false,
      textLength: 0,
      duration,
      outputFile: '',
      error: (error as Error).message
    };
  }
}

async function transcribeAll() {
  console.log('🎯🎯🎯 TRANSCRIÇÃO RÁPIDA (SEM OCR) 🎯🎯🎯\n');

  // Criar diretório de saída
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Listar PDFs
  const files = await fs.readdir(EDITAIS_DIR);
  const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));

  console.log(`📚 Encontrados ${pdfs.length} PDFs:`);
  pdfs.forEach((pdf, i) => console.log(`   ${i + 1}. ${pdf}`));
  console.log();

  // Processar cada PDF
  const results: TranscriptionResult[] = [];
  for (let i = 0; i < pdfs.length; i++) {
    console.log(`\n[${ i + 1}/${pdfs.length}]`);
    console.log('========================================');
    
    const pdfPath = path.join(EDITAIS_DIR, pdfs[i]);
    const result = await transcribePDF(pdfPath, pdfs[i]);
    results.push(result);
  }

  // Sumário
  console.log('\n\n📊 SUMÁRIO DA TRANSCRIÇÃO');
  console.log('==========================================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Sucesso: ${successful.length}/${pdfs.length}`);
  console.log(`❌ Falhas: ${failed.length}/${pdfs.length}`);
  console.log(`📝 Total de caracteres: ${successful.reduce((sum, r) => sum + r.textLength, 0).toLocaleString()}`);
  console.log(`⏱️  Tempo total: ${(results.reduce((sum, r) => sum + r.duration, 0) / 1000).toFixed(2)}s`);

  if (failed.length > 0) {
    console.log('\n❌ Editais com falha:');
    failed.forEach(r => {
      console.log(`   • ${r.editalName}: ${r.error}`);
    });
  }

  // Salvar sumário
  const summaryPath = path.join(OUTPUT_DIR, '_SUMMARY.json');
  await fs.writeFile(summaryPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Sumário salvo em: ${summaryPath}`);

  console.log('\n✨ Transcrição concluída!\n');
}

// Executar
transcribeAll().catch(console.error);
