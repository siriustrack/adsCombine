package handlers

import (
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"file-processor/internal/logger"
	"file-processor/internal/models"
	"file-processor/internal/services"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

type ProcessHandler struct {
	fileProcessor *services.FileProcessor
	textSanitizer *services.TextSanitizer
}

func NewProcessHandler(fileProcessor *services.FileProcessor, textSanitizer *services.TextSanitizer) *ProcessHandler {
	return &ProcessHandler{
		fileProcessor: fileProcessor,
		textSanitizer: textSanitizer,
	}
}

func (h *ProcessHandler) ProcessMessage(c *gin.Context) {
	var request models.ProcessMessageRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		logger.WithFields(logrus.Fields{
			"error": err.Error(),
		}).Error("Validation error for /process-message")
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Invalid request body",
			"details": err.Error(),
		})
		return
	}

	logger.WithFields(logrus.Fields{
		"messageCount": len(request),
	}).Info("Received /process-message request")

	if len(request) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Request body must contain at least one message.",
		})
		return
	}

	// Processar arquivos de forma concorrente
	var allExtractedText strings.Builder
	var processedFiles []string
	var failedFiles []models.FailedFile
	var mutex sync.Mutex
	var wg sync.WaitGroup

	for _, message := range request {
		if message.Body.Files == nil || len(message.Body.Files) == 0 {
			continue
		}

		for _, file := range message.Body.Files {
			wg.Add(1)
			go func(file models.FileInfo) {
				defer wg.Done()

				textContent, err := h.fileProcessor.ProcessFile(file)
				if err != nil {
					logger.WithFields(logrus.Fields{
						"fileId": file.FileID,
						"error":  err.Error(),
					}).Error("Failed to process file")

					mutex.Lock()
					failedFiles = append(failedFiles, models.FailedFile{
						FileID: file.FileID,
						Error:  err.Error(),
					})
					mutex.Unlock()
					return
				}

				// Extrair nome do arquivo da URL
				parsedURL, err := url.Parse(file.URL)
				if err != nil {
					parsedURL = &url.URL{Path: file.FileID}
				}
				fileName := path.Base(parsedURL.Path)
				header := fmt.Sprintf("## Transcricao do arquivo: %s:\n\n", fileName)
				result := header + textContent

				mutex.Lock()
				processedFiles = append(processedFiles, file.FileID)
				allExtractedText.WriteString(result)
				allExtractedText.WriteString("\n\n---\n\n")
				mutex.Unlock()
			}(file)
		}
	}

	// Aguardar todos os processamentos
	wg.Wait()

	// Criar diretório de textos se não existir
	textsDir := "./public/texts"
	if err := os.MkdirAll(textsDir, 0755); err != nil {
		logger.WithFields(logrus.Fields{
			"error": err.Error(),
		}).Error("Failed to create texts directory")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Internal server error",
			"message": "Failed to create output directory",
		})
		return
	}

	// Gerar nome do arquivo
	conversationID := request[0].ConversationID
	filename := fmt.Sprintf("%s-%d.txt", conversationID, time.Now().UnixMilli())
	filePath := filepath.Join(textsDir, filename)

	// Sanitizar texto final antes de salvar
	finalText := strings.TrimSpace(allExtractedText.String())
	sanitizedText := h.textSanitizer.SanitizeText(finalText)

	// Salvar arquivo
	if err := os.WriteFile(filePath, []byte(sanitizedText), 0644); err != nil {
		logger.WithFields(logrus.Fields{
			"error":    err.Error(),
			"filePath": filePath,
		}).Error("Failed to write text file")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Internal server error",
			"message": "Failed to save processed text",
		})
		return
	}

	// Construir URL de download
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	downloadURL := fmt.Sprintf("%s://%s/texts/%s", scheme, c.Request.Host, filename)

	logger.WithFields(logrus.Fields{
		"conversationId": conversationID,
		"downloadUrl":    downloadURL,
	}).Info("Successfully processed messages and created text file")

	c.JSON(http.StatusOK, models.ProcessMessageResponse{
		ConversationID: conversationID,
		DownloadURL:    downloadURL,
		ProcessedFiles: processedFiles,
		FailedFiles:    failedFiles,
	})
}

