import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
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

describe('Edital Processing Integration Tests', () => {
  let editalService: EditalProcessService;
  let pdfService: ProcessPdfService;

  beforeAll(() => {
    editalService = new EditalProcessService();
    pdfService = new ProcessPdfService();
    
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup can be done here if needed
  });

  /**
   * Helper function to process PDF and extract text
   */
  async function extractTextFromPDF(pdfPath: string): Promise<string> {
    console.log(`\n📄 Extracting text from: ${path.basename(pdfPath)}`);
    
    // Create a mock URL for the PDF (since we have local file)
    const fileUrl = `file://${pdfPath}`;
    
    const result = await pdfService.execute({
      fileId: path.parse(pdfPath).name,
      url: fileUrl,
      mimeType: 'application/pdf',
    });

    if (result.error) {
      throw new Error(`Failed to extract text: ${result.error.message}`);
    }

    const text = result.value || '';
    console.log(`✅ Extracted ${text.length} characters`);
    return text;
  }

  /**
   * Helper function to validate edital with strict criteria
   */
  function validateEditalStrict(
    edital: EditalProcessado,
    pdfName: string
  ): {
    passed: boolean;
    score: number;
    errors: string[];
    warnings: string[];
    metrics: Record<string, number>;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    let score = 100;

    // 1. Schema validation
    try {
      EditalProcessadoSchema.parse(edital);
      console.log('✅ Schema validation passed');
    } catch (error) {
      errors.push(`Schema validation failed: ${error}`);
      score -= 50;
    }

    // 2. Integrity validation
    const integrity = validateEditalIntegrity(edital);
    if (!integrity.isValid) {
      errors.push(...integrity.errors);
      score -= 20;
    }
    warnings.push(...integrity.warnings);

    // 3. Data completeness
    for (const concurso of edital.concursos) {
      // Check metadata completeness
      if (!concurso.metadata.examName || concurso.metadata.examName.length < 10) {
        errors.push(`Exam name too short or missing: ${concurso.metadata.examName}`);
        score -= 5;
      }

      if (!concurso.metadata.examOrg) {
        errors.push('Exam organization missing');
        score -= 5;
      }

      if (!concurso.metadata.startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        errors.push(`Invalid date format: ${concurso.metadata.startDate}`);
        score -= 5;
      }

      // Check phases
      if (concurso.fases.length === 0) {
        errors.push('No exam phases found');
        score -= 10;
      }

      // Check disciplines
      if (concurso.disciplinas.length === 0) {
        errors.push('No disciplines found');
        score -= 20;
      }

      for (const disciplina of concurso.disciplinas) {
        // Check discipline has subjects
        if (disciplina.materias.length === 0) {
          errors.push(`Discipline "${disciplina.nome}" has no subjects`);
          score -= 5;
        }

        // Check subject order is sequential
        const ordens = disciplina.materias.map(m => m.ordem).sort((a, b) => a - b);
        const expectedOrdens = Array.from({ length: ordens.length }, (_, i) => i + 1);
        if (JSON.stringify(ordens) !== JSON.stringify(expectedOrdens)) {
          warnings.push(`Discipline "${disciplina.nome}" has non-sequential subject order`);
        }

        // Check for legislation extraction
        const legislacoesCount = disciplina.materias.reduce(
          (acc, m) => acc + m.legislacoes.length, 
          0
        );
        
        // Validate legislation format if present
        for (const materia of disciplina.materias) {
          for (const leg of materia.legislacoes) {
            if (!leg.numero || !leg.ano) {
              errors.push(`Invalid legislation in "${materia.nome}": missing number or year`);
              score -= 2;
            }
            if (!leg.ano.match(/^\d{4}$/)) {
              errors.push(`Invalid legislation year: ${leg.ano}`);
              score -= 2;
            }
          }
        }
      }
    }

    // 4. Calculate metrics
    const metrics = {
      totalConcursos: edital.concursos.length,
      totalDisciplinas: edital.validacao.totalDisciplinas,
      totalQuestoes: edital.validacao.totalQuestoes,
      totalMaterias: edital.validacao.totalMaterias,
      totalLegislacoes: edital.concursos.reduce((acc, c) => 
        acc + c.disciplinas.reduce((acc2, d) => 
          acc2 + d.materias.reduce((acc3, m) => acc3 + m.legislacoes.length, 0), 
        0), 
      0),
      avgMateriasPerDisciplina: edital.validacao.totalMaterias / edital.validacao.totalDisciplinas,
    };

    // Ensure score doesn't go below 0
    score = Math.max(0, score);

    return {
      passed: score >= 95, // 95% threshold for 99.99% precision goal
      score,
      errors,
      warnings,
      metrics,
    };
  }

  /**
   * Test each PDF edital
   */
  const testEditais = [
    'edital advogado da união.pdf',
    'edital concurso cartórios rs.pdf',
    'edital ENAC.pdf',
    'edital juiz sc.pdf',
    'edital juiz trf4.pdf',
    'edital MPRS.pdf',
    'edital oab.pdf',
    'edital prefeitura.pdf',
  ];

  testEditais.forEach((editalName) => {
    it(`should process "${editalName}" with 99%+ precision`, async () => {
      const pdfPath = path.join(TEST_EDITAIS_DIR, editalName);
      
      // Skip if file doesn't exist
      if (!fs.existsSync(pdfPath)) {
        console.warn(`⚠️  PDF not found: ${editalName}`);
        return;
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`📋 Testing: ${editalName}`);
      console.log('='.repeat(80));

      // Step 1: Extract text from PDF
      const startExtraction = Date.now();
      const extractedText = await extractTextFromPDF(pdfPath);
      const extractionTime = Date.now() - startExtraction;

      expect(extractedText).toBeTruthy();
      expect(extractedText.length).toBeGreaterThan(100);
      
      console.log(`⏱️  Extraction time: ${extractionTime}ms`);

      // Step 2: Process with edital service
      const startProcessing = Date.now();
      const processed = await editalService['processWithClaude'](extractedText);
      const processingTime = Date.now() - startProcessing;

      console.log(`⏱️  Processing time: ${processingTime}ms`);

      // Step 3: Validate result
      const validation = validateEditalStrict(processed, editalName);

      // Save result for inspection
      const outputPath = path.join(OUTPUT_DIR, `${path.parse(editalName).name}.json`);
      fs.writeFileSync(
        outputPath,
        JSON.stringify({
          edital: processed,
          validation,
          performance: {
            extractionTime,
            processingTime,
            totalTime: extractionTime + processingTime,
          },
        }, null, 2),
        'utf8'
      );

      console.log(`\n📊 Validation Results:`);
      console.log(`   Score: ${validation.score}%`);
      console.log(`   Status: ${validation.passed ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`\n📈 Metrics:`);
      Object.entries(validation.metrics).forEach(([key, value]) => {
        console.log(`   ${key}: ${typeof value === 'number' ? value.toFixed(2) : value}`);
      });

      if (validation.errors.length > 0) {
        console.log(`\n❌ Errors (${validation.errors.length}):`);
        validation.errors.forEach(err => console.log(`   - ${err}`));
      }

      if (validation.warnings.length > 0) {
        console.log(`\n⚠️  Warnings (${validation.warnings.length}):`);
        validation.warnings.slice(0, 5).forEach(warn => console.log(`   - ${warn}`));
        if (validation.warnings.length > 5) {
          console.log(`   ... and ${validation.warnings.length - 5} more`);
        }
      }

      console.log(`\n💾 Results saved to: ${outputPath}`);

      // Assertions
      expect(validation.score).toBeGreaterThanOrEqual(95);
      expect(validation.errors.length).toBe(0);
      expect(processed.concursos.length).toBeGreaterThan(0);
      expect(processed.validacao.totalDisciplinas).toBeGreaterThan(0);
      expect(processed.validacao.totalMaterias).toBeGreaterThan(0);

    }, 300000); // 5 minutes timeout per test
  });

  /**
   * Summary test to aggregate all results
   */
  it('should generate summary report', async () => {
    const results = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const content = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf8'));
        return {
          name: f.replace('.json', ''),
          ...content.validation,
          performance: content.performance,
        };
      });

    if (results.length === 0) {
      console.log('⚠️  No results to summarize');
      return;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 SUMMARY REPORT');
    console.log('='.repeat(80));

    const avgScore = results.reduce((acc, r) => acc + r.score, 0) / results.length;
    const passedCount = results.filter(r => r.passed).length;
    const totalErrors = results.reduce((acc, r) => acc + r.errors.length, 0);
    const avgProcessingTime = results.reduce((acc, r) => acc + r.performance.processingTime, 0) / results.length;

    console.log(`\n📈 Overall Metrics:`);
    console.log(`   Tests Run: ${results.length}`);
    console.log(`   Passed: ${passedCount}/${results.length} (${((passedCount/results.length)*100).toFixed(1)}%)`);
    console.log(`   Average Score: ${avgScore.toFixed(2)}%`);
    console.log(`   Total Errors: ${totalErrors}`);
    console.log(`   Avg Processing Time: ${avgProcessingTime.toFixed(0)}ms`);

    console.log(`\n📋 Individual Results:`);
    results.forEach(r => {
      const status = r.passed ? '✅' : '❌';
      console.log(`   ${status} ${r.name}: ${r.score}% (${r.errors.length} errors, ${r.performance.processingTime}ms)`);
    });

    // Save summary
    const summaryPath = path.join(OUTPUT_DIR, '_SUMMARY.json');
    fs.writeFileSync(
      summaryPath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        overall: {
          testsRun: results.length,
          passed: passedCount,
          failed: results.length - passedCount,
          avgScore,
          totalErrors,
          avgProcessingTime,
        },
        details: results,
      }, null, 2),
      'utf8'
    );

    console.log(`\n💾 Summary saved to: ${summaryPath}`);

    // Assert overall quality
    expect(avgScore).toBeGreaterThanOrEqual(95);
    expect(passedCount).toBe(results.length);
  }, 10000);
});
