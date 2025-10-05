#!/usr/bin/env bun
/**
 * Script para testar processamento de um edital individual
 * Uso: bun test/integration/test-single-edital.ts "nome-do-edital.pdf"
 */

import fs from 'node:fs';
import path from 'node:path';
import { 
  EditalProcessService, 
  EditalProcessadoSchema,
  validateEditalIntegrity,
  type EditalProcessado 
} from '../../src/core/services/editais';
import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service';

const TEST_EDITAIS_DIR = path.join(__dirname, '../../docs/editais-test');
const OUTPUT_DIR = path.join(__dirname, '../../temp/test-results');

interface TestResult {
  editalName: string;
  passed: boolean;
  score: number;
  duration: number;
  pdfExtraction: {
    success: boolean;
    textLength: number;
    duration: number;
  };
  processing: {
    success: boolean;
    chunked: boolean;
    chunkCount?: number;
    duration: number;
  };
  validation: {
    schemaValid: boolean;
    integrityValid: boolean;
    concursosCount: number;
    disciplinasCount: number;
    materiasCount: number;
    totalQuestoes: number;
  };
  errors: string[];
  warnings: string[];
  details: any;
}

/**
 * Extrai texto do PDF
 */
async function extractTextFromPDF(pdfPath: string): Promise<{ text: string; duration: number }> {
  const startTime = Date.now();
  console.log(`\n📄 Extraindo texto de: ${path.basename(pdfPath)}`);
  
  const pdfService = new ProcessPdfService();
  
  // Read file and convert to base64 (simulating upload)
  const fileBuffer = fs.readFileSync(pdfPath);
  const base64Data = fileBuffer.toString('base64');
  const dataUrl = `data:application/pdf;base64,${base64Data}`;
  
  const result = await pdfService.execute({
    fileId: path.parse(pdfPath).name,
    url: dataUrl,
    mimeType: 'application/pdf',
  });

  if (result.error) {
    throw new Error(`Falha ao extrair texto: ${result.error.message}`);
  }

  const text = result.value; // Result<string, Error> returns string directly
  const duration = Date.now() - startTime;
  
  console.log(`   ✅ Texto extraído: ${text.length} caracteres`);
  console.log(`   ⏱️  Tempo: ${duration}ms`);
  
  return { text, duration };
}

/**
 * Processa o edital com Claude AI
 */
async function processEdital(text: string, editalName: string): Promise<{
  result: EditalProcessado;
  duration: number;
  chunked: boolean;
  chunkCount?: number;
}> {
  const startTime = Date.now();
  console.log(`\n🤖 Processando com Claude AI...`);
  
  const editalService = new EditalProcessService();
  
  // Process (will use chunking if needed)
  const processed = await editalService['processWithChunking'](text);
  
  const duration = Date.now() - startTime;
  const chunked = text.length > 80000;
  const chunkCount = chunked ? Math.ceil(text.length / 80000) : undefined;
  
  if (chunked) {
    console.log(`   📦 Edital grande! Dividido em ${chunkCount} chunks`);
  }
  console.log(`   ✅ Processamento concluído`);
  console.log(`   ⏱️  Tempo: ${duration}ms`);
  
  return {
    result: processed,
    duration,
    chunked,
    chunkCount,
  };
}

/**
 * Valida o edital processado
 */