func (h *ProcessHandler) DeleteTexts(c *gin.Context) {
	var request models.DeleteTextsRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		// Se não há body, aceita parâmetros vazios
		request = models.DeleteTextsRequest{}
	}

	logger.WithFields(logrus.Fields{
		"filename":       request.Filename,
		"conversationId": request.ConversationID,
	}).Info("Received /delete-texts request")

	textsDir := "./public/texts"

	// Verificar se o diretório existe
	if _, err := os.Stat(textsDir); os.IsNotExist(err) {
		logger.WithFields(logrus.Fields{
			"textsDir": textsDir,
		}).Warn("Texts directory does not exist")
		c.JSON(http.StatusNotFound, models.DeleteTextsResponse{
			Message:      "Texts directory not found",
			DeletedFiles: []string{},
			DeletedCount: 0,
		})
		return
	}

	// Ler todos os arquivos do diretório
	files, err := os.ReadDir(textsDir)
	if err != nil {
		logger.WithFields(logrus.Fields{
			"error": err.Error(),
		}).Error("Failed to read texts directory")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Internal server error",
			"message": "Failed to read texts directory",
		})
		return
	}

	// Filtrar apenas arquivos .txt
	var txtFiles []fs.DirEntry
	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), ".txt") {
			txtFiles = append(txtFiles, file)
		}
	}

	if len(txtFiles) == 0 {
		logger.Info("No txt files found in texts directory")
		c.JSON(http.StatusNotFound, models.DeleteTextsResponse{
			Message:      "No txt files found to delete",
			DeletedFiles: []string{},
			DeletedCount: 0,
		})
		return
	}

	// Determinar quais arquivos excluir
	var filesToDelete []string

	if request.Filename != "" {
		// Excluir arquivo específico
		found := false
		for _, file := range txtFiles {
			if file.Name() == request.Filename {
				filesToDelete = append(filesToDelete, file.Name())
				found = true
				break
			}
		}
		if !found {
			logger.WithFields(logrus.Fields{
				"filename": request.Filename,
			}).Warn("Specific file not found")
			c.JSON(http.StatusNotFound, models.DeleteTextsResponse{
				Message:      fmt.Sprintf("File %s not found", request.Filename),
				DeletedFiles: []string{},
				DeletedCount: 0,
			})
			return
		}
	} else if request.ConversationID != "" {
		// Excluir arquivos de uma conversa específica
		for _, file := range txtFiles {
			if strings.HasPrefix(file.Name(), request.ConversationID) {
				filesToDelete = append(filesToDelete, file.Name())
			}
		}
		if len(filesToDelete) == 0 {
			logger.WithFields(logrus.Fields{
				"conversationId": request.ConversationID,
			}).Warn("No files found for conversation")
			c.JSON(http.StatusNotFound, models.DeleteTextsResponse{
				Message:      fmt.Sprintf("No files found for conversation %s", request.ConversationID),
				DeletedFiles: []string{},
				DeletedCount: 0,
			})
			return
		}
	} else {
		// Excluir todos os arquivos txt
		for _, file := range txtFiles {
			filesToDelete = append(filesToDelete, file.Name())
		}
	}

	// Excluir os arquivos
	var deletedFiles []string
	var failedFiles []models.FailedFile

	for _, filename := range filesToDelete {
		filePath := filepath.Join(textsDir, filename)
		if err := os.Remove(filePath); err != nil {
			logger.WithFields(logrus.Fields{
				"file":  filename,
				"error": err.Error(),
			}).Error("Failed to delete file")
			failedFiles = append(failedFiles, models.FailedFile{
				FileID: filename,
				Error:  err.Error(),
			})
		} else {
			deletedFiles = append(deletedFiles, filename)
			logger.WithFields(logrus.Fields{
				"file": filename,
			}).Info("File deleted successfully")
		}
	}

	response := models.DeleteTextsResponse{
		Message:      fmt.Sprintf("Successfully deleted %d file(s)", len(deletedFiles)),
		DeletedFiles: deletedFiles,
		DeletedCount: len(deletedFiles),
	}

	if len(failedFiles) > 0 {
		response.FailedFiles = failedFiles
		response.Message += fmt.Sprintf(". Failed to delete %d file(s)", len(failedFiles))
	}

	logger.WithFields(logrus.Fields{
		"deletedCount": len(deletedFiles),
		"failedCount":  len(failedFiles),
	}).Info("Delete operation completed")

	c.JSON(http.StatusOK, response)
}
