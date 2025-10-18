# 📊 FLUXO COMPLETO: Upload Edital → Study Plans

> **Pipeline end-to-end:** Frontend → Edge Functions → Backend → Supabase  
> **Última atualização:** 18 de outubro de 2025

---

## 🎯 Visão Geral

```
Usuario Upload PDF
      ↓
Edge Function (Supabase)
      ↓
Backend Node.js
      ↓
Orchestrator
      ↓
Supabase Database
      ↓
Frontend (Polling)
      ↓
Usuario Escolhe Concurso
```

---

## 📍 ETAPA 1: Frontend - Upload do PDF

**Local:** React Frontend (FileZone Component)

### 1.1. Usuário Seleciona Arquivo
```typescript
// Usuario clica no botão de upload
<FileZone 
  onFileSelect={(file) => uploadToSupabase(file)}
  accept="application/pdf"
/>
```

### 1.2. Frontend Dispara Edge Function
```typescript
// Frontend NÃO faz upload direto
// Usa multipart/form-data para Edge Function
const formData = new FormData();
formData.append('editalPdf', pdfFile);
formData.append('userId', user.id);

const response = await fetch(
  `${SUPABASE_URL}/functions/v1/upload-and-process`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${anonKey}`,
    },
    body: formData
  }
);
```

**Response esperado:**
```json
{
  "editalFileId": "uuid-da-edital-file",
  "status": "processing",
  "message": "Edital recebido e sendo processado"
}
```

---

## 📍 ETAPA 2: Edge Function - Upload e Transcrição

**Local:** Supabase Edge Functions (Frontend Codebase)  
**Função:** `supabase/functions/upload-and-process/index.ts`

### 2.1. Armazenar PDF no Bucket
```typescript
// Edge function recebe FormData
const formData = await request.formData();
const pdfFile = formData.get('editalPdf');
const userId = formData.get('userId');

// Upload para bucket 'editals'
const fileName = `${userId}/${Date.now()}-${pdfFile.name}`;
const { data: uploadData, error: uploadError } = await supabase.storage
  .from('editals')
  .upload(fileName, pdfFile, {
    contentType: 'application/pdf',
    upsert: false
  });

// Log: "✅ PDF uploaded to bucket: editals/user-id/timestamp-file.pdf"
```

### 2.2. Criar Registro edital_file
```typescript
// Criar registro no banco ANTES de processar
const { data: editalFile, error: insertError } = await supabase
  .from('edital_file')
  .insert({
    user_id: userId,
    file_name: pdfFile.name,
    file_size: pdfFile.size,
    mime_type: 'application/pdf',
    edital_bucket_path: fileName,
    edital_status: 'processing', // ← Estado inicial
  })
  .select()
  .single();

// Log: "✅ Edital_file created: uuid-edital-file-id"
```

### 2.3. Chamar Serviço de Transcrição (Externo)
```typescript
// URL pública do PDF
const { data: publicUrl } = supabase.storage
  .from('editals')
  .getPublicUrl(fileName);

// Chamada para serviço externo (Python/Transcription)
const transcriptionResponse = await fetch(
  'https://external-transcription-service.com/api/transcribe',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdfUrl: publicUrl.publicUrl,
      outputFormat: 'txt'
    })
  }
);

const { txtUrl } = await transcriptionResponse.json();
// Retorna: "https://temp-storage.com/transcription-123.txt"

// Log: "✅ PDF transcribed to TXT"
```

### 2.4. Baixar TXT e Salvar no Bucket
```typescript
// Baixar TXT do serviço externo
const txtResponse = await fetch(txtUrl);
const txtContent = await txtResponse.text();

// Salvar TXT no bucket Supabase
const txtFileName = fileName.replace('.pdf', '.txt');
const { data: txtUpload, error: txtError } = await supabase.storage
  .from('editals')
  .upload(txtFileName, txtContent, {
    contentType: 'text/plain',
    upsert: true
  });

