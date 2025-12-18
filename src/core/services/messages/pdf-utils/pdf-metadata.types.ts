/**
 * Represents a page break in the extracted text
 * Tracks the character position where each page begins
 */
export interface PageBreak {
	/** 1-indexed page number */
	pageNumber: number;

	/** Character index in the full text where this page starts */
	charIndex: number;

	/** Estimated word count on this page (optional) */
	estimatedWords?: number;
}

/**
 * Represents a detected section/heading in the document
 */
export interface DocumentSection {
	/** Section title text */
	title: string;

	/** 1-indexed starting page number */
	startPage: number;

	/** 1-indexed ending page number (optional, calculated later) */
	endPage?: number;

	/** Character index where section starts in the full text */
	startChar: number;

	/** Heading level (1=major section, 2=subsection, etc.) */
	level?: number;
}

/**
 * Metadata extracted during PDF processing
 * Provides structured information about page boundaries and document structure
 */
export interface PdfMetadata {
	/** Total number of pages in the document */
	totalPages: number;

	/** Array of page breaks with character indices */
	pageBreaks: PageBreak[];

	/** Detected sections/headings (optional, may be empty if none found) */
	sections?: DocumentSection[];

	/** How the text was extracted */
	processingSource: "direct" | "ocr";

	// Optional future enrichments
	/** Detected header patterns (future enhancement) */
	detectedHeaders?: string[];

	/** Whether document contains images (future enhancement) */
	hasImages?: boolean;

	/** Whether document contains tables (future enhancement) */
	hasTables?: boolean;
}

/**
 * Enhanced result from PDF processing with metadata
 * Returned by ProcessPdfService instead of plain string
 */
export interface PdfProcessingResult {
	/** Extracted text content */
	text: string;

	/** Structured metadata about the document */
	metadata: PdfMetadata;
}