function validateEdital(edital: EditalProcessado): {
  score: number;
  errors: string[];
  warnings: string[];
  details: any;
} {
  console.log(`\n✅ Validando resultado...`);
  
  let score = 100;
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 1. SCHEMA VALIDATION (50 points)
  try {
    EditalProcessadoSchema.parse(edital);
    console.log('   ✅ Schema válido (+50 pontos)');
  } catch (error: any) {
    errors.push(`Schema inválido: ${error.message}`);
    score -= 50;
    console.log('   ❌ Schema inválido (-50 pontos)');
  }
  
  // 2. INTEGRITY VALIDATION (20 points)
  const integrityResult = validateEditalIntegrity(edital);
  if (!integrityResult.isValid) {
    errors.push(...integrityResult.errors);
    warnings.push(...integrityResult.warnings);
    score -= 20;
    console.log('   ❌ Integridade falhou (-20 pontos)');
  } else {
    console.log('   ✅ Integridade OK (+20 pontos)');
  }
  
  // 3. COMPLETENESS CHECK (20 points)
  let completenessScore = 20;
  
  for (const concurso of edital.concursos) {
    // Check metadata
    if (!concurso.metadata.examName) {
      errors.push('Nome do concurso ausente');
      completenessScore -= 5;
    }
    if (!concurso.metadata.examOrg) {
      errors.push('Organização do concurso ausente');
      completenessScore -= 5;
    }
    if (!concurso.metadata.startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      errors.push(`Formato de data inválido: ${concurso.metadata.startDate}`);
      completenessScore -= 5;
    }
    
    // Check phases
    if (concurso.fases.length === 0) {
      errors.push('Nenhuma fase encontrada');
      completenessScore -= 10;
    }
    
    // Check disciplines
    if (concurso.disciplinas.length === 0) {
      errors.push('Nenhuma disciplina encontrada');
      completenessScore -= 20;
    }
    
    // Check subjects in disciplines
    for (const disciplina of concurso.disciplinas) {
      if (disciplina.materias.length === 0) {
        errors.push(`Disciplina "${disciplina.nome}" sem matérias`);
        completenessScore -= 5;
      }
    }
  }
  
  score -= Math.max(0, 20 - completenessScore);
  console.log(`   ${completenessScore === 20 ? '✅' : '⚠️'} Completude: ${completenessScore}/20 pontos`);
  
  // 4. LEGISLATION CHECK (10 points)
  let legislationScore = 10;
  let totalLegislacoes = 0;
  
  for (const concurso of edital.concursos) {
    for (const disciplina of concurso.disciplinas) {
      for (const materia of disciplina.materias) {
        totalLegislacoes += materia.legislacoes.length;
        
        for (const leg of materia.legislacoes) {
          if (!leg.numero || !leg.ano) {
            errors.push(`Legislação inválida em "${materia.nome}": falta número ou ano`);
            legislationScore -= 2;
          }
          if (leg.ano && !leg.ano.match(/^\d{4}$/)) {
            errors.push(`Ano de legislação inválido: ${leg.ano}`);
            legislationScore -= 2;
          }
        }
      }
    }
  }
  
  score -= Math.max(0, 10 - legislationScore);
  console.log(`   ${legislationScore === 10 ? '✅' : '⚠️'} Legislações: ${totalLegislacoes} encontradas (${legislationScore}/10 pontos)`);
  
  // Details
  const details = {
    concursos: edital.concursos.length,
    disciplinas: edital.concursos.reduce((acc, c) => acc + c.disciplinas.length, 0),
    materias: edital.concursos.reduce((acc, c) => 
      acc + c.disciplinas.reduce((acc2, d) => acc2 + d.materias.length, 0), 0),
    legislacoes: totalLegislacoes,
    totalQuestoes: edital.validacao.totalQuestoes,
    integridadeOK: integrityResult.isValid,
  };
  
  console.log(`\n📊 Estatísticas:`);
  console.log(`   • Concursos: ${details.concursos}`);
  console.log(`   • Disciplinas: ${details.disciplinas}`);
  console.log(`   • Matérias: ${details.materias}`);
  console.log(`   • Legislações: ${details.legislacoes}`);
  console.log(`   • Total Questões: ${details.totalQuestoes}`);
  
  return { score, errors, warnings, details };
}

/**
 * Testa um edital específico
 */