// Obter URL pública do TXT
const { data: txtPublicUrl } = supabase.storage
  .from('editals')
  .getPublicUrl(txtFileName);

// Atualizar edital_file com URL do TXT
await supabase
  .from('edital_file')
  .update({ transcription_url: txtPublicUrl.publicUrl })
  .eq('id', editalFile.id);

// Log: "✅ TXT saved to bucket and referenced in edital_file"
```

### 2.5. Chamar Backend Node.js
```typescript
// Enviar TXT para nosso backend processar
const apiUrl = Deno.env.get('BACKEND_API_URL');

const processingPayload = {
  user_id: userId,
  schedule_plan_id: editalFile.id, // ← NOME ERRADO (mas valor correto)
  url: txtPublicUrl.publicUrl,
  edital_bucket_path: fileName,
  file_name: pdfFile.name,
  file_size: pdfFile.size,
  mime_type: 'application/pdf'
};

await fetch(`${apiUrl}/api/edital-process`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(processingPayload)
});

// Log: "✅ Backend /api/edital-process called"
```

**Response final da edge function para frontend:**
```json
{
  "editalFileId": "uuid-edital-file-id",
  "status": "processing",
  "transcriptionUrl": "https://...txt"
}
```

---

## 📍 ETAPA 3: Backend - Processar TXT e Extrair Dados

**Local:** Node.js Microservices  
**Endpoint:** `POST /api/edital-process`  
**Arquivo:** `src/core/services/editais/edital-process.service.ts`

### 3.1. Receber Request e Validar
```typescript
// Controller valida request
const body = EditalProcessBodySchema.parse(req.body);

// Normalizar parâmetro (compatibilidade com edge function)
const edital_file_id = body.edital_file_id || body.schedule_plan_id;

// Service processa
const result = await editalProcessService.execute({
  ...body,
  edital_file_id
});

// Log: "🎯 Starting edital processing for edital_file_id: uuid"
```

### 3.2. Baixar TXT da URL
```typescript
// Método: fetchContentWithRetry()
const response = await fetch(url);
const content = await response.text();

// Log: "📥 Content fetched: 45KB"
```

### 3.3. Extrair Dados com Claude (Estratégia Adaptativa)
```typescript
// Método: processEditalAdaptive()
const resultado = await this.processEditalAdaptive(content);

// Estratégias:
// 1. Single-shot (< 80KB)
// 2. Chunked (80-200KB) 
// 3. Streaming (> 200KB)

// Log: "✅ Adaptive strategy selected: single-shot"
// Log: "✅ Claude extraction completed in 8.5s"
```

**Estrutura do JSON retornado:**
```json
{
  "concursos": [
    {
      "nome": "Concurso TRE-SP 2024",
      "orgao": "Tribunal Regional Eleitoral",
      "cargo": "Técnico Judiciário",
      "nivel": "Médio",
      "vagasTotal": 50,
      "disciplinas": [
        {
          "nome": "Língua Portuguesa",
          "topicos": [
            "Interpretação de textos",
            "Ortografia oficial"
          ]
        }
      ]
    }
  ]
}
```

### 3.4. Salvar JSON no Filesystem
```typescript
// Criar diretório: /public/files/{user_id}/{edital_file_id}/
const editalDir = path.join(
  PUBLIC_DIR, 
  'files', 
  user_id, 
  edital_file_id
);

fs.mkdirSync(editalDir, { recursive: true });

// Salvar JSON
const fileName = `${randomUUID()}.json`;
const filePath = path.join(editalDir, fileName);

fs.writeFileSync(
  filePath, 
  JSON.stringify(resultado, null, 2)
);

// Public path: /files/{user_id}/{edital_file_id}/{uuid}.json
const publicPath = `/files/${user_id}/${edital_file_id}/${fileName}`;

