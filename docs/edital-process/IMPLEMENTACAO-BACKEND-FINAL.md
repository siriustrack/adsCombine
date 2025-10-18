# 🎯 PLANO DE IMPLEMENTAÇÃO FINAL: Correção Backend Edital-Process

> **Data:** 18 de outubro de 2025  
> **Contexto:** Edge function (frontend) JÁ funciona - apenas backend precisa correção  
> **Tempo:** 1-2 horas  
> **Escopo:** Apenas Node.js microservices (NÃO mexemos na edge function)

---

## 🔍 Situação Atual

### ✅ O Que JÁ Funciona (Edge Function - Frontend)

A edge function `upload-and-process` do Supabase **JÁ FAZ:**
1. ✅ Upload do PDF no bucket 'editals'
2. ✅ Cria `edital_file` no banco (status: 'processing')
3. ✅ Chama serviço de transcrição (externo)
4. ✅ Baixa TXT retornado e salva no bucket
5. ✅ Atualiza `edital_file.transcription_url`
6. ✅ **Chama nosso backend:** `POST /api/edital-process`

**Request que a edge function envia para nós:**
```typescript
{
  user_id: "uuid",
  schedule_plan_id: "edital-file-id", // ← NOME ERRADO (mas é o edital_file.id correto)
  url: "https://...txt", // URL do TXT já transcrito
  edital_bucket_path: "path/file.pdf",
  file_name: "edital.pdf",
  file_size: 123456,
  mime_type: "application/pdf"
}
```

---

### ❌ O Que Está Quebrado (Nosso Backend Node.js)

**Nosso microserviço `/api/edital-process` FALHA:**
1. ❌ Aceita `schedule_plan_id` mas deveria aceitar `edital_file_id`
2. ❌ Processa TXT com Claude ✅ (funciona)
3. ❌ Salva JSON no filesystem ✅ (funciona)
4. ❌ **NÃO atualiza** `edital_file` (processing_result, json_url, status: 'ready')
5. ❌ **NÃO chama** orchestrator → study_plans não são criados

**Resultado:** JSON fica órfão, usuário não vê nada no frontend.

---

## 🎯 Fluxo Correto (Com Correção)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. FRONTEND (FileZone)                                          │
│    → Usuario faz upload do PDF                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. EDGE FUNCTION (upload-and-process) - Supabase               │
│    ✅ 2.1. Upload PDF → bucket 'editals'                        │
│    ✅ 2.2. Criar edital_file (status: 'processing')             │
│    ✅ 2.3. Enviar para serviço de transcrição (externo)         │
│    ✅ 2.4. Baixar TXT, salvar no bucket, atualizar              │
│            edital_file.transcription_url                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. NOSSO BACKEND (edital-process) - Node.js                    │
│    ✅ 3.1. Receber request com edital_file_id (renomear)        │
│    ✅ 3.2. Baixar TXT da URL                                    │
│    ✅ 3.3. Extrair dados com Claude (JÁ FUNCIONA)               │
│    ✅ 3.4. Salvar JSON no filesystem (JÁ FUNCIONA)              │
│    🔧 3.5. NOVO: Atualizar edital_file                          │
│            - processing_result: JSON completo                   │
│            - json_url: path público                             │
│            - edital_status: 'ready'                             │
│    🔧 3.6. NOVO: Chamar orchestrator                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. ORCHESTRATOR (createStudyPlan) - Node.js                    │
│    ✅ 4.1. Pre-orchestrator: Identificar concursos              │
│    ✅ 4.2. Para cada concurso no JSON:                          │
│            - Criar study_plan                                   │
│            - Criar exams                                        │
│            - Criar disciplines                                  │
│            - Criar topics                                       │
│    ✅ 4.3. Vincular study_plan.edital_id → edital_file.id       │
│    ✅ 4.4. Atualizar study_plan.status = 'ready'                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. FRONTEND (Polling)                                           │
│    → Consulta edital_file.status a cada 5-10s                   │
│    → Quando 'ready': Busca study_plans criados                  │
│    → Mostra lista de concursos para usuário escolher            │
│    → Usuário configura restante (datas, turnos, etc)            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 O Que Precisamos Corrigir (Backend Node.js)

