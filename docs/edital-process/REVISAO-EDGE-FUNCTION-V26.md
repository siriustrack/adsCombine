# 🎉 ANÁLISE ATUALIZADA: Edge Function Já Usa edital_file_id Correto!

> **Data:** 18 de outubro de 2025  
> **Versão Edge Function:** v26 (ACTIVE)  
> **Status:** ✅ **PARÂMETRO CORRETO - NÃO PRECISA MUDAR EDGE FUNCTION**

---

## 🔍 Descoberta Importante

**ATENÇÃO:** Após verificação via MCP Supabase, a edge function `upload-and-process` **JÁ USA O NOME CORRETO**!

### Linha 240 da Edge Function (v26):

```typescript
const processingPayload = {
  user_id: user.id,
  edital_file_id: editalFile?.id || crypto.randomUUID(), // ✅ CORRETO!
  url: txtPublicUrl
};
```

**Conclusão:** Edge function envia `edital_file_id` ✅ (não `schedule_plan_id` ❌)

---

## 📊 Comparação: Documentação Antiga vs Realidade

### ❌ Documentação Antiga Dizia:

```typescript
// ERRADO (documentação desatualizada):
const processingPayload = {
  user_id: user.id,
  schedule_plan_id: editalFile.id, // ❌ Nome errado
  url: txtPublicUrl
};
```

### ✅ Edge Function Real (v26) Usa:

```typescript
// CORRETO (código atual):
const processingPayload = {
  user_id: user.id,
  edital_file_id: editalFile?.id || crypto.randomUUID(), // ✅ Nome certo
  url: txtPublicUrl
};
```

---

## 🎯 Revisão Completa do Fluxo

### Etapa 1: Upload PDF (Frontend)
```typescript
// Frontend envia multipart/form-data com arquivo
const formData = new FormData();
formData.append('file', pdfFile);

fetch(`${SUPABASE_URL}/functions/v1/upload-and-process`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});
```

---

### Etapa 2: Edge Function Processa (Linhas 1-270)

#### 2.1. Upload PDF → Bucket (Linhas 140-155)
```typescript
// Linha 138-155
const fileName = `${user.id}/${crypto.randomUUID()}.${fileExt}`;
const { data: uploadData, error: uploadError } = await supabase.storage
  .from('editals')
  .upload(fileName, file, { cacheControl: '3600', upsert: false });

const { data: { publicUrl } } = supabase.storage
  .from('editals')
  .getPublicUrl(uploadData.path);
```

✅ **Status:** Funciona

---

#### 2.2. Criar edital_file (Linhas 165-195)
```typescript
// Linha 180-195
const { data: newFile, error: insertError } = await supabase
  .from('edital_file')
  .insert({
    user_id: user.id,
    edital_file_url: publicUrl,
    edital_bucket_path: uploadData.path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type,
    edital_status: 'processing' // ✅ Marca como 'processing'
  })
  .select('id')
  .single();

editalFile = newFile;
```

✅ **Status:** Funciona  
✅ **Cria registro com status:** `'processing'`

---

#### 2.3. Transcrição PDF → TXT (Linhas 197-225)
```typescript
// Linha 197-225
const transcriptionPayload = [{
  conversationId: editalFile?.id || crypto.randomUUID(),
  body: {
    userId: user.id,
    files: [{
      fileId: editalFile?.id || crypto.randomUUID(),
      url: publicUrl,
      mimeType: file.type
    }]
  }
}];

const transcriptionResponse = await fetch(
  `${apiUrl}/api/process-message`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transcriptionPayload)
  }
);

const transcriptionResult = await transcriptionResponse.json();
const txtUrl = transcriptionResult.downloadUrl;
```

✅ **Status:** Funciona  
✅ **Chama:** `https://ms.monalisaia.com.br/api/process-message`  
✅ **Retorna:** `downloadUrl` com TXT

---

