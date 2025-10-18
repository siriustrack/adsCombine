# 📘 Guia de Integração Frontend - API de Processamento de Editais

## 🎯 Visão Geral

Este guia descreve como o **frontend** deve fazer a requisição para processar editais através da API.

---

## 🚀 Endpoint Principal

### **POST** `/api/edital-process`

**Base URL:** `http://localhost:3000` (desenvolvimento) ou sua URL de produção

**URL Completa:** `http://localhost:3000/api/edital-process`

---

## 📋 Request Body Schema

### **Campos Obrigatórios:**

```typescript
interface EditalProcessRequest {
  user_id: string;           // UUID do usuário (formato: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  schedule_plan_id: string;  // UUID do plano de estudos (formato: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  url: string;               // URL do arquivo de texto transcrito do edital
}
```

### **Validações Aplicadas:**

- ✅ `user_id`: Deve ser um UUID válido (v4)
- ✅ `schedule_plan_id`: Deve ser um UUID válido (v4)
- ✅ `url`: Deve ser uma URL válida (http:// ou https://)

---

## 📤 Exemplo de Requisição

### **cURL:**

```bash
curl -X POST http://localhost:3000/api/edital-process \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{
    "user_id": "98d8b11a-8a32-4f6b-9dae-6e42efa23116",
    "schedule_plan_id": "bca596cc-d484-4df1-8cf2-e9a5ca637eac",
    "url": "http://your-server.com/texts/edital-transcrito.txt"
  }'
```

### **JavaScript/TypeScript (Fetch API):**

```typescript
interface EditalProcessRequest {
  user_id: string;
  schedule_plan_id: string;
  url: string;
}

interface EditalProcessResponse {
  filePath: string;  // Caminho relativo do arquivo JSON gerado
  status: 'processing';
  jobId: string;     // ID do job para tracking
}

async function processEdital(
  userId: string,
  schedulePlanId: string,
  editalUrl: string
): Promise<EditalProcessResponse> {
  const response = await fetch('http://localhost:3000/api/edital-process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${YOUR_AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      user_id: userId,
      schedule_plan_id: schedulePlanId,
      url: editalUrl,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`API Error: ${error.error}`);
  }

  return await response.json();
}

// Uso:
const result = await processEdital(
  '98d8b11a-8a32-4f6b-9dae-6e42efa23116',
  'bca596cc-d484-4df1-8cf2-e9a5ca637eac',
  'http://your-server.com/texts/edital.txt'
);

console.log('File Path:', result.filePath);
console.log('Job ID:', result.jobId);
```

### **Axios (React/Vue/Angular):**

```typescript
import axios from 'axios';

interface EditalProcessRequest {
  user_id: string;
  schedule_plan_id: string;
  url: string;
}

interface EditalProcessResponse {
  filePath: string;
  status: 'processing';
  jobId: string;
}

const api = axios.create({
  baseURL: 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${YOUR_AUTH_TOKEN}`,
  },
});

export async function processEdital(
  userId: string,
  schedulePlanId: string,
  editalUrl: string
): Promise<EditalProcessResponse> {
  const response = await api.post<EditalProcessResponse>('/api/edital-process', {
    user_id: userId,
    schedule_plan_id: schedulePlanId,
    url: editalUrl,
  });

  return response.data;
}

// Uso em componente React:
const handleUpload = async () => {
  try {
    const result = await processEdital(
      userId,
      schedulePlanId,
      transcribedFileUrl
    );
    
    setFilePath(result.filePath);
    setJobId(result.jobId);
    setStatus('processing');
  } catch (error) {
    console.error('Erro ao processar edital:', error);
  }
};
```

---

## 📥 Response Schema

### **Sucesso (200 OK):**

```typescript
{
  "filePath": "/files/98d8b11a-8a32-4f6b-9dae-6e42efa23116/bca596cc-d484-4df1-8cf2-e9a5ca637eac/uuid-random.json",
  "status": "processing",
  "jobId": "uuid-do-job"
}
```

**Campos:**
- `filePath`: Caminho relativo do arquivo JSON (acessível via `GET http://localhost:3000{filePath}`)
- `status`: Sempre `"processing"` na resposta inicial
- `jobId`: UUID único do job para tracking

### **Erro de Validação (400 Bad Request):**

```json
{
  "error": "Invalid request body",
  "details": [
    {
      "code": "invalid_type",
      "expected": "string",
      "received": "undefined",
      "path": ["user_id"],
      "message": "Required"
    }
  ]
}
```

### **Erro Interno (500 Internal Server Error):**

```json
{
  "error": "Internal server error"
}
```

---

## 🔄 Fluxo Completo de Processamento

### **1️⃣ Upload do Edital (Frontend → Backend)**