### Problema 1: Nome do Parâmetro Errado

**Edge function envia:**
```typescript
{ schedule_plan_id: "edital-file-id" } // Nome errado, mas valor correto
```

**Nosso backend deveria aceitar:**
```typescript
{ edital_file_id: "edital-file-id" } // Nome correto
```

**IMPORTANTE:** 
- ❌ NÃO vamos mudar edge function (não temos acesso)
- ✅ Vamos aceitar os DOIS nomes (compatibilidade)

---

### Problema 2: Backend Não Atualiza Banco

**Código atual:** Salva JSON e para
**Código correto:** Salva JSON + atualiza banco + chama orchestrator

---

## 📋 IMPLEMENTAÇÃO (Apenas Backend Node.js)

### PASSO 1: Controller - Aceitar Ambos Parâmetros (5min)

**Arquivo:** `src/api/controllers/editais.controllers.ts`

```typescript
// ANTES:
const EditalProcessBodySchema = z.object({
  user_id: z.string().uuid(),
  schedule_plan_id: z.string().uuid(), // ← Edge function envia esse
  url: z.string().url(),
  edital_bucket_path: z.string().min(1),
  file_name: z.string().optional(),
  file_size: z.number().int().positive().optional(),
  mime_type: z.string().optional(),
});

// DEPOIS (aceitar ambos para compatibilidade):
const EditalProcessBodySchema = z.object({
  user_id: z.string().uuid(),
  schedule_plan_id: z.string().uuid().optional(), // ← Edge function envia esse
  edital_file_id: z.string().uuid().optional(), // ← Nome correto
  url: z.string().url(),
  edital_bucket_path: z.string().min(1),
  file_name: z.string().optional(),
  file_size: z.number().int().positive().optional(),
  mime_type: z.string().optional(),
}).refine(
  (data) => data.schedule_plan_id || data.edital_file_id,
  { message: "schedule_plan_id ou edital_file_id é obrigatório" }
);

// No handler, normalizar:
export class EditaisController {
  processEditalHandler = async (req: Request, res: Response) => {
    // ... validação ...
    
    // Normalizar: usar edital_file_id se vier, senão usar schedule_plan_id
    const edital_file_id = body.edital_file_id || body.schedule_plan_id;
    
    const result = await editalProcessService.execute({
      ...body,
      edital_file_id, // ← Sempre passa nome correto para service
    });
    
    return res.status(200).json(result);
  };
}
```

---

### PASSO 2: Service Interface (5min)

**Arquivo:** `src/core/services/editais/edital-process.service.ts`

```typescript
// ANTES:
export interface EditalProcessRequest {
  user_id: string;
  schedule_plan_id: string; // ← REMOVER
  url: string;
  edital_bucket_path: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  options?: { /* ... */ };
}

// DEPOIS:
export interface EditalProcessRequest {
  user_id: string;
  edital_file_id: string; // ← Nome correto
  url: string;
  edital_bucket_path: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  options?: { /* ... */ };
}

export interface EditalProcessResponse {
  edital_file_id: string; // ← NOVO
  filePath: string;
  status: 'processing';
  jobId: string;
  user_id: string;
  estimation: {
    totalCharacters: number;
    totalCharactersKB: number;
    estimatedTimeMs: number;
    estimatedTimeSeconds: number;
    estimatedTimeMinutes: number;
    estimatedCompletionAt: string;
  };
}
```

---

### PASSO 3: Service - Adicionar Cliente Supabase (5min)

**Arquivo:** `src/core/services/editais/edital-process.service.ts`

