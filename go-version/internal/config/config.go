package config

import (
	"os"
	"strconv"
)

type Config struct {
	Environment string
	Port        string
	Token       string
	BaseURL     string
	LogLevel    string
	OpenAI      OpenAIConfig
	Processing  ProcessingConfig
}

type OpenAIConfig struct {
	APIKey     string
	ModelText  string
	ModelImage string
}

type ProcessingConfig struct {
	Concurrency int
}

func Load() *Config {
	concurrency, _ := strconv.Atoi(getEnv("PROCESSING_CONCURRENCY", "5"))

	return &Config{
		Environment: getEnv("ENV", "development"),
		Port:        getEnv("PORT", "3000"),
		Token:       getEnv("TOKEN", ""),
		BaseURL:     getEnv("BASE_URL", "http://localhost:3000"),
		LogLevel:    getEnv("LOG_LEVEL", "info"),
		OpenAI: OpenAIConfig{
			APIKey:     getEnv("OPENAI_API_KEY", ""),
			ModelText:  getEnv("OPENAI_MODEL_TEXT", "gpt-4o-mini"),
			ModelImage: getEnv("OPENAI_MODEL_IMAGE", "gpt-4o-mini"),
		},
		Processing: ProcessingConfig{
			Concurrency: concurrency,
		},
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
