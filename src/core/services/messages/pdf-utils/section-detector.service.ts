import logger from "@lib/logger";
import type { DocumentSection, PageBreak } from "./pdf-metadata.types";

/**
 * Service for detecting document sections (headings/titles) using pattern matching
 * Focuses on Brazilian legal and business document formats
 */
export class SectionDetectorService {
	/**
	 * Patterns for detecting section headers
	 * Ordered by specificity (most specific first)
	 */
	private readonly SECTION_PATTERNS = [
		// Legal keywords with numbers: "CLÁUSULA 5", "ARTIGO 12", "CAPÍTULO III"
		{
			regex: /^(CL[ÁA]USULA|CAP[ÍI]TULO|SE[ÇC][ÃA]O|ARTIGO)\s+([IVXLCDM]+|\d+)/im,
			level: 1,
		},

		// Numbered sections: "1. INTRODUÇÃO", "2.1 Termos", "3.2.1 Definições"
		{
			regex: /^(\d+\.(?:\d+\.)*)\s+([A-ZÀÂÃÁÉÊÍÓÔÕÚÇ][A-ZÀÂÃÁÉÊÍÓÔÕÚÇ\s]{2,})/m,
			level: (match: RegExpMatchArray) => {
				// Count dots to determine level: "1." = 1, "1.1" = 2, "1.1.1" = 3
				return (match[1].match(/\./g) || []).length;
			},
		},

		// Roman numerals: "I. CAPÍTULO", "IV. TERMOS"
		{
			regex: /^([IVXLCDM]+)\.\s+([A-ZÀÂÃÁÉÊÍÓÔÕÚÇ][A-ZÀÂÃÁÉÊÍÓÔÕÚÇ\s]{2,})/m,
			level: 1,
		},

		// All caps titles (at least 3 words, common in legal documents)
		{
			regex:
				/^([A-ZÀÂÃÁÉÊÍÓÔÕÚÇ]{2,}(?:\s+[A-ZÀÂÃÁÉÊÍÓÔÕÚÇ]{2,}){2,})\s*$/m,
			level: 2, // Assume subsection level for generic all-caps
		},
	];

	/**
	 * Minimum and maximum line length to consider as potential section
	 */
	private readonly MIN_LINE_LENGTH = 5;
	private readonly MAX_LINE_LENGTH = 150;

	/**
	 * Detect sections in the given text
	 * @param text Full extracted text
	 * @param pageBreaks Array of page breaks to map character indices to pages
	 * @returns Array of detected sections with page numbers
	 */
	detectSections(text: string, pageBreaks: PageBreak[]): DocumentSection[] {
		const sections: DocumentSection[] = [];
		const lines = text.split("\n");

		let currentCharIndex = 0;

		for (let i = 0; i < lines.length; i++) {
			const originalLine = lines[i];
			const line = originalLine.trim();

			// Skip indented lines (sections should start at line beginning)
			const hasLeadingWhitespace = originalLine.length > 0 && originalLine[0] !== line[0];
			
			if (!hasLeadingWhitespace) {
				// Check if line matches any section pattern
				const match = this.matchesSectionPattern(line);

				if (match) {
					const pageNumber = this.findPageForCharIndex(
						currentCharIndex,
						pageBreaks,
					);

					sections.push({
						title: line,
						startPage: pageNumber,
						startChar: currentCharIndex,
						level: match.level,
					});
				}
			}

			// Move index forward by line length + newline character
			currentCharIndex += originalLine.length + 1;
		}

		// Calculate endPage for each section
		this.calculateSectionEndPages(
			sections,
			pageBreaks[pageBreaks.length - 1]?.pageNumber ?? 1,
		);

		// Remove duplicate sections (same title on multiple pages = likely header/footer)
		const deduplicated = this.deduplicateSections(sections);

		logger.debug("Detected document sections", {
			totalSections: deduplicated.length,
			sections: deduplicated.map((s) => ({
				title: s.title,
				page: s.startPage,
				level: s.level,
			})),
		});

		return deduplicated;
	}

	/**
	 * Check if a line matches any section pattern
	 * @returns Object with level if match, null otherwise
	 */
	private matchesSectionPattern(
		line: string,
	): { level: number } | null {
		// Length constraints to avoid false positives
		if (
			line.length < this.MIN_LINE_LENGTH ||
			line.length > this.MAX_LINE_LENGTH
		) {
			return null;
		}

		// Check against each pattern
		for (const pattern of this.SECTION_PATTERNS) {
			const match = line.match(pattern.regex);
			if (match) {
				const level =
					typeof pattern.level === "function"
						? pattern.level(match)
						: pattern.level;
				return { level };
			}
		}

		return null;
	}

	/**
	 * Find which page a character index belongs to
	 */
	private findPageForCharIndex(
		charIndex: number,
		pageBreaks: PageBreak[],
	): number {
		// Iterate backwards to find the last page break before this index
		for (let i = pageBreaks.length - 1; i >= 0; i--) {
			if (charIndex >= pageBreaks[i].charIndex) {
				return pageBreaks[i].pageNumber;
			}
		}

		// If no page break found, default to page 1
		return 1;
	}

	/**
	 * Calculate endPage for each section based on the next section's startPage
	 */
	private calculateSectionEndPages(
		sections: DocumentSection[],
		lastPage: number,
	): void {
		for (let i = 0; i < sections.length; i++) {
			if (i < sections.length - 1) {
				// End page is one before next section starts
				const nextStartPage = sections[i + 1].startPage;
				let endPage = nextStartPage - 1;

				// Ensure endPage is not before the section's startPage
				if (endPage < sections[i].startPage) {
					endPage = sections[i].startPage;
				}

				sections[i].endPage = endPage;
			} else {
				// Last section goes to end of document
				sections[i].endPage = lastPage;
			}
		}
	}

	/**
	 * Remove duplicate sections (same title appearing on multiple pages)
	 * This helps filter out headers/footers that appear on every page
	 */
	private deduplicateSections(
		sections: DocumentSection[],
	): DocumentSection[] {
		const seen = new Map<string, DocumentSection>();

		for (const section of sections) {
			const key = section.title.toLowerCase().trim();

			if (!seen.has(key)) {
				// First occurrence - keep it
				seen.set(key, section);
			} else {
				// Duplicate found - only keep if on different page
				const existing = seen.get(key)!;
				if (section.startPage !== existing.startPage) {
					// This is likely a header/footer repeated on every page
					// We'll keep the first occurrence only
					logger.debug("Skipping duplicate section (likely header/footer)", {
						title: section.title,
						firstPage: existing.startPage,
						duplicatePage: section.startPage,
					});
				}
			}
		}

		return Array.from(seen.values());
	}
}