```typescript
// No topo do arquivo, adicionar imports:
import { createClient } from '@supabase/supabase-js';
import { env } from '@config/env';
import { createStudyPlan } from '@agents/index';

// Na classe, adicionar:
export class EditalProcessService {
  private anthropic: Anthropic;
  private chunker: EditalChunker;
  private supabase; // ← NOVO

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: anthropicConfig.apiKey,
    });
    
    this.chunker = new EditalChunker({
      maxChunkSize: 80000,
      overlapSize: 2000,
      splitOn: 'section',
    });
    
    // ← NOVO: Cliente Supabase
    this.supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  
  // ... resto do código ...
}
```

---

### PASSO 4: Service - Método execute() (10min)

**Arquivo:** `src/core/services/editais/edital-process.service.ts:67`

**Mudanças:**
1. Renomear `schedule_plan_id` → `edital_file_id`
2. Renomear `scheduleDir` → `editalDir`
3. Passar `edital_file_id` para `processInBackground`

```typescript
async execute(request: EditalProcessRequest): Promise<EditalProcessResponse> {
  // ANTES:
  const { user_id, schedule_plan_id, url, edital_bucket_path, ... } = request;
  
  // DEPOIS:
  const { user_id, edital_file_id, url, edital_bucket_path, ... } = request;
  
  const jobId = randomUUID();
  
  logger.info('[EDITAL-SERVICE] 🎯 Starting edital processing', { 
    jobId, 
    user_id, 
    edital_file_id, // ← Renomear log
    url,
  });

  const randomName = randomUUID();
  const fileName = `${randomName}.json`;

  // ANTES:
  const scheduleDir = path.join(userDir, schedule_plan_id);
  
  // DEPOIS:
  const editalDir = path.join(userDir, edital_file_id);
  const filePath = path.join(editalDir, fileName);

  // Criar diretórios
  if (!fs.existsSync(editalDir)) {
    fs.mkdirSync(editalDir, { recursive: true });
  }

  // ... código de estimation permanece igual ...

  // ANTES:
  this.processInBackground(url, filePath, jobId, options, contentSample);
  
  // DEPOIS (passar edital_file_id como primeiro parâmetro):
  this.processInBackground(
    edital_file_id, // ← NOVO parâmetro
    request,
    filePath,
    jobId,
    contentSample
  );

  // ANTES:
  const publicPath = `/files/${user_id}/${schedule_plan_id}/${fileName}`;
  
  // DEPOIS:
  const publicPath = `/files/${user_id}/${edital_file_id}/${fileName}`;

  return {
    edital_file_id, // ← NOVO campo
    filePath: publicPath,
    status: 'processing',
    jobId,
    user_id,
    estimation: { /* ... */ },
  };
}
```

---

### PASSO 5: Service - Método processInBackground() (30min)

**Arquivo:** `src/core/services/editais/edital-process.service.ts:220`

```typescript
// ANTES:
private async processInBackground(
  url: string,
  outputPath: string,
  jobId: string,
  options?: EditalProcessRequest['options'],
  preloadedContent?: string
) {
  // ...
}

// DEPOIS:
private async processInBackground(
  editalFileId: string, // ← NOVO parâmetro (primeiro)
  request: EditalProcessRequest,
  outputPath: string,
  jobId: string,
  preloadedContent?: string
) {
  const startTime = Date.now();

  try {
    logger.info('[EDITAL-BG] 🔄 Starting background processing', {
      jobId,
      editalFileId,
      url: request.url,
    });

    // 1. Processar conteúdo (JÁ FUNCIONA)
    const content = preloadedContent || 
      await this.fetchContentWithRetry(request.url);
    
    const resultado = await this.processEditalAdaptive(content);

    // 2. Salvar JSON (JÁ FUNCIONA)
    fs.writeFileSync(outputPath, JSON.stringify(resultado, null, 2));
    
    const publicPath = outputPath.replace(PUBLIC_DIR, '');

    logger.info('[EDITAL-BG] ✅ JSON saved successfully', {
      jobId,
      editalFileId,
      outputPath: publicPath,
    });

    // ✅ 3. NOVO: Atualizar edital_file no banco
    logger.info('[EDITAL-BG] 📝 Updating edital_file in database', {
      jobId,
      editalFileId,
    });

    const { error: updateError } = await this.supabase
      .from('edital_file')
      .update({
        processing_result: resultado,
        json_url: publicPath,
        edital_status: 'ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', editalFileId);

    if (updateError) {
      logger.error('[EDITAL-BG] ❌ Failed to update edital_file', {
        jobId,
        editalFileId,
        error: updateError,
      });
      throw updateError;
    }

    logger.info('[EDITAL-BG] ✅ Edital_file updated successfully', {
      jobId,
      editalFileId,
      status: 'ready',
    });

    // ✅ 4. NOVO: Chamar orchestrator
    await this.triggerOrchestrator(editalFileId, request.user_id, resultado);

  } catch (error) {
    logger.error('[EDITAL-BG] ❌ Processing failed', {
      jobId,
      editalFileId,
      error: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Marcar como erro no banco
    await this.supabase
      .from('edital_file')
      .update({
        edital_status: 'error',
        updated_at: new Date().toISOString(),
      })
      .eq('id', editalFileId);

    throw error;
  }
}
```