#### 2.4. Salvar TXT no Bucket (Linhas 226-235)
```typescript
// Linha 226-235
const txtContent = await (await fetch(txtUrl)).text();

const txtFileName = `${user.id}/${crypto.randomUUID()}.txt`;
const { data: txtUploadData, error: txtUploadError } = await supabase.storage
  .from('editals')
  .upload(txtFileName, txtContent, {
    contentType: 'text/plain',
    cacheControl: '3600',
    upsert: false
  });

const { data: { publicUrl: txtPublicUrl } } = supabase.storage
  .from('editals')
  .getPublicUrl(txtUploadData.path);
```

✅ **Status:** Funciona  
✅ **TXT salvo em:** `editals/{user_id}/{uuid}.txt`

---

#### 2.5. Chamar Backend edital-process (Linhas 237-260) ⭐ **CRUCIAL**

```typescript
// Linha 237-245 ✅ NOME CORRETO!
const processingPayload = {
  user_id: user.id,
  edital_file_id: editalFile?.id || crypto.randomUUID(), // ✅ CORRETO
  url: txtPublicUrl
};

console.log('[Edge Function] Enviando para API de processamento:', 
  `${apiUrl}/api/edital-process`);

const processingResponse = await fetch(`${apiUrl}/api/edital-process`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...backendToken ? { 'Authorization': `Bearer ${backendToken}` } : {}
  },
  body: JSON.stringify(processingPayload)
});

const processingResult = await processingResponse.json();
```

✅ **Status:** Payload correto  
✅ **Envia:** `edital_file_id` (nome certo)  
✅ **Chama:** `https://ms.monalisaia.com.br/api/edital-process`

---

#### 2.6. Atualizar edital_file com Resultados (Linhas 263-275)

```typescript
// Linha 263-275
if (editalFile?.id) {
  const { error: updateError } = await supabase
    .from('edital_file')
    .update({
      processing_result: processingResult.edital || null,
      transcription_url: txtPublicUrl,
      json_url: processingResult.jsonUrl || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', editalFile.id);
}
```

⚠️ **PROBLEMA:** Edge function TENTA atualizar, mas:
- `processingResult.edital` só existe se backend retornar
- `processingResult.jsonUrl` só existe se backend retornar
- `edital_status` NÃO é atualizado para `'ready'`

**Dependência:** Backend precisa retornar esses campos

---

## 🔴 PROBLEMA REAL IDENTIFICADO

### Backend NÃO Aceita edital_file_id

**Arquivo:** `src/api/controllers/editais.controllers.ts:8`

```typescript
// ❌ PROBLEMA: Backend não aceita edital_file_id
const EditalProcessBodySchema = z.object({
  user_id: z.string().uuid(),
  schedule_plan_id: z.string().uuid(), // ❌ Edge function NÃO envia isso
  url: z.string().url(),
  // ...
});
```

**Edge function envia:**
```json
{
  "user_id": "uuid",
  "edital_file_id": "uuid", // ← Edge function envia esse
  "url": "https://...txt"
}
```

**Backend espera:**
```json
{
  "user_id": "uuid",
  "schedule_plan_id": "uuid", // ← Backend espera esse (ERRADO)
  "url": "https://...txt"
}
```

**Resultado:** Backend rejeita request com erro 400 "Invalid request body"

---

## ✅ SOLUÇÃO CORRIGIDA

### Apenas Backend Precisa Mudança

#### 1. Controller: Aceitar edital_file_id (5min)

```typescript
// src/api/controllers/editais.controllers.ts
const EditalProcessBodySchema = z.object({
  user_id: z.string().uuid(),
  edital_file_id: z.string().uuid(), // ✅ Aceitar nome correto
  url: z.string().url(),
  edital_bucket_path: z.string().min(1).optional(),
  file_name: z.string().optional(),
  file_size: z.number().int().positive().optional(),
  mime_type: z.string().optional(),
});
```

