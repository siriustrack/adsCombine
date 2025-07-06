package main

import (
	"log"
	"os"

	"file-processor/internal/config"
	"file-processor/internal/handlers"
	"file-processor/internal/logger"
	"file-processor/internal/services"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// Carregar variáveis de ambiente
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	// Inicializar configuração
	cfg := config.Load()

	// Inicializar logger
	logger.Init(cfg.LogLevel)

	// Inicializar serviços
	openaiService := services.NewOpenAIService(cfg.OpenAI.APIKey, cfg.OpenAI.ModelText, cfg.OpenAI.ModelImage)
	textSanitizer := services.NewTextSanitizer()
	fileProcessor := services.NewFileProcessor(openaiService, textSanitizer)

	// Configurar Gin
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	// Middleware para CORS se necessário
	router.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		
		c.Next()
	})

	// Middleware de autenticação
	router.Use(handlers.AuthMiddleware(cfg.Token))

	// Servir arquivos estáticos
	router.Static("/texts", "./public/texts")

	// Rotas da API
	api := router.Group("/api")
	{
		processHandler := handlers.NewProcessHandler(fileProcessor, textSanitizer)
		api.POST("/process-message", processHandler.ProcessMessage)
		api.DELETE("/delete-texts", processHandler.DeleteTexts)
	}

	// Iniciar servidor
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	logger.Info("🚀 Service listening on port " + port)
	if err := router.Run(":" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
