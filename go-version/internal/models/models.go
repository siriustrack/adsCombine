package models

type FileInfo struct {
	FileID   string            `json:"fileId" binding:"required"`
	URL      string            `json:"url" binding:"required,url"`
	MimeType string            `json:"mimeType" binding:"required"`
	FileType string            `json:"fileType" binding:"required,oneof=txt pdf jpeg png jpg docx image"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

type MessageBody struct {
	Content string     `json:"content,omitempty"`
	Files   []FileInfo `json:"files,omitempty"`
}

type Message struct {
	ConversationID string      `json:"conversationId" binding:"required"`
	Body           MessageBody `json:"body" binding:"required"`
}

type ProcessMessageRequest []Message

type ProcessMessageResponse struct {
	ConversationID  string        `json:"conversationId"`
	DownloadURL     string        `json:"downloadUrl"`
	ProcessedFiles  []string      `json:"processedFiles"`
	FailedFiles     []FailedFile  `json:"failedFiles"`
}

type FailedFile struct {
	FileID string `json:"fileId"`
	Error  string `json:"error"`
}

type DeleteTextsRequest struct {
	Filename       string `json:"filename,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
}

type DeleteTextsResponse struct {
	Message      string      `json:"message"`
	DeletedFiles []string    `json:"deletedFiles"`
	DeletedCount int         `json:"deletedCount"`
	FailedFiles  []FailedFile `json:"failedFiles,omitempty"`
}