#### 2. Service: Renomear interface (5min)

```typescript
// src/core/services/editais/edital-process.service.ts
export interface EditalProcessRequest {
  user_id: string;
  edital_file_id: string; // ✅ Renomear
  url: string;
  // ...
}
```

#### 3. Service: Usar edital_file_id para diretórios (5min)

```typescript
// Linha ~88
const editalDir = path.join(userDir, edital_file_id); // ✅ Usar ID correto
const filePath = path.join(editalDir, fileName);
```

#### 4. Backend: Retornar campos esperados pela Edge Function (10min)

```typescript
// Em processInBackground, após salvar JSON:
return {
  edital: finalOutput, // ← Edge function espera isso
  jsonUrl: publicPath, // ← Edge function espera isso
};
```

#### 5. Service: Adicionar Supabase + Orchestrator (60min)

```typescript
// Constructor
this.supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

// Em processInBackground
await this.supabase
  .from('edital_file')
  .update({
    processing_result: finalOutput,
    json_url: publicPath,
    edital_status: 'ready', // ← Marca como pronto
    updated_at: new Date().toISOString()
  })
  .eq('id', editalFileId);

// Chamar orchestrator
await this.triggerOrchestrator(editalFileId, userId, finalOutput);
```

---

## 📋 Checklist de Mudanças

### Edge Function (Supabase):
- [x] ✅ Usa `edital_file_id` (v26) - **NÃO PRECISA MUDAR**
- [x] ✅ Cria `edital_file` com status `'processing'`
- [x] ✅ Transcreve PDF → TXT
- [x] ✅ Salva TXT no bucket
- [x] ✅ Chama `/api/edital-process` com payload correto
- [x] ✅ Tenta atualizar `edital_file` (mas depende do backend)

### Backend (Node.js): ❌ PRECISA MUDANÇAS
- [ ] ❌ Controller NÃO aceita `edital_file_id`
- [ ] ❌ Service usa `schedule_plan_id` (nome errado)
- [ ] ❌ Backend NÃO retorna `edital` e `jsonUrl`
- [ ] ❌ Backend NÃO atualiza `edital_status` para `'ready'`
- [ ] ❌ Backend NÃO chama orchestrator
- [ ] ❌ Study plans NÃO são criados

---

## ⏱️ Estimativa Atualizada

| Tarefa | Tempo | Motivo |
|--------|-------|--------|
| 1. Controller aceitar edital_file_id | 5min | Renomear campo Zod |
| 2. Service interface | 5min | Renomear variável |
| 3. Service usar ID correto | 5min | Ajustar path |
| 4. Backend retornar campos | 10min | Estrutura response |
| 5. Supabase + Orchestrator | 60min | Integração completa |
| **TOTAL CÓDIGO** | **85min** | |
| Teste E2E | 30min | Upload PDF real |
| Validação MCP | 15min | Queries verificação |
| **TOTAL** | **2h10min** | |

---

## 🎯 Conclusão Final

### ✅ Descobertas Positivas:
1. Edge function **JÁ USA edital_file_id** (v26)
2. Edge function **JÁ CRIA edital_file**
3. Edge function **JÁ TRANSCREVE PDF → TXT**
4. Edge function **JÁ SALVA TXT no bucket**
5. Edge function **JÁ CHAMA backend corretamente**

### ❌ Problema Real:
**Backend rejeita request porque espera `schedule_plan_id` em vez de `edital_file_id`**

### 🔧 Solução:
**Apenas backend precisa mudança** (~2h):
1. Aceitar `edital_file_id` no controller
2. Renomear variáveis no service
3. Retornar `edital` e `jsonUrl` para edge function
4. Atualizar `edital_status` → `'ready'`
5. Chamar orchestrator → criar study_plans

**Documentação:** `docs/edital-process/IMPLEMENTACAO-BACKEND-FINAL.md`

---

**FIM DA ANÁLISE ATUALIZADA**