---

### PASSO 6: Service - Novo Método triggerOrchestrator() (20min)

**Arquivo:** `src/core/services/editais/edital-process.service.ts` (adicionar no final da classe)

```typescript
/**
 * Chama o orchestrator para criar study_plans a partir do JSON extraído
 */
private async triggerOrchestrator(
  editalFileId: string,
  userId: string,
  processedData: EditalProcessado
): Promise<void> {
  logger.info('[ORCHESTRATOR] 🤖 Triggering orchestrator', {
    editalFileId,
    userId,
    concursos: processedData.concursos?.length || 0,
  });

  try {
    // Validar se tem concursos
    if (!processedData.concursos || processedData.concursos.length === 0) {
      logger.warn('[ORCHESTRATOR] ⚠️  No concursos found in processed data', {
        editalFileId,
        userId,
      });
      return;
    }

    // Chamar orchestrator principal
    const result = await createStudyPlan({
      userId,
      editalJson: processedData,
    });

    if (!result.success) {
      logger.error('[ORCHESTRATOR] ❌ Failed to create study plan', {
        editalFileId,
        userId,
        error: result.error,
      });
      return;
    }

    const studyPlanId = result.data;

    logger.info('[ORCHESTRATOR] ✅ Study plan created', {
      editalFileId,
      userId,
      studyPlanId,
    });

    // Vincular study_plan ao edital_file
    const { error: linkError } = await this.supabase
      .from('study_plans')
      .update({ edital_id: editalFileId })
      .eq('id', studyPlanId);

    if (linkError) {
      logger.error('[ORCHESTRATOR] ⚠️  Failed to link study_plan to edital', {
        editalFileId,
        studyPlanId,
        error: linkError,
      });
    } else {
      logger.info('[ORCHESTRATOR] ✅ Study plan linked to edital successfully', {
        editalFileId,
        studyPlanId,
      });
    }

  } catch (error) {
    logger.error('[ORCHESTRATOR] ❌ Critical error', {
      editalFileId,
      userId,
      error: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Não fazer throw - orquestração falhou mas processamento foi ok
    // Frontend pode tentar reprocessar depois
  }
}
```

---

## ✅ Checklist de Implementação

### Código:
- [ ] Controller: Aceitar `schedule_plan_id` E `edital_file_id` (compatibilidade)
- [ ] Controller: Normalizar para `edital_file_id` antes de chamar service
- [ ] Service: Interface atualizada (`edital_file_id`)
- [ ] Service: Cliente Supabase adicionado no constructor
- [ ] Service: `execute()` - variáveis renomeadas
- [ ] Service: `processInBackground()` - assinatura atualizada (editalFileId primeiro)
- [ ] Service: `processInBackground()` - atualizar edital_file após salvar JSON
- [ ] Service: `triggerOrchestrator()` - novo método criado