// Log: "✅ JSON saved: /files/user-123/edital-456/abc-def.json"
```

### 3.5. Atualizar edital_file no Banco 🔧 **NOVO**
```typescript
// Método: processInBackground() (após salvar JSON)
const { error: updateError } = await this.supabase
  .from('edital_file')
  .update({
    processing_result: resultado, // JSON completo
    json_url: publicPath, // Path público
    edital_status: 'ready', // ← Marca como pronto
    updated_at: new Date().toISOString()
  })
  .eq('id', editalFileId);

// Log: "✅ Edital_file updated: status=ready, json_url=/files/..."
```

### 3.6. Chamar Orchestrator 🔧 **NOVO**
```typescript
// Método: triggerOrchestrator()
await this.triggerOrchestrator(
  editalFileId, 
  userId, 
  resultado
);

// Log: "🤖 Triggering orchestrator for 3 concursos"
```

---

## 📍 ETAPA 4: Orchestrator - Criar Study Plans

**Local:** Node.js Microservices  
**Arquivo:** `src/agents/index.ts`  
**Função:** `createStudyPlan()`

### 4.1. Pre-Orchestrator: Identificar Concursos
```typescript
// Pre-orchestrator analisa JSON e identifica concursos
const concursos = editalJson.concursos;

// Para cada concurso, criar 1 study_plan
for (const concurso of concursos) {
  await this.createStudyPlanForConcurso(
    userId, 
    editalFileId, 
    concurso
  );
}

// Log: "📊 Pre-orchestrator: found 3 concursos"
```

### 4.2. Criar Study Plan
```typescript
// Para cada concurso identificado
const { data: studyPlan, error } = await supabase
  .from('study_plans')
  .insert({
    user_id: userId,
    edital_id: editalFileId, // ← Vincula ao edital_file
    exam_name: concurso.nome,
    exam_entity: concurso.orgao,
    target_role: concurso.cargo,
    education_level: concurso.nivel,
    total_vacancies: concurso.vagasTotal,
    status: 'draft', // ← Usuario precisa configurar resto
    created_at: new Date().toISOString()
  })
  .select()
  .single();

// Log: "✅ Study plan created: uuid-study-plan-id"
```

### 4.3. Criar Exams (Provas)
```typescript
// Exam principal (ex: Prova Objetiva)
const { data: exam } = await supabase
  .from('exams')
  .insert({
    plan_id: studyPlan.id,
    exam_name: 'Prova Objetiva',
    exam_type: 'objective',
    date: null, // Usuario configura depois
    weight: 1.0,
    created_at: new Date().toISOString()
  })
  .select()
  .single();