```typescript
// Passo 1: Fazer upload do arquivo PDF/vídeo para transcription service
const transcriptionUrl = await uploadForTranscription(file);

// Passo 2: Processar o edital
const result = await processEdital(userId, schedulePlanId, transcriptionUrl);

// Resposta imediata:
// {
//   "filePath": "/files/user-id/plan-id/random-uuid.json",
//   "status": "processing",
//   "jobId": "job-uuid"
// }
```

### **2️⃣ Polling para Verificar Status**

O processamento acontece em **background**. Você deve fazer polling no arquivo para verificar o status:

```typescript
async function pollProcessingStatus(
  filePath: string,
  maxAttempts = 60,
  intervalMs = 5000
): Promise<EditalProcessado> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`http://localhost:3000${filePath}`);
      const data = await response.json();

      // Verifica se ainda está processando
      if (data.status === 'processing') {
        attempts++;
        await sleep(intervalMs);
        continue;
      }

      // Verifica se houve erro
      if (data.status === 'error') {
        throw new Error(data.error || 'Processing failed');
      }

      // Sucesso! Retorna os dados processados
      return data as EditalProcessado;
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) {
        throw new Error('Timeout: Processing took too long');
      }
      await sleep(intervalMs);
    }
  }

  throw new Error('Max polling attempts reached');
}

// Uso:
const result = await processEdital(userId, planId, url);
const processedData = await pollProcessingStatus(result.filePath);

