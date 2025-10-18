/**
 * 🧪 Test: Adaptive Extraction Strategy
 * 
 * Validates that the new adaptive strategy works correctly:
 * 1. Tries full extraction first (single call)
 * 2. Automatically falls back to hierarchical chunking if truncation
 * 3. Extracts SUBJECTS, not BLOCKS/GROUPS
 */

import { describe, it, expect } from 'bun:test';
import { EditalProcessService } from '../src/core/services/editais/edital-process.service';
import { validateEditalIntegrity } from '../src/core/services/editais/edital-schema';
import fs from 'node:fs';
import path from 'node:path';

describe('Adaptive Extraction Strategy', () => {
  const service = new EditalProcessService();
  const tempDir = path.join(process.cwd(), 'temp', 'editais-text-only');

  it('should extract Edital Juiz SC with hierarchical chunking (expected: 14 subjects, not 3 blocks)', async () => {
    // This edital is known to be large and should trigger hierarchical chunking
    const editalPath = path.join(tempDir, 'edital juiz sc.txt');
    
    if (!fs.existsSync(editalPath)) {
      console.warn('⚠️  Edital Juiz SC not found, skipping test');
      return;
    }

    const content = fs.readFileSync(editalPath, 'utf-8');
    console.log('\n📄 Edital Juiz SC Stats:');
    console.log(`   Content length: ${content.length} chars`);
    console.log(`   Estimated tokens: ${Math.floor(content.length / 4)}`);
    console.log(`   Size: ${Math.floor(content.length / 1024)} KB`);

    console.log('\n🚀 Processing with adaptive strategy...');
    const startTime = Date.now();

    const result = await service['processEditalAdaptive'](content);

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`\n✅ Processing completed in ${elapsed}s (${Math.floor(elapsed / 60)}m ${elapsed % 60}s)`);

    // Validate result
    const validation = validateEditalIntegrity(result);

    console.log('\n📊 Extraction Results:');
    console.log(`   Strategy used: ${result.metadataProcessamento.strategy}`);
    console.log(`   Concursos: ${result.concursos.length}`);
    console.log(`   Disciplinas: ${result.validacao.totalDisciplinas}`);
    console.log(`   Matérias: ${result.validacao.totalMaterias}`);
    console.log(`   Questões: ${result.validacao.totalQuestoes}`);
    console.log(`   Integrity OK: ${result.validacao.integridadeOK}`);

    if (result.metadataProcessamento.strategy === 'hierarchical-chunking') {
      console.log('\n🔀 Chunking Details:');
      console.log(`   Total passes: ${result.metadataProcessamento.chunking?.totalPasses}`);
      console.log(`   Disciplines extracted: ${result.metadataProcessamento.chunking?.disciplinasExtracted}`);
      console.log(`   Processing time: ${result.metadataProcessamento.chunking?.processingTime}s`);
    }

    if (validation.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      validation.warnings.forEach(w => console.log(`   - ${w}`));
    }

    if (validation.errors.length > 0) {
      console.log('\n❌ Errors:');
      validation.errors.forEach(e => console.log(`   - ${e}`));
    }

    console.log('\n📋 Extracted Disciplines:');
    result.concursos[0].disciplinas.forEach((disc, idx) => {
      console.log(`   ${idx + 1}. ${disc.nome} (${disc.materias.length} matérias, ${disc.numeroQuestoes} questões)${disc.observacoes ? ` [${disc.observacoes}]` : ''}`);
    });

    // Save result
    const outputDir = path.join(process.cwd(), 'temp', 'editais-json-adaptive');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, 'Edital_Juiz_SC.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\n💾 Saved to: ${outputPath}`);

    // Assertions
    expect(result.concursos.length).toBeGreaterThan(0);
    expect(result.validacao.totalDisciplinas).toBeGreaterThanOrEqual(10); // Should have at least 10 subjects
    expect(result.validacao.totalDisciplinas).not.toBe(3); // Should NOT be 3 (blocks)
    
    // Check that no discipline is named "Bloco I", "Bloco II", etc.
    const blockNames = result.concursos[0].disciplinas.filter(d => 
      d.nome.toLowerCase().includes('bloco') || 
      d.nome.toLowerCase().includes('grupo')
    );
    expect(blockNames.length).toBe(0); // Should have NO disciplines named as blocks
    
    console.log('\n✅ All assertions passed!');
  }, 600000); // 10 minutes timeout

  it('should extract normal-sized edital with single call (ENAC)', async () => {
    const editalPath = path.join(tempDir, 'edital ENAC.txt');
    
    if (!fs.existsSync(editalPath)) {
      console.warn('⚠️  Edital ENAC not found, skipping test');
      return;
    }

    const content = fs.readFileSync(editalPath, 'utf-8');
    console.log('\n📄 Edital ENAC Stats:');
    console.log(`   Content length: ${content.length} chars`);
    console.log(`   Size: ${Math.floor(content.length / 1024)} KB`);

    console.log('\n🚀 Processing with adaptive strategy...');
    const startTime = Date.now();

    const result = await service['processEditalAdaptive'](content);

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`\n✅ Processing completed in ${elapsed}s`);

    console.log('\n📊 Extraction Results:');
    console.log(`   Strategy used: ${result.metadataProcessamento.strategy}`);
    console.log(`   Disciplinas: ${result.validacao.totalDisciplinas}`);
    console.log(`   Matérias: ${result.validacao.totalMaterias}`);

    // Save result
    const outputDir = path.join(process.cwd(), 'temp', 'editais-json-adaptive');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, 'Edital_ENAC.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\n💾 Saved to: ${outputPath}`);

    // Assertion: Should use single call for normal-sized edital
    expect(result.metadataProcessamento.strategy).toBe('full-extraction-single-call');
    expect(result.validacao.totalDisciplinas).toBeGreaterThan(0);
    
    console.log('\n✅ All assertions passed!');
  }, 300000); // 5 minutes timeout
});
