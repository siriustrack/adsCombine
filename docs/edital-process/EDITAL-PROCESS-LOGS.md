# Guia de Logs - Edital Process

## 📊 Fluxo de Logs do Processamento

### Controller Layer (`editais.controllers.ts`)

```
[EDITAL-PROCESS] 📥 Request received
├── requestId
├── hasBody
└── bodyKeys

[EDITAL-PROCESS] ✅ Validation passed
├── user_id
├── schedule_plan_id
├── url
└── urlDomain

[EDITAL-PROCESS] 🚀 Starting edital processing service
└── requestId

[EDITAL-PROCESS] ✅ Processing initiated successfully
├── jobId
├── filePath
└── status: "processing"
```

### Service Layer (`edital-process.service.ts`)

```
[EDITAL-SERVICE] 🎯 Starting edital processing
├── jobId
├── user_id
├── schedule_plan_id
└── urlDomain

[EDITAL-SERVICE] 📁 Creating directories
├── userDir: /public/{user_id}
├── scheduleDir: /public/{user_id}/{schedule_plan_id}
└── fileName: {uuid}.json

[EDITAL-SERVICE] 📝 Created processing status file
└── filePath

[EDITAL-SERVICE] ⚡ Returning immediate response
└── publicPath: /files/{user_id}/{schedule_plan_id}/{uuid}.json
```

### Background Processing

```
[EDITAL-BG] 🔄 Starting background processing
└── jobId

[EDITAL-BG] ⏱️  Processing time elapsed (a cada 10s)
├── elapsed: 10s, 20s, 30s...
└── jobId

[EDITAL-BG] 📥 Step 1/7: Fetching content from URL
└── url

[EDITAL-FETCH] 📡 Attempting to fetch content
├── url
├── attempt: 1/3
├── maxRetries: 3
└── urlDomain

[EDITAL-FETCH] ✅ Content fetched successfully
├── statusCode: 200
├── contentType
├── contentLength
└── attempt

[EDITAL-BG] ✅ Step 2/7: Content fetched
├── contentLength
├── contentSizeKB
├── estimatedTokens
└── jobId

[EDITAL-BG] 🔍 Step 3/7: Analyzing content size
├── contentLength
├── requiresChunking: true/false
├── chunkingEnabled
└── jobId

[EDITAL-BG] 🤖 Step 4/7: Starting AI processing
├── model: "claude-3-5-sonnet-20241022"
├── requiresChunking
└── jobId

[EDITAL-BG] ✅ Step 5/7: AI processing completed
├── concursos: count
├── totalDisciplinas: count
├── totalQuestoes: count
└── jobId

[EDITAL-BG] ✔️  Step 6/7: Validating schema
└── jobId

[EDITAL-BG] ✅ Schema validation passed
└── jobId

[EDITAL-BG] 💾 Step 7/7: Writing to file
├── outputPath
└── jobId

[EDITAL-BG] 🎉 Edital processing completed successfully
├── totalTime: seconds
├── totalTimeFormatted: "Xm Ys"
├── concursos: count
├── totalDisciplinas: count
├── totalQuestoes: count
└── integridadeOK: true/false
```

## 🚨 Logs de Erro

### Validation Error
```
[EDITAL-PROCESS] ❌ Validation error
├── requestId
└── errors: [{ path, message, ... }]
```

### Fetch Error (com retry)
```
[EDITAL-FETCH] ⚠️  Failed to fetch content
├── url
├── attempt: 1/3
├── maxRetries: 3
└── error: message

[EDITAL-FETCH] 🔄 Retrying after delay
├── delay: 2000ms
├── delaySeconds: 2
├── attempt: 1
└── nextAttempt: 2

[EDITAL-FETCH] ❌ All fetch attempts failed
├── url
├── maxRetries: 3
└── lastError
```

### Schema Validation Error
```
[EDITAL-BG] ❌ Schema validation failed
├── errors: []
├── warnings: []
└── jobId
```

