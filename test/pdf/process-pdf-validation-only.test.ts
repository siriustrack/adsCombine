import { describe, expect, test } from 'bun:test'
import { isValidationOnlyText } from '../../src/core/services/messages/pdf-utils/pdf-validation-text'
import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'
import type { ProcessPdfOptions } from '../../src/core/services/messages/pdf-utils/process-pdf.types'
import { TextQualityAnalyzer } from '../../src/core/services/messages/pdf-utils/text-quality-analyzer.service'
import { errResult, okResult } from '../../src/lib/result.types'

const validationText = [
	'Documento assinado digitalmente por Maria em 11/10/2026.',
	'Valide este documento em https://assinador-web.onr.org.br/validar/123.',
	'Selo Digital de Fiscalização ABC123.',
	'Página 1 de 1',
].join('\n')

function serviceFor(nativeText: string, ocrFails: boolean, ocrText = '') {
	return new ProcessPdfService(
		{
			async downloadFile() {
				return okResult({ buffer: Buffer.from('synthetic-scan') })
			},
		},
		{
			async extractTextFromPdf() {
				return okResult({
					text: nativeText,
					totalPages: 1,
					pages: [
						{
							pageNumber: 1,
							text: nativeText,
							embeddedImageCount: 1,
							tableCount: 0,
							hasVisualContent: true,
						},
					],
				})
			},
		},
		new TextQualityAnalyzer(),
		{
			async processWithOcr() {
				return ocrFails
					? errResult(new Error('OCR unavailable'))
					: okResult({ ocrText, chunksProcessed: 1, processingTime: 0 })
			},
			async processPagesWithOcr() {
				return ocrFails
					? errResult(new Error('OCR unavailable'))
					: okResult({
						pages: [{ pageNumber: 1, text: ocrText }],
						chunksProcessed: 1,
						processingTime: 0,
					})
			},
			async processWithEnhancedOcr() {
				return ocrFails
					? errResult(new Error('OCR unavailable'))
					: okResult({
						ocrText,
						pages: [{ pageNumber: 1, text: ocrText }],
						totalPages: 1,
						chunksProcessed: 1,
						processingTime: 0,
					})
			},
		}
	)
}

describe('validation-only native text over a scanned page', () => {
	test('requires OCR even for dense native verification furniture', () => {
		// Given: enough distinct verification text to fool length and density heuristics.
		const text = Array.from(
			{ length: 100 },
			(_, index) => `Documento assinado digitalmente por Pessoa ${index} em 11/10/2026.`
		).join('\n')
		const analyzer = new TextQualityAnalyzer()
		// When: global and page classifiers see the same metadata-only text.
		const analyses = [analyzer.analyze(text), analyzer.analyzePage(text)]
		// Then: both require OCR rather than trusting the native length.
		for (const analysis of analyses) {
			expect(analysis.shouldSkipOcr).toBe(false)
			expect(analysis.hasOcrIndicators).toBe(true)
		}
	})

	test('does not classify a legal provision on a verification line as metadata only', () => {
		// Given / When: legal content follows a verification prefix on the same line.
		const result = isValidationOnlyText(
			'Documento assinado digitalmente. Art. 1º Fica revogado o ato.'
		)
		// Then: uncertain mixed content is retained for review.
		expect(result).toBe(false)
	})

	const modes: readonly ProcessPdfOptions['mode'][] = ['legacy', 'mixed-page', 'enhanced']
	for (const mode of modes) {
		for (const clause of [
			'O pagamento de R$ 150,00 vence em 20/10/2026.',
			'As partes elegem o foro da comarca de Recife.',
		]) {
			test(`preserves same-line contractual content in ${mode}: ${clause}`, async () => {
				// Given: a verification prefix does not prove the rest of the line is metadata.
				const text = `Documento assinado digitalmente. ${clause}`
				const service = serviceFor(text, true)
				// When: OCR fails and native fallback is needed.
				const result = await service.execute(
					{
						fileId: 'mixed-contract',
						url: 'https://example.com/contract.pdf',
						mimeType: 'application/pdf',
					},
					{ mode }
				)
				// Then: preserve the original mixed content without a legal-vocabulary blacklist.
				expect(result.error).toBeNull()
				expect(result.value).toBe(text)
			})
		}
		test(`uses useful OCR rather than the validation layer in ${mode}`, async () => {
			// Given: OCR successfully recovered the main scanned content.
			const text = 'Art. 1º O registro deve preservar o inteiro teor do documento.'
			const service = serviceFor(validationText, false, text)
			// When: extraction runs in the selected mode.
			const result = await service.execute(
				{
					fileId: 'recovered-scan',
					url: 'https://example.com/scan.pdf',
					mimeType: 'application/pdf',
				},
				{ mode }
			)
			// Then: real document content remains successful.
			expect(result.error).toBeNull()
			expect(result.value).toBe(text)
		})
		for (const ocrFails of [true, false]) {
			test(`does not report validation text as document content in ${mode} with failed OCR=${ocrFails}`, async () => {
				// Given: the extraction seam reports a scan with only native validation text.
				const service = serviceFor(validationText, ocrFails)
				// When: OCR cannot recover its actual content.
				const result = await service.execute(
					{
						fileId: 'validation-only',
						url: 'https://example.com/scan.pdf',
						mimeType: 'application/pdf',
					},
					{ mode }
				)
				// Then: metadata alone cannot be a successful transcription.
				expect(result.value).toBeNull()
				expect(result.error).toBeInstanceOf(Error)
			})
		}
		test(`preserves a short legal statement alongside validation text in ${mode}`, async () => {
			// Given: genuine legal content is present, despite its small size.
			const text = `Art. 1º Fica revogado o provimento anterior.\n${validationText}`
			const service = serviceFor(text, true)
			// When: OCR is unavailable.
			const result = await service.execute(
				{
					fileId: 'short-native',
					url: 'https://example.com/short.pdf',
					mimeType: 'application/pdf',
				},
				{ mode }
			)
			// Then: do not reject a useful fallback merely because it is short.
			expect(result.error).toBeNull()
			expect(result.value).toBe(text)
		})
	}
})
