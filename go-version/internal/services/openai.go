package services

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/sashabaranov/go-openai"
)

type OpenAIService struct {
	client     *openai.Client
	modelText  string
	modelImage string
}

func NewOpenAIService(apiKey, modelText, modelImage string) *OpenAIService {
	client := openai.NewClient(apiKey)
	return &OpenAIService{
		client:     client,
		modelText:  modelText,
		modelImage: modelImage,
	}
}

func (s *OpenAIService) ProcessImage(imageData []byte, mimeType string) (string, error) {
	// Converter imagem para base64
	base64Image := base64.StdEncoding.EncodeToString(imageData)
	imageURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Image)

	resp, err := s.client.CreateChatCompletion(
		context.Background(),
		openai.ChatCompletionRequest{
			Model: s.modelImage,
			Messages: []openai.ChatCompletionMessage{
				{
					Role: openai.ChatMessageRoleUser,
					MultiContent: []openai.ChatMessagePart{
						{
							Type: openai.ChatMessagePartTypeText,
							Text: "Describe this image in detail. Return in PT_BR.",
						},
						{
							Type: openai.ChatMessagePartTypeImageURL,
							ImageURL: &openai.ChatMessageImageURL{
								URL: imageURL,
							},
						},
					},
				},
			},
		},
	)

	if err != nil {
		return "", fmt.Errorf("failed to process image with OpenAI: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("no response from OpenAI")
	}

	return resp.Choices[0].Message.Content, nil
}
