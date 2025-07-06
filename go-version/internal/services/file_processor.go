package services

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"file-processor/internal/logger"
	"file-processor/internal/models"

	"github.com/gen2brain/go-fitz"
	"github.com/ledongthuc/pdf"
	"github.com/otiai10/gosseract/v2"
	"github.com/sirupsen/logrus"
	"github.com/unidoc/unioffice/document"
)

type FileProcessor struct {
	openaiService *OpenAIService
	textSanitizer *TextSanitizer
}

func NewFileProcessor(openaiService *OpenAIService, textSanitizer *TextSanitizer) *FileProcessor {
	return &FileProcessor{
		openaiService: openaiService,
		textSanitizer: textSanitizer,
	}
}

func (fp *FileProcessor) ProcessFile(file models.FileInfo) (string, error) {
	switch file.FileType {
	case "txt":
		return fp.processTxt(file)
	case "pdf":
		return fp.processPdf(file)
	case "jpeg", "jpg", "png", "image":
		return fp.processImage(file)
	case "docx":
		return fp.processDocx(file)
	default:
		return "", fmt.Errorf("unsupported file type: %s", file.FileType)
	}
}

func (fp *FileProcessor) processTxt(file models.FileInfo) (string, error) {
	logger.WithFields(logrus.Fields{
		"fileId": file.FileID,
		"url":    file.URL,
	}).Info("Processing TXT file")

	// Download do arquivo
	resp, err := http.Get(file.URL)
	if err != nil {
		return "", fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read file content: %w", err)
	}

	// Aplicar sanitização básica
	textContent := string(content)
	finalText := fp.textSanitizer.Sanitize(textContent)

	logger.WithFields(logrus.Fields{
		"fileId": file.FileID,
	}).Info("Successfully processed TXT file")

	return finalText, nil
}

func (fp *FileProcessor) processImage(file models.FileInfo) (string, error) {
	logger.WithFields(logrus.Fields{
		"fileId": file.FileID,
		"url":    file.URL,
	}).Info("Processing image file")

	// Download da imagem
	resp, err := http.Get(file.URL)
	if err != nil {
		return "", fmt.Errorf("failed to download image: %w", err)
	}
	defer resp.Body.Close()

	imageData, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read image data: %w", err)
	}

	// Processar com OpenAI
	description, err := fp.openaiService.ProcessImage(imageData, file.MimeType)
	if err != nil {
		return "", fmt.Errorf("failed to process image with AI: %w", err)
	}

	// Aplicar sanitização básica
	finalDescription := fp.textSanitizer.Sanitize(description)

	logger.WithFields(logrus.Fields{
		"fileId": file.FileID,
	}).Info("Successfully processed image file")

	return finalDescription, nil
}

func (fp *FileProcessor) processPdf(file models.FileInfo) (string, error) {
	logger.WithFields(logrus.Fields{
		"fileId": file.FileID,
		"url":    file.URL,
	}).Info("Processing PDF file")

	// Download do PDF
	resp, err := http.Get(file.URL)
	if err != nil {
		return "", fmt.Errorf("failed to download PDF: %w", err)
	}
	defer resp.Body.Close()

	pdfData, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read PDF data: %w", err)
	}

	// 1. Extrair texto direto primeiro
	extractedText, err := fp.extractTextDirectly(pdfData)
	if err != nil {
		logger.WithFields(logrus.Fields{
			"fileId": file.FileID,
			"error":  err.Error(),
		}).Warn("Failed to extract text directly from PDF")
	}

	if len(strings.TrimSpace(extractedText)) > 100 {
		logger.WithFields(logrus.Fields{
			"fileId": file.FileID,
		}).Info("PDF contém texto extraível")
	}

	// 2. Usar OCR para garantir extração completa, mesmo que já tenha texto
	logger.WithFields(logrus.Fields{
		"fileId": file.FileID,
	}).Info("Aplicando OCR em todas as páginas para extração completa")

	ocrText, err := fp.performAdvancedOCR(pdfData, file.FileID)
	if err != nil {
		logger.WithFields(logrus.Fields{
			"fileId": file.FileID,
			"error":  err.Error(),
		}).Warn("OCR failed")
	}

	// 3. Combinar o texto extraído diretamente com o resultado do OCR
	var combinedText string
	if len(strings.TrimSpace(extractedText)) > 100 {
		// Se já temos bom texto extraído diretamente, usar ele como base
		combinedText = extractedText
		if len(strings.TrimSpace(ocrText)) > 100 {
			combinedText += "\n\n--- TEXTO ADICIONAL DO OCR ---\n\n" + ocrText
		}
	} else {
		// Se texto direto é insuficiente, usar OCR como principal
		if ocrText != "" {
			combinedText = ocrText
		} else {
			combinedText = extractedText
		}
	}

	finalText := fp.textSanitizer.Sanitize(combinedText)

	if len(strings.TrimSpace(finalText)) < 50 {
		logger.WithFields(logrus.Fields{
			"fileId":              file.FileID,
			"finalTextLength":     len(finalText),
			"extractedTextLength": len(extractedText),
			"ocrTextLength":       len(ocrText),
		}).Warn("Very little text extracted from PDF")
	}

	logger.WithFields(logrus.Fields{
		"fileId":          file.FileID,
		"finalTextLength": len(finalText),
		"hasDirectText":   len(extractedText) > 100,
		"hasOcrText":      len(ocrText) > 100,
	}).Info("Successfully processed PDF combining direct extraction and OCR")

	return finalText, nil
}

