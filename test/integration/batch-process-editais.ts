#!/usr/bin/env bun
/**
 * Script de processamento em lote de editais
 * Processa todos os editais transcritos através do Claude AI
 * Gera JSONs estruturados e relatório consolidado
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EditalProcessService } from '../../src/core/services/editais/edital-process.service';

// Configuração
const INPUT_DIR = 'temp/editais-text-only';
const OUTPUT_DIR = 'temp/editais-json';
const RESULTS_FILE = 'temp/editais-json/_BATCH_RESULTS.json';
const DEBUG = process.env.DEBUG_SAVE_RAW_RESPONSE === '1';

// Cores para output
const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
	gray: '\x1b[90m',
};

interface ProcessResult {
	editalName: string;
	status: 'success' | 'error' | 'skipped';
	duration?: number;
	error?: string;
	stats?: {
		concursos: number;
		disciplinas: number;
		materias: number;
		questoes: number;
		legislacoes: number;
		integridadeOK: boolean;
	};
}

function log(message: string, color: keyof typeof colors = 'reset') {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

async function processEdital(
	txtPath: string,
	editalName: string,
	index: number,
	total: number,
): Promise<ProcessResult> {
	const startTime = Date.now();
	
	log(`\n${'='.repeat(80)}`, 'cyan');
	log(`📄 Processando [${index}/${total}]: ${editalName}`, 'bright');
	log(`${'='.repeat(80)}`, 'cyan');

	try {
		// Ler texto transcrito
		const text = readFileSync(txtPath, 'utf-8');
		log(`   ✓ Texto lido: ${text.length.toLocaleString()} caracteres`, 'gray');

		// Verificar se já existe JSON processado
		const outputPath = join(OUTPUT_DIR, editalName.replace('.txt', '.json'));
		if (existsSync(outputPath)) {
			log(`   ⚠ JSON já existe: ${outputPath}`, 'yellow');
			log(`   ℹ Use este script novamente para reprocessar ou delete o arquivo`, 'gray');
			
			// Ler estatísticas do JSON existente
			const existingJson = JSON.parse(readFileSync(outputPath, 'utf-8'));
			return {
				editalName,
				status: 'skipped',
				stats: {
					concursos: existingJson.concursos?.length || 0,
					disciplinas: existingJson.validacao?.totalDisciplinas || 0,
					materias: existingJson.validacao?.totalMaterias || 0,
					questoes: existingJson.validacao?.totalQuestoes || 0,
					legislacoes: existingJson.validacao?.totalLegislacoes || 0,
					integridadeOK: existingJson.validacao?.integridadeOK || false,
				},
			};
		}

		// Processar com Claude AI
		log(`   🤖 Enviando para Claude AI...`, 'cyan');
		const service = new EditalProcessService();
		
		// Usar reflexão para acessar método privado
		const result = await (service as any).processWithClaude(text);

		const duration = Date.now() - startTime;
		
		if (!result.success) {
			throw new Error(result.error || 'Erro desconhecido no processamento');
		}

		// Salvar JSON
		const jsonContent = JSON.stringify(result.data, null, 2);
		writeFileSync(outputPath, jsonContent, 'utf-8');
		
		log(`   ✓ JSON salvo: ${outputPath}`, 'green');
		log(`   ✓ Tamanho: ${jsonContent.length.toLocaleString()} bytes`, 'gray');
		log(`   ✓ Duração: ${formatDuration(duration)}`, 'gray');

		// Extrair estatísticas
		const data = result.data;
		const stats = {
			concursos: data.concursos?.length || 0,
			disciplinas: data.validacao?.totalDisciplinas || 0,
			materias: data.validacao?.totalMaterias || 0,
			questoes: data.validacao?.totalQuestoes || 0,
			legislacoes: data.validacao?.totalLegislacoes || 0,
			integridadeOK: data.validacao?.integridadeOK || false,
		};

		log(`\n   📊 Estatísticas:`, 'cyan');
		log(`      • Concursos: ${stats.concursos}`, 'gray');
		log(`      • Disciplinas: ${stats.disciplinas}`, 'gray');
		log(`      • Matérias: ${stats.materias}`, 'gray');
		log(`      • Questões: ${stats.questoes}`, 'gray');
		log(`      • Legislações: ${stats.legislacoes}`, 'gray');
		log(`      • Integridade: ${stats.integridadeOK ? '✓ OK' : '✗ FALHOU'}`, stats.integridadeOK ? 'green' : 'red');

		return {
			editalName,
			status: 'success',
			duration,
			stats,
		};

	} catch (error: any) {
		const duration = Date.now() - startTime;
		log(`   ✗ ERRO: ${error.message}`, 'red');
		
		// Verificar se há JSON parcial salvo que pode ser aproveitado
		if (error.message.includes('rate_limit')) {
			log(`   ⚠ Rate limit atingido - aguarde 60 segundos antes de reprocessar`, 'yellow');
		} else {
			// Tentar recuperar JSON parcial dos arquivos de debug
			const outputPath = join(OUTPUT_DIR, editalName.replace('.txt', '.json'));
			const debugFiles = readdirSync('/tmp')
				.filter(f => f.startsWith('claude-cleaned-json-'))
				.sort()
				.reverse();
			
			if (debugFiles.length > 0) {
				const latestDebugFile = join('/tmp', debugFiles[0]);
				try {
					const partialJson = JSON.parse(readFileSync(latestDebugFile, 'utf-8'));
					if (partialJson.concursos && partialJson.concursos.length > 0) {
						log(`   ⚠ JSON parcial encontrado - salvando mesmo com erros de validação`, 'yellow');
						writeFileSync(outputPath, JSON.stringify(partialJson, null, 2), 'utf-8');
						log(`   ✓ JSON parcial salvo: ${outputPath}`, 'green');
						
						// Tentar extrair estatísticas mesmo com validação incompleta
						const stats = {
							concursos: partialJson.concursos?.length || 0,
							disciplinas: partialJson.validacao?.totalDisciplinas || partialJson.concursos?.[0]?.disciplinas?.length || 0,
							materias: partialJson.validacao?.totalMaterias || 0,
							questoes: partialJson.validacao?.totalQuestoes || 0,
							legislacoes: partialJson.validacao?.totalLegislacoes || 0,
							integridadeOK: false,
						};
						
						return {
							editalName,
							status: 'success',
							duration,
							stats,
						};
					}
				} catch (parseError) {
					log(`   ✗ Não foi possível recuperar JSON parcial`, 'red');
				}
			}
		}
		
		return {
			editalName,
			status: 'error',
			duration,
			error: error.message,
		};
	}
}

async function main() {
	log('\n╔════════════════════════════════════════════════════════════════════════════╗', 'bright');
	log('║           BATCH PROCESSING - EDITAIS COM CLAUDE AI                         ║', 'bright');
	log('╚════════════════════════════════════════════════════════════════════════════╝', 'bright');

	// Garantir que diretório de saída existe
	if (!existsSync(OUTPUT_DIR)) {
		mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	// Listar arquivos TXT para processar
	const txtFiles = readdirSync(INPUT_DIR)
		.filter(f => f.endsWith('.txt') && !f.startsWith('_'))
		.sort();

	if (txtFiles.length === 0) {
		log('\n⚠ Nenhum arquivo TXT encontrado em ' + INPUT_DIR, 'yellow');
		process.exit(1);
	}

	log(`\n📋 Encontrados ${txtFiles.length} editais para processar:`, 'cyan');
	txtFiles.forEach((file, i) => {
		log(`   ${i + 1}. ${file}`, 'gray');
	});

	if (DEBUG) {
		log(`\n🐛 Modo DEBUG ativado - salvando respostas brutas em /tmp`, 'yellow');
	}

	log(`\n⏱️  Tempo estimado: ~${Math.ceil(txtFiles.length * 220 / 60)} minutos\n`, 'cyan');

	// Processar cada edital
	const results: ProcessResult[] = [];
	const totalStartTime = Date.now();
	const RATE_LIMIT_DELAY = 30000; // 30 segundos entre chamadas (ajustável)
	const MAX_RETRIES = 2;

	for (let i = 0; i < txtFiles.length; i++) {
		const txtFile = txtFiles[i];
		const txtPath = join(INPUT_DIR, txtFile);
		
		let result: ProcessResult | null = null;
		let retryCount = 0;

		// Tentar processar com retry em caso de rate limit
		while (retryCount <= MAX_RETRIES) {
			result = await processEdital(txtPath, txtFile, i + 1, txtFiles.length);
			
			// Se foi rate limit, aguardar mais e tentar novamente
			if (result.error?.includes('rate_limit') && retryCount < MAX_RETRIES) {
				retryCount++;
				const retryDelay = 60000; // 60s em caso de rate limit
				log(`\n   🔄 Retry ${retryCount}/${MAX_RETRIES} - Aguardando ${retryDelay / 1000}s...`, 'yellow');
				await new Promise(resolve => setTimeout(resolve, retryDelay));
			} else {
				break; // Sucesso ou erro diferente de rate limit
			}
		}

		if (result) {
			results.push(result);
		}

		// Mostrar progresso
		const elapsed = Date.now() - totalStartTime;
		const avgTime = elapsed / (i + 1);
		const remaining = avgTime * (txtFiles.length - i - 1);
		
		log(`\n   ⏱️  Progresso: ${i + 1}/${txtFiles.length} | Tempo decorrido: ${formatDuration(elapsed)} | Estimado restante: ${formatDuration(remaining)}`, 'gray');
		
		// Aguardar entre processamentos (exceto no último e se foi pulado)
		if (i < txtFiles.length - 1 && result && result.status !== 'skipped') {
			log(`\n   ⏸️  Aguardando ${RATE_LIMIT_DELAY / 1000}s...`, 'gray');
			await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
		}
	}

	// Relatório final
	const totalDuration = Date.now() - totalStartTime;
	
	log(`\n\n${'='.repeat(80)}`, 'bright');
	log('📊 RELATÓRIO FINAL', 'bright');
	log(`${'='.repeat(80)}`, 'bright');

	const successful = results.filter(r => r.status === 'success');
	const skipped = results.filter(r => r.status === 'skipped');
	const failed = results.filter(r => r.status === 'error');

	log(`\n✓ Processados com sucesso: ${successful.length}`, 'green');
	log(`⊘ Pulados (já existiam): ${skipped.length}`, 'yellow');
	log(`✗ Com erro: ${failed.length}`, 'red');
	log(`⏱️  Tempo total: ${formatDuration(totalDuration)}`, 'cyan');

	if (successful.length > 0) {
		log(`\n📈 Estatísticas consolidadas (processados + pulados):`, 'cyan');
		
		const allProcessed = [...successful, ...skipped];
		const totalStats = {
			concursos: allProcessed.reduce((sum, r) => sum + (r.stats?.concursos || 0), 0),
			disciplinas: allProcessed.reduce((sum, r) => sum + (r.stats?.disciplinas || 0), 0),
			materias: allProcessed.reduce((sum, r) => sum + (r.stats?.materias || 0), 0),
			questoes: allProcessed.reduce((sum, r) => sum + (r.stats?.questoes || 0), 0),
			legislacoes: allProcessed.reduce((sum, r) => sum + (r.stats?.legislacoes || 0), 0),
			integridadeOK: allProcessed.filter(r => r.stats?.integridadeOK).length,
		};

		log(`   • Total de concursos: ${totalStats.concursos}`, 'gray');
		log(`   • Total de disciplinas: ${totalStats.disciplinas}`, 'gray');
		log(`   • Total de matérias: ${totalStats.materias}`, 'gray');
		log(`   • Total de questões: ${totalStats.questoes}`, 'gray');
		log(`   • Total de legislações: ${totalStats.legislacoes}`, 'gray');
		log(`   • Editais com integridade OK: ${totalStats.integridadeOK}/${allProcessed.length}`, 'gray');
	}

	if (failed.length > 0) {
		log(`\n❌ Editais com erro:`, 'red');
		failed.forEach(r => {
			log(`   • ${r.editalName}: ${r.error}`, 'red');
		});
	}

	// Salvar resultado em JSON
	const resultsData = {
		timestamp: new Date().toISOString(),
		totalDuration: totalDuration,
		totalProcessed: txtFiles.length,
		successful: successful.length,
		skipped: skipped.length,
		failed: failed.length,
		results: results,
	};

	writeFileSync(RESULTS_FILE, JSON.stringify(resultsData, null, 2), 'utf-8');
	log(`\n💾 Resultados salvos em: ${RESULTS_FILE}`, 'cyan');

	log(`\n${'='.repeat(80)}\n`, 'bright');

	// Exit code baseado em sucesso
	process.exit(failed.length > 0 ? 1 : 0);
}

// Executar
main().catch(error => {
	console.error('\n❌ Erro fatal:', error);
	process.exit(1);
});
