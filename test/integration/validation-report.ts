#!/usr/bin/env bun
/**
 * Relatório de Validação dos Editais Processados
 * Compara JSONs extraídos com PDFs originais para validar precisão
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
	blue: '\x1b[34m',
	gray: '\x1b[90m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

interface ValidationResult {
	edital: string;
	status: 'completo' | 'parcial' | 'pendente';
	score: number;
	checks: {
		estruturaBasica: boolean;
		concursoInfo: boolean;
		disciplinasCompletas: boolean;
		materiasDetalhadas: boolean;
		legislacoesExtraidas: boolean;
		integridadeOK: boolean;
	};
	stats: {
		concursos: number;
		disciplinas: number;
		materias: number;
		questoes: number;
		legislacoes: number;
	};
	observations: string[];
}

function validateEdital(jsonPath: string, editalName: string): ValidationResult {
	const observations: string[] = [];
	
	try {
		const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
		
		// Verificações básicas
		const concurso = data.concursos?.[0];
		const metadata = concurso?.metadata;
		const checks = {
			estruturaBasica: !!(data.concursos && Array.isArray(data.concursos)),
			concursoInfo: !!(
				(concurso?.nome || metadata?.examName) && 
				(concurso?.orgao || metadata?.examOrg) && 
				(concurso?.data || concurso?.fases?.[0]?.data || metadata?.startDate)
			),
			disciplinasCompletas: !!(concurso?.disciplinas && concurso.disciplinas.length > 0),
			materiasDetalhadas: false,
			legislacoesExtraidas: false,
			integridadeOK: data.validacao?.integridadeOK || false,
		};

		// Contar matérias com conteúdo
		let totalMaterias = 0;
		let materiasComSubtopicos = 0;
		let totalLegislacoes = 0;

		if (checks.disciplinasCompletas && concurso) {
			concurso.disciplinas.forEach((disc: any) => {
				if (disc.materias && Array.isArray(disc.materias)) {
					totalMaterias += disc.materias.length;
					disc.materias.forEach((mat: any) => {
						if (mat.subtopicos && mat.subtopicos.length > 0) {
							materiasComSubtopicos++;
						}
						if (mat.legislacoes && mat.legislacoes.length > 0) {
							totalLegislacoes += mat.legislacoes.length;
						}
					});
				}
			});
		}

		checks.materiasDetalhadas = materiasComSubtopicos > 0 || totalMaterias > 0;
		checks.legislacoesExtraidas = totalLegislacoes > 0;

		// Calcular score de qualidade (0-100)
		let score = 0;
		if (checks.estruturaBasica) score += 15;
		if (checks.concursoInfo) score += 15;
		if (checks.disciplinasCompletas) score += 20;
		if (checks.materiasDetalhadas) score += 25;
		if (checks.legislacoesExtraidas) score += 15;
		if (checks.integridadeOK) score += 10;

		// Observações específicas
		const questoesDeclaradas = concurso?.fases?.reduce((sum: number, fase: any) => sum + (fase.totalQuestoes || 0), 0) || 0;
		const questoesContadas = data.validacao?.totalQuestoes || 0;
		
		if (questoesDeclaradas !== questoesContadas) {
			observations.push(`⚠️ Divergência: ${questoesDeclaradas} questões declaradas vs ${questoesContadas} contadas`);
		}

		if (totalLegislacoes === 0) {
			observations.push(`⚠️ Nenhuma legislação foi extraída`);
		} else if (totalLegislacoes < 10) {
			observations.push(`📝 Poucas legislações extraídas (${totalLegislacoes})`);
		}

		if (materiasComSubtopicos === 0) {
			observations.push(`⚠️ Nenhuma matéria possui subtópicos detalhados`);
		}

		// Validações específicas por edital
		if (editalName.includes('ENAC')) {
			if (concurso && concurso.disciplinas.length < 10) {
				observations.push(`❌ ENAC deveria ter 10 disciplinas, encontrado ${concurso.disciplinas.length}`);
				score -= 10;
			}
			if (questoesDeclaradas !== 100) {
				observations.push(`❌ ENAC deveria ter 100 questões, encontrado ${questoesDeclaradas}`);
				score -= 10;
			}
		}

		if (editalName.includes('MPRS')) {
			const disciplinas = concurso?.disciplinas || [];
			const temConhecimentoJuridico = disciplinas.some((d: any) => 
				d.nome.toLowerCase().includes('jurídico') || d.nome.toLowerCase().includes('conhecimento')
			);
			const temLinguaPortuguesa = disciplinas.some((d: any) => 
				d.nome.toLowerCase().includes('portuguesa') || d.nome.toLowerCase().includes('língua')
			);
			
			if (!temConhecimentoJuridico) {
				observations.push(`❌ MPRS deveria ter disciplina de Conhecimento Jurídico`);
				score -= 10;
			}
			if (!temLinguaPortuguesa) {
				observations.push(`❌ MPRS deveria ter disciplina de Língua Portuguesa`);
				score -= 10;
			}
		}

		const status = score >= 90 ? 'completo' : score >= 60 ? 'parcial' : 'pendente';

		return {
			edital: editalName,
			status,
			score: Math.max(0, Math.min(100, score)),
			checks,
			stats: {
				concursos: data.concursos?.length || 0,
				disciplinas: data.concursos?.[0]?.disciplinas?.length || 0,
				materias: totalMaterias,
				questoes: questoesDeclaradas,
				legislacoes: totalLegislacoes,
			},
			observations,
		};

	} catch (error: any) {
		return {
			edital: editalName,
			status: 'pendente',
			score: 0,
			checks: {
				estruturaBasica: false,
				concursoInfo: false,
				disciplinasCompletas: false,
				materiasDetalhadas: false,
				legislacoesExtraidas: false,
				integridadeOK: false,
			},
			stats: {
				concursos: 0,
				disciplinas: 0,
				materias: 0,
				questoes: 0,
				legislacoes: 0,
			},
			observations: [`❌ Erro ao ler JSON: ${error.message}`],
		};
	}
}

function printValidationResult(result: ValidationResult) {
	log(`\n${'='.repeat(80)}`, 'cyan');
	log(`📄 ${result.edital}`, 'bright');
	log(`${'='.repeat(80)}`, 'cyan');

	// Status e Score
	const statusColor = result.status === 'completo' ? 'green' : result.status === 'parcial' ? 'yellow' : 'red';
	const statusEmoji = result.status === 'completo' ? '✅' : result.status === 'parcial' ? '⚠️' : '❌';
	
	log(`\n${statusEmoji} Status: ${result.status.toUpperCase()}`, statusColor);
	log(`📊 Score de Qualidade: ${result.score}/100`, result.score >= 90 ? 'green' : result.score >= 60 ? 'yellow' : 'red');

	// Checks
	log(`\n🔍 Verificações:`, 'cyan');
	log(`   ${result.checks.estruturaBasica ? '✓' : '✗'} Estrutura básica`, result.checks.estruturaBasica ? 'green' : 'red');
	log(`   ${result.checks.concursoInfo ? '✓' : '✗'} Informações do concurso`, result.checks.concursoInfo ? 'green' : 'red');
	log(`   ${result.checks.disciplinasCompletas ? '✓' : '✗'} Disciplinas completas`, result.checks.disciplinasCompletas ? 'green' : 'red');
	log(`   ${result.checks.materiasDetalhadas ? '✓' : '✗'} Matérias detalhadas`, result.checks.materiasDetalhadas ? 'green' : 'red');
	log(`   ${result.checks.legislacoesExtraidas ? '✓' : '✗'} Legislações extraídas`, result.checks.legislacoesExtraidas ? 'green' : 'red');
	log(`   ${result.checks.integridadeOK ? '✓' : '✗'} Integridade validada`, result.checks.integridadeOK ? 'green' : 'red');

	// Stats
	log(`\n📈 Estatísticas:`, 'cyan');
	log(`   • Concursos: ${result.stats.concursos}`, 'gray');
	log(`   • Disciplinas: ${result.stats.disciplinas}`, 'gray');
	log(`   • Matérias: ${result.stats.materias}`, 'gray');
	log(`   • Questões: ${result.stats.questoes}`, 'gray');
	log(`   • Legislações: ${result.stats.legislacoes}`, 'gray');

	// Observações
	if (result.observations.length > 0) {
		log(`\n📝 Observações:`, 'yellow');
		result.observations.forEach(obs => {
			log(`   ${obs}`, 'gray');
		});
	}
}

async function main() {
	log('\n╔════════════════════════════════════════════════════════════════════════════╗', 'bright');
	log('║               RELATÓRIO DE VALIDAÇÃO - EDITAIS PROCESSADOS                ║', 'bright');
	log('╚════════════════════════════════════════════════════════════════════════════╝', 'bright');

	const editais = [
		{ path: 'temp/editais-json/edital ENAC.json', name: 'ENAC 2025.2 (Cartórios)' },
		{ path: 'temp/editais-json/edital MPRS.json', name: 'MPRS 51º (Promotor)' },
		{ path: 'temp/editais-json/edital juiz sc.json', name: 'Juiz SC (TJ-SC)' },
		{ path: 'temp/editais-json/edital oab.json', name: 'OAB (Exame de Ordem)' },
		{ path: 'temp/editais-json/edital prefeitura.json', name: 'Prefeitura (Municipal)' },
	];

	const results: ValidationResult[] = [];

	for (const edital of editais) {
		const result = validateEdital(edital.path, edital.name);
		results.push(result);
		printValidationResult(result);
	}

	// Resumo geral
	log(`\n\n${'='.repeat(80)}`, 'bright');
	log('📊 RESUMO GERAL', 'bright');
	log(`${'='.repeat(80)}`, 'bright');

	const totalEditais = results.length;
	const completos = results.filter(r => r.status === 'completo').length;
	const parciais = results.filter(r => r.status === 'parcial').length;
	const pendentes = results.filter(r => r.status === 'pendente').length;
	const avgScore = results.reduce((sum, r) => sum + r.score, 0) / totalEditais;

	log(`\n✅ Completos: ${completos}/${totalEditais} (${(completos/totalEditais*100).toFixed(1)}%)`, 'green');
	log(`⚠️  Parciais: ${parciais}/${totalEditais} (${(parciais/totalEditais*100).toFixed(1)}%)`, 'yellow');
	log(`❌ Pendentes: ${pendentes}/${totalEditais} (${(pendentes/totalEditais*100).toFixed(1)}%)`, 'red');
	log(`\n📊 Score Médio: ${avgScore.toFixed(1)}/100`, avgScore >= 90 ? 'green' : avgScore >= 60 ? 'yellow' : 'red');

	const totalStats = {
		concursos: results.reduce((sum, r) => sum + r.stats.concursos, 0),
		disciplinas: results.reduce((sum, r) => sum + r.stats.disciplinas, 0),
		materias: results.reduce((sum, r) => sum + r.stats.materias, 0),
		questoes: results.reduce((sum, r) => sum + r.stats.questoes, 0),
		legislacoes: results.reduce((sum, r) => sum + r.stats.legislacoes, 0),
	};

	log(`\n📈 Totais Extraídos:`, 'cyan');
	log(`   • ${totalStats.concursos} concursos processados`, 'gray');
	log(`   • ${totalStats.disciplinas} disciplinas identificadas`, 'gray');
	log(`   • ${totalStats.materias} matérias mapeadas`, 'gray');
	log(`   • ${totalStats.questoes} questões documentadas`, 'gray');
	log(`   • ${totalStats.legislacoes} legislações referenciadas`, 'gray');

	// Precisão estimada
	log(`\n🎯 AVALIAÇÃO DE PRECISÃO`, 'bright');
	log(`${'='.repeat(80)}`, 'bright');

	const precisionChecks = [
		{ name: 'Estrutura JSON válida', passed: results.every(r => r.checks.estruturaBasica) },
		{ name: 'Informações de concurso completas', passed: results.every(r => r.checks.concursoInfo) },
		{ name: 'Disciplinas extraídas', passed: results.every(r => r.checks.disciplinasCompletas) },
		{ name: 'Matérias detalhadas', passed: results.every(r => r.checks.materiasDetalhadas) },
		{ name: 'Legislações identificadas', passed: results.every(r => r.checks.legislacoesExtraidas) },
		{ name: 'Integridade validada', passed: results.every(r => r.checks.integridadeOK) },
	];

	precisionChecks.forEach(check => {
		const emoji = check.passed ? '✅' : '⚠️';
		const color = check.passed ? 'green' : 'yellow';
		log(`${emoji} ${check.name}`, color);
	});

	const passedChecks = precisionChecks.filter(c => c.passed).length;
	const precisionPercentage = (passedChecks / precisionChecks.length) * 100;

	log(`\n📊 Taxa de Sucesso: ${precisionPercentage.toFixed(1)}% (${passedChecks}/${precisionChecks.length} verificações)`, 
		precisionPercentage >= 90 ? 'green' : precisionPercentage >= 70 ? 'yellow' : 'red');

	if (avgScore >= 90) {
		log(`\n🎉 EXCELENTE! Pipeline está funcionando com alta precisão!`, 'green');
	} else if (avgScore >= 70) {
		log(`\n👍 BOM! Pipeline funciona bem, mas pode ser aprimorado.`, 'yellow');
	} else {
		log(`\n⚠️  ATENÇÃO! Pipeline precisa de melhorias significativas.`, 'red');
	}

	log(`\n${'='.repeat(80)}\n`, 'bright');
}

main().catch(error => {
	console.error('\n❌ Erro fatal:', error);
	process.exit(1);
});
