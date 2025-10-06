#!/usr/bin/env bun
/**
 * Re-transcrever PDFs problemáticos usando OCR
 * Para editais que falharam ou podem ter perdido conteúdo no pdf-parse
 */

import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
	gray: '\x1b[90m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

const pdfsParaRetranscrever = [
	{
		input: 'docs/editais-test/edital concurso cartórios rs.pdf',
		output: 'temp/editais-text-only/edital concurso cartórios rs - OCR.txt',
		name: 'edital concurso cartórios rs.pdf',
	},
	// TRF4 é muito grande (14MB), vamos deixar por último
	// {
	// 	input: 'docs/editais-test/edital juiz trf4.pdf',
	// 	output: 'temp/editais-text-only/edital juiz trf4 - OCR.txt',
	// 	name: 'edital juiz trf4.pdf',
	// },
];

async function retranscreverComOCR(pdfPath: string, outputPath: string, name: string) {
	log(`\n${'='.repeat(80)}`, 'cyan');
	log(`📄 Retranscrevendo com OCR: ${name}`, 'bright');
	log(`${'='.repeat(80)}`, 'cyan');

	try {
		const startTime = Date.now();
		
		log(`   🔍 Iniciando ProcessPdfService com OCR habilitado...`, 'cyan');
		
		const service = new ProcessPdfService();
		const result = await service.execute({
			fileId: name.replace('.pdf', ''),
			url: `file://${process.cwd()}/${pdfPath}`,
			mimeType: 'application/pdf',
		});

		const duration = Date.now() - startTime;

		if (result.error || !result.value) {
			throw new Error(result.error?.message || 'Nenhum texto extraído');
		}

		// Salvar texto
		const text = result.value;
		writeFileSync(outputPath, text, 'utf-8');

		log(`   ✓ Texto extraído: ${text.length.toLocaleString()} caracteres`, 'green');
		log(`   ✓ Salvo em: ${outputPath}`, 'gray');
		log(`   ✓ Duração: ${Math.floor(duration / 1000)}s`, 'gray');

		// Estatísticas
		const lines = text.split('\n').length;
		const words = text.split(/\s+/).length;
		
		log(`\n   📊 Estatísticas:`, 'cyan');
		log(`      • Caracteres: ${text.length.toLocaleString()}`, 'gray');
		log(`      • Palavras: ${words.toLocaleString()}`, 'gray');
		log(`      • Linhas: ${lines.toLocaleString()}`, 'gray');

		return true;

	} catch (error: any) {
		log(`   ✗ ERRO: ${error.message}`, 'red');
		return false;
	}
}

async function main() {
	log('\n╔════════════════════════════════════════════════════════════════════════════╗', 'bright');
	log('║           RE-TRANSCRIÇÃO COM OCR - EDITAIS PROBLEMÁTICOS                  ║', 'bright');
	log('╚════════════════════════════════════════════════════════════════════════════╝', 'bright');

	log(`\n📋 PDFs para retranscrever: ${pdfsParaRetranscrever.length}`, 'cyan');
	pdfsParaRetranscrever.forEach((pdf, i) => {
		log(`   ${i + 1}. ${pdf.name}`, 'gray');
	});

	log(`\n⚠️  OCR pode demorar: ~30s-2min por PDF pequeno, muito mais para PDFs grandes\n`, 'yellow');

	let successCount = 0;
	const totalStartTime = Date.now();

	for (let i = 0; i < pdfsParaRetranscrever.length; i++) {
		const pdf = pdfsParaRetranscrever[i];
		const success = await retranscreverComOCR(pdf.input, pdf.output, pdf.name);
		
		if (success) {
			successCount++;
		}
	}

	const totalDuration = Date.now() - totalStartTime;

	log(`\n\n${'='.repeat(80)}`, 'bright');
	log('📊 RESULTADO FINAL', 'bright');
	log(`${'='.repeat(80)}`, 'bright');

	log(`\n✓ Sucesso: ${successCount}/${pdfsParaRetranscrever.length}`, successCount === pdfsParaRetranscrever.length ? 'green' : 'yellow');
	log(`⏱️  Tempo total: ${Math.floor(totalDuration / 60000)}m ${Math.floor((totalDuration % 60000) / 1000)}s`, 'cyan');

	if (successCount > 0) {
		log(`\n📝 Próximo passo: Processar os novos TXTs com Claude AI`, 'cyan');
		log(`   bun test/integration/test-edital-json.ts "edital concurso cartórios rs - OCR.txt"`, 'gray');
	}

	log(`\n${'='.repeat(80)}\n`, 'bright');

	process.exit(successCount === pdfsParaRetranscrever.length ? 0 : 1);
}

main().catch(error => {
	console.error('\n❌ Erro fatal:', error);
	process.exit(1);
});
