const REGISTRY_MARKERS = /\b(?:matr[ií]cula|registro\s+de\s+im[oó]veis|r\.\s*\d+|av\.\s*\d+|certid[aã]o)\b/giu;
const LEGAL_MARKERS = /\b(?:art(?:igo)?\.?\s*\d+|lei\s+n[º°o]?\s*\d+|provimento\s+(?:n[º°o]?\s*)?\d+|revogad[oa]|acrescid[oa]|averba[cç][aã]o)\b/giu;
const CPF_CNPJ = /\b(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g;
const DATES = /\b(?:\d{2}\/\d{2}\/\d{4}|\d{1,2}\s+de\s+[A-Za-zÀ-ÿ]+\s+de\s+\d{4})\b/giu;
const CURRENCY = /R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}\b/g;
const FRACTIONS = /(?<![\d/])\b\d+\s*\/\s*\d+\b(?!\s*\/)/g;
const SQUARE_METERS = /\b\d+(?:[.,]\d+)?\s*m[²2](?!\p{L}|\p{N})/giu;
const CORRUPTED_SYMBOLS = /[�□]|(?:[^\p{L}\p{N}\s.,;:()\[\]{}\-–—/º°²$%#@&+*=|])/gu;
const GARBLED_SPANS = /(?:[#@?]{3,}|(?:\p{P}{2,}\s*){2,})/gu;
const FRAGMENTED_NUMBER_OR_MEASURE = /\b\d(?:\s+\d){2,}\b|\b\d\s+[.,]\s+\d\b|\bm\s+[²2]\b/gu;
const LABEL = /^\s*(?:(?:r|av)\.\s*(?:n[º°o]?\s*)?\d+|art(?:igo)?\.?\s*\d+|matr[ií]cula\s*(?:n[º°o]?\s*)?\d+|(?:cpf|cnpj)\s*[:#]?\s*\d+|lei\s+n[º°o]?\s*\d+|provimento\s+(?:n[º°o]?\s*)?\d+)/iu;

function countMatches(text, expression) {
  expression.lastIndex = 0;
  return Array.from(text.matchAll(expression)).length;
}

function countDuplicateLabels(text) {
  const labels = new Map();
  for (const line of text.split('\n')) {
    const label = line.match(LABEL)?.[0].replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (label) labels.set(label, (labels.get(label) || 0) + 1);
  }
  return Array.from(labels.values()).reduce((duplicates, count) => duplicates + Math.max(0, count - 1), 0);
}

function sanitizeEnhancedOcrText(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t\f\v ]+/g, ' ').trim())
    .join('\n')
    .trim();
}

function analyzeEnhancedOcrText(input) {
  const text = sanitizeEnhancedOcrText(input);
  return {
    registryMarkers: countMatches(text, REGISTRY_MARKERS),
    legalMarkers: countMatches(text, LEGAL_MARKERS),
    cpfCnpj: countMatches(text, CPF_CNPJ),
    dates: countMatches(text, DATES),
    currency: countMatches(text, CURRENCY),
    fractions: countMatches(text, FRACTIONS),
    squareMeters: countMatches(text, SQUARE_METERS),
    corruptedSymbols: countMatches(text, CORRUPTED_SYMBOLS),
    fragmentedNumbersOrMeasures: countMatches(text, FRAGMENTED_NUMBER_OR_MEASURE),
    duplicateLabels: countDuplicateLabels(text),
    garbledSpans: countMatches(text, GARBLED_SPANS),
  };
}

function scoreEnhancedOcrAttempt(result) {
  const signals = analyzeEnhancedOcrText(result.text);
  const base = Math.max(0, Math.min(100, result.meanConfidence || 0));
  const volume = Math.min(25, Math.log10((result.wordCount || 0) + 1) * 10);
  const rewards =
    signals.registryMarkers * 16 +
    signals.legalMarkers * 12 +
    signals.cpfCnpj * 14 +
    signals.dates * 8 +
    signals.currency * 8 +
    signals.fractions * 5 +
    signals.squareMeters * 8;
  const penalties =
    signals.corruptedSymbols * 18 +
    signals.fragmentedNumbersOrMeasures * 12 +
    signals.duplicateLabels * 8 +
    signals.garbledSpans * 15;
  return base + volume + rewards - penalties;
}

function shouldUseEnhancedPsmFallback(result) {
  const signals = analyzeEnhancedOcrText(result.text);
  return (
    signals.corruptedSymbols > 0 ||
    signals.fragmentedNumbersOrMeasures > 0 ||
    signals.garbledSpans > 0 ||
    (signals.registryMarkers + signals.legalMarkers === 0 && result.wordCount < 15)
  );
}

module.exports = {
  analyzeEnhancedOcrText,
  sanitizeEnhancedOcrText,
  scoreEnhancedOcrAttempt,
  shouldUseEnhancedPsmFallback,
};