func (fp *FileProcessor) extractTextDirectly(pdfData []byte) (string, error) {
	reader := bytes.NewReader(pdfData)
	pdfReader, err := pdf.NewReader(reader, int64(len(pdfData)))
	if err != nil {
		return "", fmt.Errorf("failed to create PDF reader: %w", err)
	}

	var text strings.Builder
	numPages := pdfReader.NumPage()

	for i := 1; i <= numPages; i++ {
		page := pdfReader.Page(i)
		if page.V.IsNull() {
			continue
		}

		pageText, err := page.GetPlainText()
		if err != nil {
			logger.WithFields(logrus.Fields{
				"page":  i,
				"error": err.Error(),
			}).Warn("Failed to extract text from page")
			continue
		}

		text.WriteString(pageText)
		text.WriteString("\n")
	}

	return text.String(), nil
}

func (fp *FileProcessor) performAdvancedOCR(pdfData []byte, fileID string) (string, error) {
	// Criar diretório temporário
	tempDir, err := os.MkdirTemp("", "pdf-ocr-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Salvar PDF em arquivo temporário
	pdfPath := filepath.Join(tempDir, "input.pdf")
	if err := os.WriteFile(pdfPath, pdfData, 0644); err != nil {
		return "", fmt.Errorf("failed to write PDF to temp file: %w", err)
	}

	// Converter PDF para PNG usando pdftoppm (equivalente ao Node.js)
	pagesDir := filepath.Join(tempDir, "pages")
	if err := os.MkdirAll(pagesDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create pages directory: %w", err)
	}

	// Executar pdftoppm para converter PDF em PNGs
	cmd := exec.Command("pdftoppm", "-png", pdfPath, filepath.Join(pagesDir, "page"))
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("failed to convert PDF to images: %w", err)
	}

	// Listar páginas geradas
	files, err := os.ReadDir(pagesDir)
	if err != nil {
		return "", fmt.Errorf("failed to read pages directory: %w", err)
	}

	var pageFiles []string
	for _, file := range files {
		if strings.HasSuffix(file.Name(), ".png") {
			pageFiles = append(pageFiles, file.Name())
		}
	}

	if len(pageFiles) == 0 {
		return "", fmt.Errorf("no pages generated from PDF")
	}

	// Ordenar os arquivos de página
	// Em Go não temos uma função de sort personalizada tão simples, mas podemos usar strings.Sort
	// que funcionará para nomes como page-1.png, page-2.png, etc.
	var ocrResults []string

	// Criar diretório para imagens pré-processadas
	preprocessDir := filepath.Join(tempDir, "preprocessed")
	if err := os.MkdirAll(preprocessDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create preprocessed directory: %w", err)
	}

	for _, pageFile := range pageFiles {
		imgPath := filepath.Join(pagesDir, pageFile)
		preprocessPath := filepath.Join(preprocessDir, pageFile)

		// Pré-processamento da imagem para melhor OCR
		// Equivalente ao Sharp do Node.js - vamos usar ImageMagick convert
		convertCmd := exec.Command("convert", imgPath,
			"-resize", "x2000",
			"-colorspace", "Gray",
			"-normalize",
			"-sharpen", "0x1",
			"-linear-stretch", "1%x1%",
			preprocessPath)

		if err := convertCmd.Run(); err != nil {
			logger.WithFields(logrus.Fields{
				"fileId": fileID,
				"page":   pageFile,
				"error":  err.Error(),
			}).Warn("Failed to preprocess image, using original")
			// Se falhou o pré-processamento, usar imagem original
			preprocessPath = imgPath
		}

		// Executar OCR com múltiplas tentativas PSM (como no Node.js)
		text := fp.performOCRWithMultiplePSM(preprocessPath, fileID, pageFile)

		cleanText := strings.TrimSpace(text)
		if len(cleanText) > 10 {
			ocrResults = append(ocrResults, cleanText)
			logger.WithFields(logrus.Fields{
				"fileId":     fileID,
				"page":       pageFile,
				"textLength": len(cleanText),
				"preview":    cleanText[:min(100, len(cleanText))],
			}).Info("Successfully extracted text from page")
		} else {
			logger.WithFields(logrus.Fields{
				"fileId": fileID,
				"page":   pageFile,
			}).Warn("Little or no text extracted from page")
		}
	}

	if len(ocrResults) == 0 {
		return "", fmt.Errorf("no text extracted from any pages")
	}

	// Processar e limpar o texto do OCR (replicando a lógica do Node.js)
	return fp.processAndFilterOCRResults(ocrResults, fileID), nil
}

