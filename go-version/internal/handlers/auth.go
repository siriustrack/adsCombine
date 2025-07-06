package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func AuthMiddleware(token string) gin.HandlerFunc {
	return gin.HandlerFunc(func(c *gin.Context) {
		// Pular autenticação para rotas que não precisam
		if c.Request.URL.Path == "/health" || strings.HasPrefix(c.Request.URL.Path, "/texts/") {
			c.Next()
			return
		}

		// Verificar se é uma rota que precisa de autenticação
		if c.Request.URL.Path == "/api/process-message" || c.Request.URL.Path == "/api/delete-texts" {
			authHeader := c.GetHeader("Authorization")
			if authHeader == "" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
				c.Abort()
				return
			}

			// Verificar formato "Bearer token"
			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
				c.Abort()
				return
			}

			// Verificar token
			if parts[1] != token {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
				c.Abort()
				return
			}
		}

		c.Next()
	})
}