// Log: "✅ Exam created: Prova Objetiva"
```

### 4.4. Criar Disciplines
```typescript
// Para cada disciplina no JSON
for (const disc of concurso.disciplinas) {
  const { data: discipline } = await supabase
    .from('disciplines')
    .insert({
      plan_id: studyPlan.id,
      exam_id: exam.id,
      name: disc.nome,
      weight: 1.0, // Usuario ajusta depois
      status: 'active',
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  // Log: "✅ Discipline created: Língua Portuguesa"
}
```

### 4.5. Criar Topics
```typescript
// Para cada tópico dentro de cada disciplina
for (const topic of disc.topicos) {
  await supabase
    .from('topics')
    .insert({
      plan_id: studyPlan.id,
      discipline_id: discipline.id,
      name: topic,
      status: 'active',
      created_at: new Date().toISOString()
    });
  
  // Log: "✅ Topic created: Interpretação de textos"
}
```

### 4.6. Atualizar Study Plan Status
```typescript
// Marcar study_plan como pronto para configuração
await supabase
  .from('study_plans')
  .update({ 
    status: 'ready', // ← Pronto para usuario configurar
    updated_at: new Date().toISOString()
  })
  .eq('id', studyPlan.id);

// Log: "✅ Study plan ready for user configuration"
```

**Resultado no banco:**
```
study_plans (3 registros)
  ├── exams (3 registros - 1 por study_plan)
  ├── disciplines (30 registros - 10 por study_plan)
  └── topics (150 registros - 5 por disciplina)
```

---

## 📍 ETAPA 5: Frontend - Polling e Configuração

**Local:** React Frontend

### 5.1. Frontend Faz Polling do Status
```typescript
// Após receber editalFileId da edge function
const checkStatus = async () => {
  const { data: editalFile } = await supabase
    .from('edital_file')
    .select('edital_status, json_url')
    .eq('id', editalFileId)
    .single();
  
  if (editalFile.edital_status === 'ready') {
    // Buscar study_plans criados
    await fetchStudyPlans();
  }
};

// Polling a cada 5 segundos
const interval = setInterval(checkStatus, 5000);

// Log: "🔄 Polling edital_file status..."
```

### 5.2. Buscar Study Plans Criados
```typescript
// Quando edital_status = 'ready'
const { data: studyPlans } = await supabase
  .from('study_plans')
  .select(`
    id,
    exam_name,
    exam_entity,
    target_role,
    education_level,
    total_vacancies,
    status,
    disciplines (
      id,
      name,
      topics (
        id,
        name
      )
    )
  `)
  .eq('edital_id', editalFileId)
  .eq('status', 'ready');

// Log: "✅ Found 3 study plans ready for configuration"
```

### 5.3. Mostrar Lista de Concursos
```tsx
// UI mostra cards com concursos extraídos
<ConcursosList>
  {studyPlans.map(plan => (
    <ConcursoCard 
      key={plan.id}
      name={plan.exam_name}
      entity={plan.exam_entity}
      role={plan.target_role}
      disciplines={plan.disciplines.length}
      topics={plan.disciplines.reduce((sum, d) => sum + d.topics.length, 0)}
      onSelect={() => navigateToConfig(plan.id)}
    />
  ))}
</ConcursosList>

// Usuario vê:
// - Concurso TRE-SP 2024 (10 disciplinas, 50 tópicos)
// - Concurso TRE-RJ 2024 (12 disciplinas, 60 tópicos)
```

### 5.4. Usuario Escolhe Concurso e Configura
```typescript
// Usuario clica em 1 concurso
const navigateToConfig = (studyPlanId) => {
  router.push(`/config-study-plan/${studyPlanId}`);
};

// Página de configuração:
// - Data da prova
// - Horas disponíveis por dia
// - Dias de estudo (segunda a sexta, etc)
// - Prioridades de disciplinas
// - Preferências de turnos
```

### 5.5. Salvar Configurações e Gerar Cronograma
```typescript
// Usuario clica em "Gerar Cronograma"
const { data: updatedPlan } = await supabase
  .from('study_plans')
  .update({
    exam_date: '2024-05-15',
    daily_study_hours: 4,
    study_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    status: 'active', // ← Cronograma ativo
    updated_at: new Date().toISOString()
  })
  .eq('id', studyPlanId)
  .select()
  .single();

// Backend gera ciclos de estudo automaticamente
// Usuario é redirecionado para dashboard do cronograma

// Log: "✅ Study plan configured and activated"
```

---

## 🔄 Fluxo Completo Consolidado

```
┌──────────────────────────────────────────────────────────────┐
│ 1. FRONTEND (React)                                          │
│    Usuario seleciona PDF → Click Upload                      │
└─────────────────┬────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. EDGE FUNCTION (Supabase)                                  │
│    2.1. Upload PDF → bucket 'editals'                        │
│    2.2. INSERT edital_file (status: 'processing')            │
│    2.3. POST PDF → Transcription Service (externo)           │
│    2.4. Download TXT → bucket 'editals'                      │
│    2.5. UPDATE edital_file.transcription_url                 │
│    2.6. POST /api/edital-process                             │
└─────────────────┬────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. BACKEND NODE.JS (Microservices)                           │
│    3.1. Validar request (schedule_plan_id → edital_file_id)  │
│    3.2. Fetch TXT da URL                                     │
│    3.3. Claude: Extrair estrutura (estratégia adaptativa)    │
│    3.4. Salvar JSON → /public/files/{user}/{edital}/{uuid}   │
│    3.5. UPDATE edital_file (json_url, status: 'ready')       │
│    3.6. Trigger orchestrator                                 │
└─────────────────┬────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. ORCHESTRATOR (Node.js Agents)                             │
│    4.1. Pre-orchestrator: Identificar N concursos            │
│    4.2. Para cada concurso:                                  │
│         - INSERT study_plan (edital_id, status: 'draft')     │
│         - INSERT exam (Prova Objetiva)                       │
│         - INSERT disciplines (10-15)                         │
│         - INSERT topics (50-100)                             │
│    4.3. UPDATE study_plan (status: 'ready')                  │
└─────────────────┬────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. FRONTEND (React) - Polling                                │
│    5.1. Intervalo 5s: Check edital_file.status               │
│    5.2. Se 'ready': SELECT study_plans WHERE edital_id       │
│    5.3. Mostrar cards de concursos (disciplinas, tópicos)    │
│    5.4. Usuario clica em 1 concurso                          │
│    5.5. Página de configuração (datas, horas, dias)          │
│    5.6. UPDATE study_plan (status: 'active')                 │
│    5.7. Backend gera ciclos → Dashboard cronograma           │
└──────────────────────────────────────────────────────────────┘
```

---

## ⏱️ Timeline Esperado

| Etapa | Duração | Status Banco |
|-------|---------|--------------|
| 1. Frontend upload | 0-2s | - |
| 2. Edge function | 5-15s | edital_file: 'processing' |
| 3. Backend Claude | 10-30s | edital_file: 'processing' |
| 4. Orchestrator | 2-5s | study_plans: 'ready' |
| 5. Frontend polling | Contínuo | edital_file: 'ready' |
| **TOTAL** | **17-52s** | **Usuario escolhe concurso** |

---

## 🚨 Estados do edital_file

```typescript
type EditalStatus = 
  | 'processing'  // Edge function está processando
  | 'ready'       // Backend terminou, orchestrator criou study_plans
  | 'error';      // Algo falhou (transcrição ou extração)
```

**Consulta útil:**
```sql
SELECT 
  id,
  file_name,
  edital_status,
  transcription_url IS NOT NULL as tem_txt,
  json_url IS NOT NULL as tem_json,
  processing_result IS NOT NULL as tem_resultado,
  (SELECT COUNT(*) FROM study_plans WHERE edital_id = edital_file.id) as num_study_plans
FROM edital_file
WHERE user_id = 'user-uuid'
ORDER BY created_at DESC;
```

---

## ✅ Validação Final (Via MCP)

```typescript
// Após 1 upload completo, validar via MCP:
mcp_supabase_execute_sql({
  query: `
    SELECT 
      ef.id,
      ef.file_name,
      ef.edital_status,
      COUNT(DISTINCT sp.id) as study_plans_count,
      COUNT(DISTINCT d.id) as disciplines_count,
      COUNT(DISTINCT t.id) as topics_count
    FROM edital_file ef
    LEFT JOIN study_plans sp ON sp.edital_id = ef.id
    LEFT JOIN disciplines d ON d.plan_id = sp.id
    LEFT JOIN topics t ON t.plan_id = sp.id
    WHERE ef.user_id = 'user-uuid'
    GROUP BY ef.id
    ORDER BY ef.created_at DESC
    LIMIT 1;
  `
});
```

**Esperado:**
```json
{
  "id": "edital-uuid",
  "file_name": "edital-tre-sp.pdf",
  "edital_status": "ready",
  "study_plans_count": 3,
  "disciplines_count": 30,
  "topics_count": 150
}
```

---

**FIM DO DOCUMENTO**