func (fp *FileProcessor) performOCRWithMultiplePSM(imagePath, fileID, pageFile string) string {
	// PSM modes para tentar, replicando a lógica do Node.js
	psmModes := []string{"1", "3", "6"}
	
	for _, psm := range psmModes {
		// Executar tesseract diretamente via linha de comando
		// Equivalente ao execSync do Node.js
		cmd := exec.Command("tesseract", imagePath, "stdout", "-l", "por", "--oem", "1", "--psm", psm)
		cmd.Env = append(os.Environ(), "TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata")
		
		output, err := cmd.Output()
		if err != nil {
			logger.WithFields(logrus.Fields{
				"fileId": fileID,
				"page":   pageFile,
				"psm":    psm,
				"error":  err.Error(),
			}).Warn(fmt.Sprintf("PSM %s failed, trying next", psm))
			continue
		}

		text := strings.TrimSpace(string(output))
		
		// Se PSM 1 não funcionou ou retornou pouco texto, tenta próximo PSM
		if psm == "1" && len(text) < 50 {
			logger.WithFields(logrus.Fields{
				"fileId": fileID,
				"page":   pageFile,
			}).Warn("PSM 1 failed, trying PSM 3")
			continue
		}
		
		// Se PSM 3 não funcionou ou retornou pouco texto, tenta PSM 6
		if psm == "3" && len(text) < 50 {
			logger.WithFields(logrus.Fields{
				"fileId": fileID,
				"page":   pageFile,
			}).Warn("PSM 3 failed, trying PSM 6")
			continue
		}
		
		// Se conseguiu extrair texto significativo, retorna
		if len(text) >= 50 {
			return text
		}
	}

	logger.WithFields(logrus.Fields{
		"fileId": fileID,
		"page":   pageFile,
	}).Warn("All PSM modes failed")
	
	return ""
}

