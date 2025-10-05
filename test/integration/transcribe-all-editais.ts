#!/usr/bin/env bun
/**
 * Script para transcrever todos os PDFs de editais via API
 * Gera arquivos TXT para cada edital
 * 
 * Uso: bun test/integration/transcribe-all-editais.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000';
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
 * Transcreve um PDF via API
 */
async function transcribePDF(pdfPath: string): Promise<TranscriptionResult> {
  const editalName = path.basename(pdfPath);
  const startTime = Date.now();
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📄 Transcrevendo: ${editalName}`);
  console.log('='.repeat(80));
  
  try {
    // Criar FormData
    const formData = new FormData();
    
    // Simular estrutura da mensagem esperada pela API
    const messageData = {
      conversationId: `test-conversation-${Date.now()}`,
      body: {
        content: `Transcrição do edital: ${editalName}`,
        files: [
          {
            fileId: `edital-${Date.now()}`,
            fileName: editalName,
            fileType: 'application/pdf',
            fileSize: fs.statSync(pdfPath).size,
          }
        ]
      }
    };
    
    // Adicionar o JSON da mensagem
    formData.append('message', JSON.stringify(messageData));
    
    // Adicionar o arquivo PDF
    formData.append('file', fs.createReadStream(pdfPath), {
      filename: editalName,
      contentType: 'application/pdf',
    });
    
    console.log('📤 Enviando para API...');
    
    // Fazer request para API
    const response = await axios.post(
      `${API_BASE_URL}/api/messages/process-message`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'x-request-id': `test-${Date.now()}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 300000, // 5 minutos
      }
    );
    
    console.log('✅ Resposta recebida');
    console.log('📊 Status:', response.status);
    
    // Extrair texto da resposta
    let extractedText = '';
    
    if (response.data && Array.isArray(response.data)) {
      // A API retorna array de mensagens processadas
      for (const msg of response.data) {
        if (msg.body?.processedFiles) {
          for (const file of msg.body.processedFiles) {
            if (file.extractedText) {
              extractedText += file.extractedText + '\n\n';
            }
          }
        }
      }
    }
    
    if (!extractedText.trim()) {
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
    
    console.log(`\n✅ SUCESSO!`);
    console.log(`   📝 Texto extraído: ${extractedText.length} caracteres`);
    console.log(`   💾 Salvo em: ${outputPath}`);
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
    
    console.error(`\n❌ ERRO: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, error.response.data);
    }
    
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
  console.log('TRANSCRIÇÃO EM LOTE DE EDITAIS');
  console.log('🎯'.repeat(40));
  
  console.log('⚠️  Certifique-se de que o servidor está rodando: npm run dev\n');
  console.log('🔗 API Base URL:', API_BASE_URL);
  console.log('');
  
  // Listar PDFs
  const pdfFiles = fs.readdirSync(TEST_EDITAIS_DIR)
    .filter(f => f.endsWith('.pdf'))
    .sort();
  
  console.log(`📚 Encontrados ${pdfFiles.length} PDFs:\n`);
  pdfFiles.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
  console.log('');
  
  // Processar cada PDF
  const results: TranscriptionResult[] = [];
  
  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    const pdfPath = path.join(TEST_EDITAIS_DIR, pdfFile);
    
    console.log(`\n[${i + 1}/${pdfFiles.length}]`);
    
    const result = await transcribePDF(pdfPath);
    results.push(result);
    
    // Aguardar um pouco entre requisições
    if (i < pdfFiles.length - 1) {
      console.log('\n⏳ Aguardando 2 segundos antes do próximo...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Salvar sumário
  const summaryPath = path.join(OUTPUT_DIR, '_SUMMARY.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), 'utf8');
  
  // Estatísticas finais
  console.log('\n' + '='.repeat(80));
  console.log('📊 RESUMO FINAL');
  console.log('='.repeat(80));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n✅ Sucessos: ${successful.length}/${results.length}`);
  console.log(`❌ Falhas: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    console.log(`\n📝 Textos extraídos:`);
    for (const r of successful) {
      console.log(`   • ${r.editalName}: ${r.textLength.toLocaleString()} chars (${(r.duration/1000).toFixed(1)}s)`);
    }
    
    const totalChars = successful.reduce((acc, r) => acc + r.textLength, 0);
    const avgChars = totalChars / successful.length;
    const totalTime = results.reduce((acc, r) => acc + r.duration, 0);
    
    console.log(`\n📈 Estatísticas:`);
    console.log(`   • Total de caracteres: ${totalChars.toLocaleString()}`);
    console.log(`   • Média por edital: ${avgChars.toLocaleString()} chars`);
    console.log(`   • Tempo total: ${(totalTime/1000).toFixed(1)}s`);
    console.log(`   • Tempo médio: ${(totalTime/1000/results.length).toFixed(1)}s`);
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Falhas:`);
    for (const r of failed) {
      console.log(`   • ${r.editalName}: ${r.error}`);
    }
  }
  
  console.log(`\n💾 Arquivos salvos em: ${OUTPUT_DIR}`);
  console.log(`📄 Sumário salvo em: ${summaryPath}`);
  
  console.log('\n' + '='.repeat(80) + '\n');
  
  process.exit(failed.length > 0 ? 1 : 0);
}

// Executar
transcribeAll().catch(error => {
  console.error('❌ ERRO FATAL:', error);
  process.exit(1);
});
