package services

import (
	"regexp"
	"strings"
	"unicode"

	"file-processor/internal/logger"
)

type TextSanitizer struct{}

func NewTextSanitizer() *TextSanitizer {
	return &TextSanitizer{}
}

func (ts *TextSanitizer) SanitizeText(text string) string {
	if text == "" {
		return ""
	}

	// Remove caracteres de controle Unicode (exceto alguns úteis)
	// Mantém: \n (10), \r (13), \t (9) - quebras de linha e tabs
	// Remove: \u0000-\u0008, \u000B-\u000C, \u000E-\u001F
	controlCharsRegex := regexp.MustCompile(`[\x00-\x08\x0B-\x0C\x0E-\x1F]`)
	sanitized := controlCharsRegex.ReplaceAllString(text, "")

	// Remove zero-width characters e outros caracteres invisíveis problemáticos
	zeroWidthRegex := regexp.MustCompile(`[\u200B-\u200F\uFEFF\u00A0]`)
	sanitized = zeroWidthRegex.ReplaceAllString(sanitized, " ")

	// Remove caracteres de controle raros mas problemáticos
	rareControlRegex := regexp.MustCompile(`[\u2028\u2029\u0085\u000A\u000D]`)
	sanitized = rareControlRegex.ReplaceAllString(sanitized, "\n")

	// Remove caracteres de símbolos que frequentemente causam problemas em extrações de PDF
	nonPrintableRegex := regexp.MustCompile(`[^\x20-\x7E\xC0-\xFF\u00A1-\u017F\u0400-\u04FF\n\r\t]`)
	sanitized = nonPrintableRegex.ReplaceAllString(sanitized, " ")

	// Remove sequências de símbolos indesejados que aparecem frequentemente em PDFs mal extraídos
	repetitiveSymbolsRegex := regexp.MustCompile(`[!@#$%^&*()_+\-={}[\]|\\:;"'<>,.?/]{3,}`)
	sanitized = repetitiveSymbolsRegex.ReplaceAllString(sanitized, " ")

	// Remove sequências excessivas de espaços/quebras de linha
	excessiveSpacesRegex := regexp.MustCompile(`\s{3,}`)
	sanitized = excessiveSpacesRegex.ReplaceAllString(sanitized, " ")

	excessiveNewlinesRegex := regexp.MustCompile(`\n{4,}`)
	sanitized = excessiveNewlinesRegex.ReplaceAllString(sanitized, "\n\n\n")

	// Limpa início e fim
	sanitized = strings.TrimSpace(sanitized)

	return sanitized
}

func (ts *TextSanitizer) AnalyzeTextProblems(text string) map[string]interface{} {
	if text == "" {
		return map[string]interface{}{"hasProblems": false}
	}

	problems := map[string]interface{}{
		"hasProblems":          false,
		"controlChars":         0,
		"zeroWidthChars":       0,
		"nonPrintableSymbols":  0,
		"repetitiveSymbols":    0,
		"excessiveSpaces":      0,
		"totalLength":          len(text),
		"examples":             []string{},
	}

	// Conta caracteres de controle
	controlChars := 0
	zeroWidthChars := 0
	nonPrintableSymbols := 0
	excessiveSpaces := 0

	for _, r := range text {
		if r >= 0x0000 && r <= 0x0008 || r >= 0x000B && r <= 0x000C || r >= 0x000E && r <= 0x001F {
			controlChars++
		}
		if r >= 0x200B && r <= 0x200F || r == 0xFEFF || r == 0x00A0 {
			zeroWidthChars++
		}
		if !unicode.IsPrint(r) && r != '\n' && r != '\r' && r != '\t' {
			nonPrintableSymbols++
		}
	}

	// Conta espaços excessivos
	excessiveSpacesRegex := regexp.MustCompile(`\s{3,}`)
	if matches := excessiveSpacesRegex.FindAllString(text, -1); matches != nil {
		excessiveSpaces = len(matches)
	}

	// Conta sequências repetitivas de símbolos
	repetitiveSymbols := 0
	repetitiveSymbolsRegex := regexp.MustCompile(`[!@#$%^&*()_+\-={}[\]|\\:;"'<>,.?/]{3,}`)
	if matches := repetitiveSymbolsRegex.FindAllString(text, -1); matches != nil {
		repetitiveSymbols = len(matches)
	}

	problems["controlChars"] = controlChars
	problems["zeroWidthChars"] = zeroWidthChars
	problems["nonPrintableSymbols"] = nonPrintableSymbols
	problems["repetitiveSymbols"] = repetitiveSymbols
	problems["excessiveSpaces"] = excessiveSpaces

	if controlChars > 0 || zeroWidthChars > 0 || nonPrintableSymbols > 0 || repetitiveSymbols > 0 || excessiveSpaces > 0 {
		problems["hasProblems"] = true
	}

	return problems
}

// Sanitize - compatibilidade com a função sanitize original
func (ts *TextSanitizer) Sanitize(text string) string {
	// Implementação básica de sanitização HTML/caracteres gerais
	// Remove tags HTML básicas
	htmlTagRegex := regexp.MustCompile(`<[^>]*>`)
	sanitized := htmlTagRegex.ReplaceAllString(text, "")

	// Remove entidades HTML comuns
	htmlEntities := map[string]string{
		"&amp;":  "&",
		"&lt;":   "<",
		"&gt;":   ">",
		"&quot;": "\"",
		"&apos;": "'",
		"&#39;":  "'",
		"&nbsp;": " ",
	}

	for entity, replacement := range htmlEntities {
		sanitized = strings.ReplaceAll(sanitized, entity, replacement)
	}

	return strings.TrimSpace(sanitized)
}