### Critical Error
```
[EDITAL-PROCESS] ❌ Critical error
├── requestId
├── error
├── stack
├── user_id
├── schedule_plan_id
└── url

[EDITAL-BG] ❌ Critical error during processing
├── error
├── stack
├── url
├── jobId
├── totalTime
└── totalTimeFormatted
```

## 🔍 Como Acompanhar no Railway

### 1. Buscar por Job ID
```
jobId: "abc-123-def-456"
```

### 2. Filtrar por Tags
```
[EDITAL-PROCESS]  # Controller logs
[EDITAL-SERVICE]  # Service setup
[EDITAL-BG]       # Background processing
[EDITAL-FETCH]    # File download
```

### 3. Verificar Status
- ✅ = Sucesso
- ⚠️ = Warning/Retry
- ❌ = Erro
- 📥📡🔍🤖💾 = Fases do processo

### 4. Métricas Importantes
- `contentSizeKB` - Tamanho do arquivo baixado
- `estimatedTokens` - Tokens estimados para Claude
- `requiresChunking` - Se precisa dividir em chunks
- `totalTime` - Tempo total de processamento
- `totalDisciplinas` - Disciplinas extraídas
- `totalQuestoes` - Questões identificadas
- `integridadeOK` - Validação passou

## 📋 Exemplo de Log Completo (Sucesso)

```json
[EDITAL-PROCESS] 📥 Request received { requestId: "req-001", hasBody: true }
[EDITAL-PROCESS] ✅ Validation passed { user_id: "user-123", url: "https://..." }
[EDITAL-SERVICE] 🎯 Starting edital processing { jobId: "job-abc" }
[EDITAL-SERVICE] 📁 Creating directories { fileName: "xyz.json" }
[EDITAL-SERVICE] ⚡ Returning immediate response { publicPath: "/files/..." }
[EDITAL-BG] 🔄 Starting background processing { jobId: "job-abc" }
[EDITAL-FETCH] 📡 Attempting to fetch content { attempt: 1, url: "..." }
[EDITAL-FETCH] ✅ Content fetched successfully { contentLength: 45000 }
[EDITAL-BG] ✅ Step 2/7: Content fetched { contentSizeKB: 44, estimatedTokens: 11250 }
[EDITAL-BG] 🔍 Step 3/7: Analyzing content size { requiresChunking: false }
[EDITAL-BG] 🤖 Step 4/7: Starting AI processing { model: "claude-3-5-sonnet" }
[EDITAL-BG] ⏱️  Processing time elapsed { elapsed: 10 }
[EDITAL-BG] ⏱️  Processing time elapsed { elapsed: 20 }
[EDITAL-BG] ✅ Step 5/7: AI processing completed { concursos: 1, totalDisciplinas: 8 }
[EDITAL-BG] ✔️  Step 6/7: Validating schema { jobId: "job-abc" }
[EDITAL-BG] ✅ Schema validation passed { jobId: "job-abc" }
[EDITAL-BG] 💾 Step 7/7: Writing to file { outputPath: "/public/..." }
[EDITAL-BG] 🎉 Edital processing completed successfully { 
  totalTime: 25, 
  totalTimeFormatted: "0m 25s",
  concursos: 1,
  totalDisciplinas: 8,
  totalQuestoes: 50,
  integridadeOK: true
}
```

## 🎯 Troubleshooting Rápido

| Sintoma | Log | Ação |
|---------|-----|------|
| Request não chega | Sem `[EDITAL-PROCESS]` | Verificar rota/endpoint |
| Validação falha | `❌ Validation error` | Verificar formato do body |
| Download falha | `❌ All fetch attempts failed` | Verificar URL acessível |
| AI demora muito | `⏱️ elapsed: 60+` | Normal para arquivos grandes |
| Validação falha | `❌ Schema validation failed` | Verificar estrutura do edital |
| Arquivo não salva | Sem `💾 Step 7/7` | Verificar permissões de disco |