### Testes:
- [ ] Testar com 1 edital via frontend (upload PDF)
- [ ] Verificar criação de `edital_file` (edge function)
- [ ] Verificar processamento backend (logs)
- [ ] Verificar atualização de `edital_file.edital_status = 'ready'`
- [ ] Verificar criação de `study_plans`
- [ ] Verificar `disciplines` e `topics` inseridos
- [ ] Verificar vinculação `study_plans.edital_id → edital_file.id`

---

## 🧪 Validação Via MCP (Após Deploy)

```typescript
// Via MCP Supabase - Verificar último edital processado:
mcp_supabase_execute_sql({
  query: `
    SELECT 
      ef.id as edital_file_id,
      ef.file_name,
      ef.edital_status,
      ef.transcription_url IS NOT NULL as has_txt,
      ef.json_url IS NOT NULL as has_json,
      ef.processing_result IS NOT NULL as has_result,
      sp.id as study_plan_id,
      sp.exam_name,
      sp.status as plan_status,
      COUNT(DISTINCT d.id) as num_disciplines,
      COUNT(DISTINCT t.id) as num_topics
    FROM edital_file ef
    LEFT JOIN study_plans sp ON sp.edital_id = ef.id
    LEFT JOIN disciplines d ON d.plan_id = sp.id
    LEFT JOIN topics t ON t.plan_id = sp.id
    WHERE ef.created_at > NOW() - INTERVAL '1 hour'
    GROUP BY ef.id, sp.id
    ORDER BY ef.created_at DESC
    LIMIT 1;
  `
});
```

**Esperado:**
```json
{
  "edital_file_id": "uuid",
  "file_name": "edital-uploaded.pdf",
  "edital_status": "ready", // ← Se 'processing', ainda processando
  "has_txt": true,
  "has_json": true,
  "has_result": true,
  "study_plan_id": "uuid", // ← Se null, orchestrator não rodou
  "exam_name": "Nome do Concurso",
  "plan_status": "ready",
  "num_disciplines": 10-15, // ← Deve ter disciplinas
  "num_topics": 50-100 // ← Deve ter tópicos
}
```

---

## 📊 Tempo de Implementação

| Passo | Tarefa | Tempo |
|-------|--------|-------|
| 1 | Controller (aceitar ambos parâmetros) | 5min |
| 2 | Service interface | 5min |
| 3 | Service constructor (Supabase client) | 5min |
| 4 | Service execute() | 10min |
| 5 | Service processInBackground() | 30min |
| 6 | Service triggerOrchestrator() | 20min |
| **SUBTOTAL** | **Código** | **75min** |
| | Teste end-to-end | 30min |
| | Validação MCP | 15min |
| **TOTAL** | **Com testes** | **2h** |

---

## 🚀 Deploy

```bash
# 1. Criar branch
git checkout -b fix/edital-process-accept-both-ids

# 2. Implementar mudanças (seguir passos acima)

# 3. Commit
git add .
git commit -m "fix: accept schedule_plan_id (edge function) as edital_file_id and integrate orchestrator

- Controller: accept both schedule_plan_id and edital_file_id for compatibility
- Service: normalize to edital_file_id internally
- Service: add Supabase client for database updates
- Service: update edital_file after Claude processing
- Service: trigger orchestrator to create study_plans
- Service: link study_plans.edital_id to edital_file.id"

# 4. Push e deploy
git push origin fix/edital-process-accept-both-ids

# Backend deploy depende do ambiente (Railway/Vercel/Docker)
```

---

## 📚 Resumo Final

**O que NÃO mexemos:**
- ❌ Edge function (Supabase - frontend controla)
- ❌ Serviço de transcrição (externo)
- ❌ Frontend (React)

**O que mexemos (Node.js microservices):**
- ✅ Backend `/api/edital-process` (controller + service)
- ✅ Integração com Supabase (atualizar edital_file)
- ✅ Chamada do orchestrator (criar study_plans)

**Resultado esperado:**
```
Upload PDF → Edge function cria edital_file → 
Backend processa TXT → Atualiza edital_file.status='ready' → 
Orchestrator cria study_plans → Frontend mostra concursos
```

---

**FIM DO DOCUMENTO**
