# Guia de Uso da API - Serviços de Transcrição e Edital

## 1. Serviço de Transcrição (`/process-message`)

Processa mensagens com arquivos anexos (PDF, imagens, áudio, vídeo, XLSX, TXT) e retorna uma URL com o texto transcrito/extraído.

### Endpoint
```
POST /api/messages/process-message
```

### Request Body
```json
[
  {
    "conversationId": "uuid-da-conversa",
    "body": {
      "userId": "uuid-do-usuario",
      "content": "Mensagem opcional",
      "files": [
        {
          "fileId": "id-do-arquivo",
          "url": "https://exemplo.com/arquivo.pdf",
          "mimeType": "application/pdf"
        }
      ]
    }
  }
]
```

### Response
```json
{
  "conversationId": "uuid-da-conversa",
  "processedFiles": ["id-do-arquivo"],
  "failedFiles": [],
  "filename": "uuid-da-conversa-1234567890.txt",
  "downloadUrl": "http://localhost:3000/texts/uuid-da-conversa/uuid-da-conversa-1234567890.txt"
}
```

### Exemplo cURL
```bash
curl -X POST http://localhost:3000/api/messages/process-message \
  -H "Content-Type: application/json" \
  -d '[{
    "conversationId": "123e4567-e89b-12d3-a456-426614174000",
    "body": {
      "userId": "user-123",
      "files": [{
        "fileId": "file-001",
        "url": "https://exemplo.com/documento.pdf",
        "mimeType": "application/pdf"
      }]
    }
  }]'
```

### Tipos de Arquivo Suportados
- **PDF**: Extração de texto
- **Imagens**: OCR via OpenAI Vision
- **Áudio/Vídeo**: Transcrição via OpenAI Whisper
- **XLSX**: Extração de dados de planilhas
- **TXT**: Leitura direta

---

## 2. Serviço de Processamento de Edital (`/edital-process`)

Processa um edital a partir de uma URL e extrai informações estruturadas (disciplinas, tópicos, provas, etc).

### Endpoint
```
POST /api/editais/edital-process
```

### Request Body
```json
{
  "user_id": "uuid-do-usuario",
  "schedule_plan_id": "uuid-do-plano",
  "url": "https://exemplo.com/edital.pdf"
}
```

### Response
```json
{
  "edital": {
    "titulo": "Nome do Concurso",
    "orgao": "Órgão Responsável",
    "cargo": "Cargo",
    "disciplinas": [
      {
        "nome": "Português",
        "topicos": ["Gramática", "Interpretação"]
      }
    ],
    "provas": [
      {
        "nome": "Prova Objetiva",
        "tipo": "objetiva",
        "numero_questoes": 50
      }
    ]
  },
  "transcriptionUrl": "http://localhost:3000/editais-transcribed/nome-arquivo.txt",
  "jsonUrl": "http://localhost:3000/editais-json/nome-arquivo.json"
}
```

### Exemplo cURL
```bash
curl -X POST http://localhost:3000/api/editais/edital-process \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "schedule_plan_id": "987fcdeb-51a2-43f1-9876-543210fedcba",
    "url": "https://exemplo.com/edital-concurso.pdf"
  }'
```

### Fases de Processamento (Logs)

O serviço executa em background e registra logs detalhados em 7 fases:

1. **📥 Request received** - Requisição recebida e validada
2. **📡 Fetching content** - Download do arquivo da URL (com retry)
3. **🔍 Analyzing content** - Análise de tamanho e necessidade de chunking
4. **🤖 AI processing** - Processamento via Claude AI
5. **✅ Processing completed** - Extração de dados concluída
6. **✔️ Schema validation** - Validação de integridade dos dados
7. **💾 Writing to file** - Salvamento do resultado em JSON

**Tags de Log:**
- `[EDITAL-PROCESS]` - Controller (recebimento da request)
- `[EDITAL-SERVICE]` - Serviço (criação de diretórios)
- `[EDITAL-BG]` - Processamento background
- `[EDITAL-FETCH]` - Download do arquivo

### Monitoramento

Acompanhe o progresso através dos logs da Railway:
- ⏱️ Tempo decorrido a cada 10 segundos
- 📊 Métricas: tokens, chunks, disciplinas extraídas
- ⚠️ Warnings e erros de validação
- 🎉 Status final com tempo total

---

## Notas Importantes

- **Base URL**: Ajuste conforme seu ambiente (`http://localhost:3000` ou URL de produção)
- **Timeout**: Arquivos grandes podem levar alguns minutos para processar
- **UUIDs**: Devem ser válidos no formato UUID v4
- **URLs**: Devem ser acessíveis publicamente para download
- **Logs**: Habilitados quando `REQUEST_LOGS_ENABLED=true` no `.env`

## Códigos de Status

- `200`: Sucesso
- `400`: Erro de validação (corpo inválido)
- `500`: Erro interno do servidor