async function testEdital(editalName: string): Promise<TestResult> {
  console.log('\n' + '='.repeat(80));
  console.log(`🎯 TESTANDO: ${editalName}`);
  console.log('='.repeat(80));
  
  const startTime = Date.now();
  const pdfPath = path.join(TEST_EDITAIS_DIR, editalName);
  
  // Verify file exists
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Arquivo não encontrado: ${pdfPath}`);
  }
  
  const result: TestResult = {
    editalName,
    passed: false,
    score: 0,
    duration: 0,
    pdfExtraction: {
      success: false,
      textLength: 0,
      duration: 0,
    },
    processing: {
      success: false,
      chunked: false,
      duration: 0,
    },
    validation: {
      schemaValid: false,
      integrityValid: false,
      concursosCount: 0,
      disciplinasCount: 0,
      materiasCount: 0,
      totalQuestoes: 0,
    },
    errors: [],
    warnings: [],
    details: {},
  };
  
  try {
    // Step 1: Extract text from PDF
    const { text, duration: pdfDuration } = await extractTextFromPDF(pdfPath);
    result.pdfExtraction = {
      success: true,
      textLength: text.length,
      duration: pdfDuration,
    };
    
    // Step 2: Process with Claude
    const { 
      result: edital, 
      duration: processingDuration,
      chunked,
      chunkCount,
    } = await processEdital(text, editalName);
    
    result.processing = {
      success: true,
      chunked,
      chunkCount,
      duration: processingDuration,
    };
    
    // Step 3: Validate result
    const validation = validateEdital(edital);
    result.score = validation.score;
    result.errors = validation.errors;
    result.warnings = validation.warnings;
    result.details = validation.details;
    
    result.validation = {
      schemaValid: validation.score >= 50,
      integrityValid: validation.details.integridadeOK,
      concursosCount: validation.details.concursos,
      disciplinasCount: validation.details.disciplinas,
      materiasCount: validation.details.materias,
      totalQuestoes: validation.details.totalQuestoes,
    };
    
    result.passed = result.score >= 95;
    result.duration = Date.now() - startTime;
    
    // Save detailed result
    const outputPath = path.join(OUTPUT_DIR, `${path.parse(editalName).name}.json`);
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        ...result,
        editalData: edital,
      }, null, 2)
    );
    
    console.log(`\n💾 Resultado salvo em: ${outputPath}`);
    
  } catch (error: any) {
    result.errors.push(error.message);
    result.passed = false;
    console.error(`\n❌ ERRO: ${error.message}`);
    console.error(error.stack);
  }
  
  // Print final result
  console.log('\n' + '='.repeat(80));
  console.log(`📈 RESULTADO FINAL: ${editalName}`);
  console.log('='.repeat(80));
  console.log(`Status: ${result.passed ? '✅ APROVADO' : '❌ REPROVADO'}`);
  console.log(`Score: ${result.score}/100 (mínimo: 95)`);
  console.log(`Tempo Total: ${result.duration}ms`);
  
  if (result.errors.length > 0) {
    console.log(`\n❌ Erros (${result.errors.length}):`);
    result.errors.forEach(err => console.log(`   • ${err}`));
  }
  
  if (result.warnings.length > 0) {
    console.log(`\n⚠️  Avisos (${result.warnings.length}):`);
    result.warnings.forEach(warn => console.log(`   • ${warn}`));
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
  
  return result;
}

// Main execution
async function main() {
  const editalName = process.argv[2];
  
  if (!editalName) {
    console.error('❌ Uso: bun test/integration/test-single-edital.ts "nome-do-edital.pdf"');
    console.error('\nEditais disponíveis:');
    const editais = fs.readdirSync(TEST_EDITAIS_DIR).filter(f => f.endsWith('.pdf'));
    editais.forEach(e => console.log(`   • ${e}`));
    process.exit(1);
  }
  
  const result = await testEdital(editalName);
  process.exit(result.passed ? 0 : 1);
}

main().catch(console.error);
