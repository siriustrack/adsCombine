#!/usr/bin/env bun
/**
 * Re-transcrever PDF usando pdf-parse (sem OCR por enquanto)
 * Vamos comparar a qualidade da extração
 */

import pdf from 'pdf-parse';
import { readFileSync, writeFileSync } from 'node:fs';
import { sanitizeText } from '../../src/utils/textSanitizer';

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

async function retranscreverPDF(pdfPath: string, outputPath: string, name: string) {
	log(`\n${'='.repeat(80)}`, 'cyan');
	log(`📄 Retranscrevendo: ${name}`, 'bright');
	log(`${'='.repeat(80)}`, 'cyan');

	try {
		const startTime = Date.now();
		
		// Ler PDF
		const pdfBuffer = readFileSync(pdfPath);
		log(`   🔍 Extraindo texto com pdf-parse...`, 'cyan');
		
		const data = await pdf(pdfBuffer);
		const duration = Date.now() - startTime;

		if (!data.text || data.text.length < 100) {
			throw new Error('PDF não contém texto ou texto muito curto - pode ser PDF de imagem');
		}

		// Sanitizar
		const cleanedText = sanitizeText(data.text);

		// Salvar
		writeFileSync(outputPath, cleanedText, 'utf-8');

		log(`   ✓ Texto extraído: ${cleanedText.length.toLocaleString()} caracteres`, 'green');
		log(`   ✓ Páginas: ${data.numpages}`, 'gray');
		log(`   ✓ Salvo em: ${outputPath}`, 'gray');
		log(`   ✓ Duração: ${Math.floor(duration / 1000)}s`, 'gray');

		// Estatísticas
		const lines = cleanedText.split('\n').length;
		const words = cleanedText.split(/\s+/).length;
		
		log(`\n   📊 Estatísticas:`, 'cyan');
		log(`      • Caracteres: ${cleanedText.length.toLocaleString()}`, 'gray');
		log(`      • Palavras: ${words.toLocaleString()}`, 'gray');
		log(`      • Linhas: ${lines.toLocaleString()}`, 'gray');
		log(`      • Média chars/página: ${Math.floor(cleanedText.length / data.numpages)}`, 'gray');

		// Amostra do início
		log(`\n   📝 Primeiras 200 caracteres:`, 'cyan');
		log(`      ${cleanedText.substring(0, 200).replace(/\n/g, ' ')}...`, 'gray');

		return true;

	} catch (error: any) {
		log(`   ✗ ERRO: ${error.message}`, 'red');
		return false;
	}
}

async function main() {
	log('\n╔════════════════════════════════════════════════════════════════════════════╗', 'bright');
	log('║                 RE-TRANSCRIÇÃO DE PDF - VERIFICAÇÃO                       ║', 'bright');
	log('╚════════════════════════════════════════════════════════════════════════════╝', 'bright');

	const pdf = {
		input: 'docs/editais-test/edital concurso cartórios rs.pdf',
		output: 'temp/editais-text-only/edital concurso cartórios rs - v2.txt',
		name: 'edital concurso cartórios rs.pdf',
	};

	const success = await retranscreverPDF(pdf.input, pdf.output, pdf.name);

	log(`\n${'='.repeat(80)}`, 'bright');
	log(success ? '✅ SUCESSO!' : '❌ FALHOU', success ? 'green' : 'red');
	log(`${'='.repeat(80)}\n`, 'bright');

	if (success) {
		log(`📝 Agora compare os dois arquivos:`, 'cyan');
		log(`   Antigo: temp/editais-text-only/edital concurso cartórios rs.txt`, 'gray');
		log(`   Novo:   temp/editais-text-only/edital concurso cartórios rs - v2.txt`, 'gray');
		log(`\n   wc -l temp/editais-text-only/edital\\ concurso\\ cartórios\\ rs*.txt`, 'yellow');
	}

	process.exit(success ? 0 : 1);
}

main().catch(error => {
	console.error('\n❌ Erro fatal:', error);
	process.exit(1);
});