console.log('✅ Processamento concluído!');
console.log('Concursos:', processedData.concursos);
```

### **3️⃣ Estados do Arquivo JSON**

#### **Estado 1: Processing**
```json
{
  "status": "processing",
  "jobId": "uuid-do-job",
  "startedAt": "2025-10-14T10:00:00.000Z"
}
```

#### **Estado 2: Error**
```json
{
  "status": "error",
  "jobId": "uuid-do-job",
  "error": "Failed to process edital: timeout",
  "startedAt": "2025-10-14T10:00:00.000Z",
  "failedAt": "2025-10-14T10:05:00.000Z"
}
```

#### **Estado 3: Completed (Success)**
```json
{
  "concursos": [
    {
      "id": "uuid",
      "titulo": "Concurso Público XYZ",
      "orgao": "Nome do Órgão",
      "cargo": "Cargo/Especialidade",
      "dataProva": "2025-12-15",
      "turno": "manha",
      "tipoProva": "objetiva",
      "disciplinas": [
        {
          "id": "uuid",
          "titulo": "Direito Constitucional",
          "topicos": [
            {
              "id": "uuid",
              "titulo": "Princípios Fundamentais",
              "subtopicos": ["Dignidade da pessoa humana", "..."]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 🎨 Componente React Completo (Exemplo)

```typescript
import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface EditalUploadProps {
  userId: string;
  schedulePlanId: string;
}

interface ProcessingStatus {
  status: 'idle' | 'uploading' | 'processing' | 'completed' | 'error';
  progress: number;
  message: string;
  filePath?: string;
  jobId?: string;
  data?: any;
}

export function EditalUpload({ userId, schedulePlanId }: EditalUploadProps) {
  const [status, setStatus] = useState<ProcessingStatus>({
    status: 'idle',
    progress: 0,
    message: 'Pronto para upload',
  });

  const handleFileUpload = async (file: File) => {
    try {
      // 1. Upload para serviço de transcrição
      setStatus({
        status: 'uploading',
        progress: 10,
        message: 'Fazendo upload do arquivo...',
      });

      const formData = new FormData();
      formData.append('file', file);
      
      const uploadResponse = await axios.post(
        'http://transcription-service.com/upload',
        formData
      );
      
      const transcriptionUrl = uploadResponse.data.url;

      // 2. Processar edital
      setStatus({
        status: 'processing',
        progress: 30,
        message: 'Iniciando processamento do edital...',
      });

      const processResponse = await axios.post(
        'http://localhost:3000/api/edital-process',
        {
          user_id: userId,
          schedule_plan_id: schedulePlanId,
          url: transcriptionUrl,
        }
      );

      const { filePath, jobId } = processResponse.data;

      setStatus({
        status: 'processing',
        progress: 50,
        message: 'Processando com IA (Claude Sonnet 4.5)...',
        filePath,
        jobId,
      });

      // 3. Polling para verificar conclusão
      await pollForCompletion(filePath);

    } catch (error) {
      console.error('Erro:', error);
      setStatus({
        status: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    }
  };

  const pollForCompletion = async (filePath: string) => {
    const maxAttempts = 60; // 5 minutos (5s * 60)
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        throw new Error('Timeout: Processamento levou muito tempo');
      }

      try {
        const response = await axios.get(`http://localhost:3000${filePath}`);
        const data = response.data;

        if (data.status === 'processing') {
          attempts++;
          const progress = 50 + (attempts / maxAttempts) * 50;
          setStatus({
            status: 'processing',
            progress,
            message: `Processando... (${attempts}/${maxAttempts})`,
            filePath,
          });
          
          setTimeout(poll, 5000); // Poll a cada 5 segundos
          return;
        }

        if (data.status === 'error') {
          throw new Error(data.error || 'Erro no processamento');
        }

        // Sucesso!
        setStatus({
          status: 'completed',
          progress: 100,
          message: '✅ Edital processado com sucesso!',
          data,
        });

      } catch (error) {
        throw error;
      }
    };

    await poll();
  };

  return (
    <div className="edital-upload">
      <h2>Upload de Edital</h2>
      
      <input
        type="file"
        accept=".pdf,.mp4,.mov"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
        }}
        disabled={status.status === 'processing' || status.status === 'uploading'}
      />

      {status.status !== 'idle' && (
        <div className="status">
          <div className="progress-bar">
            <div style={{ width: `${status.progress}%` }} />
          </div>
          <p>{status.message}</p>
          
          {status.jobId && <p>Job ID: {status.jobId}</p>}
          
          {status.status === 'completed' && status.data && (
            <div className="results">
              <h3>Resultados:</h3>
              <pre>{JSON.stringify(status.data, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## ⏱️ Timeouts e Performance

### **Tempos Esperados:**

| Tamanho do Edital | Tempo de Processamento |
|-------------------|------------------------|
| Pequeno (< 10 páginas) | 45s - 90s |
| Médio (10-30 páginas) | 60s - 120s |
| Grande (> 30 páginas) | 90s - 240s |

### **Configuração de Polling:**

```typescript
const POLLING_CONFIG = {
  intervalMs: 5000,      // Poll a cada 5 segundos
  maxAttempts: 60,       // Máximo 60 tentativas (5 minutos)
  timeout: 300000,       // Timeout total: 5 minutos
};
```

---

## 🔒 Autenticação

A API requer autenticação via header `Authorization`:

```typescript
headers: {
  'Authorization': `Bearer ${YOUR_AUTH_TOKEN}`,
}
```

**Nota:** Verifique com o backend qual o formato exato do token de autenticação.

---

## 🐛 Tratamento de Erros

### **Erros Comuns:**

1. **400 Bad Request:**
   - `user_id` inválido (não é UUID)
   - `schedule_plan_id` inválido (não é UUID)
   - `url` inválida (não é URL válida)

2. **500 Internal Server Error:**
   - Falha na comunicação com Claude
   - Erro ao baixar arquivo da URL
   - Erro ao salvar arquivo JSON

3. **Timeout:**
   - Processamento levou mais de 4 minutos
   - Serviço de transcrição não respondeu

### **Exemplo de Tratamento:**

```typescript
try {
  const result = await processEdital(userId, planId, url);
  const data = await pollProcessingStatus(result.filePath);
  
  // Sucesso
  console.log('✅ Edital processado:', data);
  
} catch (error) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 400) {
      alert('Dados inválidos. Verifique user_id e schedule_plan_id.');
    } else if (error.response?.status === 500) {
      alert('Erro no servidor. Tente novamente mais tarde.');
    }
  } else if (error instanceof Error && error.message.includes('Timeout')) {
    alert('Processamento levou muito tempo. Tente com um edital menor.');
  } else {
    alert('Erro desconhecido. Contate o suporte.');
  }
}
```

---

## 📊 Estrutura dos Dados Retornados

Após o processamento completo, o JSON terá esta estrutura:

```typescript
interface EditalProcessado {
  concursos: Concurso[];
}

interface Concurso {
  id: string;
  titulo: string;
  orgao: string;
  cargo: string;
  dataProva: string; // ISO 8601
  turno: 'manha' | 'tarde' | 'noite';
  tipoProva: 'objetiva' | 'discursiva' | 'prática' | 'oral';
  disciplinas: Disciplina[];
}

interface Disciplina {
  id: string;
  titulo: string;
  topicos: Topico[];
}

interface Topico {
  id: string;
  titulo: string;
  subtopicos: string[];
}
```

---

## 🎯 Checklist de Integração

- [ ] Implementar upload de arquivo para serviço de transcrição
- [ ] Implementar chamada POST para `/api/edital-process`
- [ ] Implementar sistema de polling para verificar status
- [ ] Implementar tratamento de erros (400, 500, timeout)
- [ ] Implementar UI para mostrar progresso
- [ ] Implementar exibição dos resultados finais
- [ ] Testar com editais de diferentes tamanhos
- [ ] Adicionar logs para debugging
- [ ] Implementar retry em caso de falha temporária

---

## 📞 Suporte

- **Backend Developer:** Paulo Chaves
- **Repositório:** https://github.com/siriustrack/adsCombine
- **Branch:** `escola-da-aprovacao`
- **Documentação Adicional:**
  - `docs/MIGRACAO-CLAUDE-RESULTADOS.md`
  - `docs/ESTRUTURA-EDITAIS.md`
  - `test/test-edital-process.sh` (script de teste)

---

**Última atualização:** 14 de outubro de 2025
