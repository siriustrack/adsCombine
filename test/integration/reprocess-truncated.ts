#!/usr/bin/env bun
/**
 * Script para reprocessar editais truncados
 * Com configuração otimizada para evitar truncamento
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EditalProcessService } from '../../src/core/services/editais/edital-process.service';

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

const editaisParaReprocessar = [
	'edital advogado da união.txt',
	'edital concurso cartórios rs.txt',
];

async function reprocessarEdital(filename: string, index: number, total: number) {
	log(`\n${'='.repeat(80)}`, 'cyan');
	log(`📄 Reprocessando [${index}/${total}]: ${filename}`, 'bright');
	log(`${'='.repeat(80)}`, 'cyan');

	const txtPath = join('temp/editais-text-only', filename);
	const outputPath = join('temp/editais-json', filename.replace('.txt', '.json'));

	try {
		// Ler texto
		const text = readFileSync(txtPath, 'utf-8');
		log(`   ✓ Texto lido: ${text.length.toLocaleString()} caracteres`, 'gray');

		// Processar
		log(`   🤖 Enviando para Claude AI (max_tokens aumentado)...`, 'cyan');
		const startTime = Date.now();
		
		const service = new EditalProcessService();
		const result = await (service as any).processWithClaude(text);

		const duration = Date.now() - startTime;

		if (!result.success) {
			throw new Error(result.error || 'Erro no processamento');
		}

		// Salvar
		const jsonContent = JSON.stringify(result.data, null, 2);
		writeFileSync(outputPath, jsonContent, 'utf-8');

		log(`   ✓ JSON salvo: ${outputPath}`, 'green');
		log(`   ✓ Tamanho: ${jsonContent.length.toLocaleString()} bytes`, 'gray');
		log(`   ✓ Duração: ${Math.floor(duration / 1000)}s`, 'gray');

		// Estatísticas
		const data = result.data;
		log(`\n   📊 Estatísticas:`, 'cyan');
		log(`      • Concursos: ${data.concursos?.length || 0}`, 'gray');
		log(`      • Disciplinas: ${data.validacao?.totalDisciplinas || 0}`, 'gray');
		log(`      • Matérias: ${data.validacao?.totalMaterias || 0}`, 'gray');
		log(`      • Questões: ${data.validacao?.totalQuestoes || 0}`, 'gray');
		log(`      • Legislações: ${data.validacao?.totalLegislacoes || 0}`, 'gray');
		log(`      • Integridade: ${data.validacao?.integridadeOK ? '✓ OK' : '✗ FALHOU'}`, data.validacao?.integridadeOK ? 'green' : 'red');

		return true;

	} catch (error: any) {
		log(`   ✗ ERRO: ${error.message}`, 'red');
		return false;
	}
}

async function main() {
	log('\n╔════════════════════════════════════════════════════════════════════════════╗', 'bright');
	log('║              REPROCESSAMENTO DE EDITAIS TRUNCADOS                          ║', 'bright');
	log('╚════════════════════════════════════════════════════════════════════════════╝', 'bright');

	log(`\n📋 Editais para reprocessar: ${editaisParaReprocessar.length}`, 'cyan');
	editaisParaReprocessar.forEach((file, i) => {
		log(`   ${i + 1}. ${file}`, 'gray');
	});

	log(`\n⏱️  Aguardando 60s entre processamentos para evitar rate limit\n`, 'yellow');

	let successCount = 0;
	const totalStartTime = Date.now();

	for (let i = 0; i < editaisParaReprocessar.length; i++) {
		const success = await reprocessarEdital(editaisParaReprocessar[i], i + 1, editaisParaReprocessar.length);
		
		if (success) {
			successCount++;
		}

		// Aguardar entre processamentos (exceto no último)
		if (i < editaisParaReprocessar.length - 1) {
			log(`\n   ⏸️  Aguardando 60s...`, 'yellow');
			await new Promise(resolve => setTimeout(resolve, 60000));
		}
	}

	const totalDuration = Date.now() - totalStartTime;

	log(`\n\n${'='.repeat(80)}`, 'bright');
	log('📊 RESULTADO FINAL', 'bright');
	log(`${'='.repeat(80)}`, 'bright');

	log(`\n✓ Sucesso: ${successCount}/${editaisParaReprocessar.length}`, successCount === editaisParaReprocessar.length ? 'green' : 'yellow');
	log(`⏱️  Tempo total: ${Math.floor(totalDuration / 60000)}m ${Math.floor((totalDuration % 60000) / 1000)}s`, 'cyan');

	log(`\n${'='.repeat(80)}\n`, 'bright');

	process.exit(successCount === editaisParaReprocessar.length ? 0 : 1);
}

main().catch(error => {
	console.error('\n❌ Erro fatal:', error);
	process.exit(1);
});