func (fp *FileProcessor) processAndFilterOCRResults(ocrResults []string, fileID string) string {
	// Filtrar linhas muito repetitivas preservando dados importantes (replicando Node.js)
	allLines := strings.Split(strings.Join(ocrResults, "\n"), "\n")
	lineCount := make(map[string]int)

	// Contar frequência de cada linha
	for _, line := range allLines {
		cleanLine := strings.TrimSpace(line)
		if len(cleanLine) > 5 {
			lineCount[cleanLine]++
		}
	}

	// Padrões que NÃO devem ser removidos mesmo se repetitivos (igual ao Node.js)
	preservePatterns := []*regexp.Regexp{
		regexp.MustCompile(`\b\d{3}\.\d{3}\.\d{3}-\d{2}\b`),                       // CPF
		regexp.MustCompile(`\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b`),               // CNPJ
		regexp.MustCompile(`\b\d{5}-?\d{3}\b`),                                  // CEP
		regexp.MustCompile(`\bR\$\s*[\d.,]+`),                                   // Valores monetários
		regexp.MustCompile(`\b[A-ZÁÊÇÕ]{2,}\s+[A-ZÁÊÇÕ\s]+\b`),                // Nomes próprios (maiúsculas)
		regexp.MustCompile(`\b\d{1,2}/\d{1,2}/\d{4}\b`),                        // Datas
		regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}\b`),                             // Datas ISO
		regexp.MustCompile(`\w+@\w+\.\w+`),                                      // E-mails
		regexp.MustCompile(`\(\d{2}\)\s*\d{4,5}-?\d{4}`),                       // Telefones
		regexp.MustCompile(`\b\d+\b`),                                           // Números importantes
		regexp.MustCompile(`[A-Z]{2,}\s+\d+`),                                  // Códigos alfanuméricos
	}

	// Só remover se for muito repetitivo E não contiver dados importantes
	maxRepetitions := int(float64(len(ocrResults)) * 0.8) // Aumentou para 80% como no Node.js
	var filteredLines []string

	for _, line := range allLines {
		cleanLine := strings.TrimSpace(line)

		// Sempre manter linhas vazias e muito curtas
		if cleanLine == "" || len(cleanLine) <= 3 {
			filteredLines = append(filteredLines, line)
			continue
		}

		// Verificar se contém padrões importantes
		hasImportantData := false
		for _, pattern := range preservePatterns {
			if pattern.MatchString(cleanLine) {
				hasImportantData = true
				break
			}
		}

		// Se contém dados importantes, sempre preservar
		if hasImportantData {
			filteredLines = append(filteredLines, line)
			continue
		}

		// Se é uma linha genérica repetitiva (cabeçalho/rodapé), remover
		isRepetitive := lineCount[cleanLine] > maxRepetitions
		isGeneric := len(cleanLine) < 20 &&
			(strings.Contains(cleanLine, "Página") ||
				strings.Contains(cleanLine, "página") ||
				regexp.MustCompile(`^\d+$`).MatchString(cleanLine) ||               // apenas números
				regexp.MustCompile(`^[-\s]+$`).MatchString(cleanLine) ||            // apenas traços/espaços
				regexp.MustCompile(`^\w+\s-\s\d{2}/\d{2}/\d{4}\s\d{2}:\d{2}:\d{2}$`).MatchString(cleanLine)) // timestamp pattern

		if !(isRepetitive && isGeneric) {
			filteredLines = append(filteredLines, line)
		}
	}

	result := strings.Join(filteredLines, "\n")

	logger.WithFields(logrus.Fields{
		"fileId":               fileID,
		"totalPages":           len(ocrResults),
		"originalLines":        len(allLines),
		"filteredLines":        len(filteredLines),
		"removedLines":         len(allLines) - len(filteredLines),
		"preservedImportantData": true,
	}).Info("OCR text processing completed")

	return result
}

func (fp *FileProcessor) processDocx(file models.FileInfo) (string, error) {
	logger.WithFields(logrus.Fields{
		"fileId": file.FileID,
		"url":    file.URL,
	}).Info("Processing DOCX file")

	// Download do arquivo DOCX
	resp, err := http.Get(file.URL)
	if err != nil {
		return "", fmt.Errorf("failed to download DOCX: %w", err)
	}
	defer resp.Body.Close()

	// Criar arquivo temporário
	tempFile, err := os.CreateTemp("", "*.docx")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Copiar conteúdo para arquivo temporário
	if _, err := io.Copy(tempFile, resp.Body); err != nil {
		return "", fmt.Errorf("failed to write DOCX to temp file: %w", err)
	}

	// Abrir documento
	doc, err := document.Open(tempFile.Name())
	if err != nil {
		return "", fmt.Errorf("failed to open DOCX document: %w", err)
	}
	defer doc.Close()

	// Extrair texto
	var textBuilder strings.Builder
	for _, para := range doc.Paragraphs() {
		for _, run := range para.Runs() {
			textBuilder.WriteString(run.Text())
		}
		textBuilder.WriteString("\n")
	}

	textContent := textBuilder.String()
	if strings.TrimSpace(textContent) == "" {
		logger.WithFields(logrus.Fields{
			"fileId": file.FileID,
		}).Warn("DOCX content is empty or could not be extracted")
		return "", nil
	}

	extractedText := fp.textSanitizer.Sanitize(textContent)

	logger.WithFields(logrus.Fields{
		"fileId": file.FileID,
	}).Info("Successfully processed DOCX file")

	return extractedText, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
