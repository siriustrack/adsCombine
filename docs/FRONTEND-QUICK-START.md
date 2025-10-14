# 📦 Resumo - Integração Frontend com API de Editais

## 🎯 Informações Essenciais

### **Endpoint:**
```
POST http://localhost:3000/api/edital-process
```

### **Request Body:**
```typescript
{
  "user_id": "uuid-do-usuario",           // UUID v4
  "schedule_plan_id": "uuid-do-plano",    // UUID v4
  "url": "http://url-do-arquivo.txt"     // URL do texto transcrito
}
```

### **Response:**
```typescript
{
  "filePath": "/files/user-id/plan-id/random.json",  // Caminho do arquivo
  "status": "processing",                            // Status inicial
  "jobId": "uuid-do-job"                            // ID para tracking
}
```

---

## 📚 Arquivos Criados para Frontend

### **1. FRONTEND-API-GUIDE.md**
📄 Documentação completa com:
- Especificação do endpoint
- Exemplos de requisição (cURL, Fetch, Axios)
- Schema de request/response
- Fluxo completo de processamento
- Sistema de polling
- Estados do arquivo JSON
- Tratamento de erros
- Timeouts e performance

### **2. FRONTEND-EDITAL-CLIENT.ts**
🔧 SDK TypeScript pronto para uso com:
- Types e interfaces completas
- Classe `EditalProcessClient` com:
  - `startProcessing()` - Inicia processamento
  - `checkStatus()` - Verifica status
  - `waitForCompletion()` - Aguarda com polling
  - `processEdital()` - Método completo (start + wait)
- Errors customizados:
  - `EditalApiError`
  - `EditalTimeoutError`
  - `EditalValidationError`
- Factory function `createEditalClient()`
- 3 exemplos de uso completos

### **3. FRONTEND-REACT-COMPONENT.tsx**
⚛️ Componente React completo com:
- Gerenciamento de estado (idle → uploading → processing → completed)
- Barra de progresso visual
- Callbacks de progresso
- Tratamento de erros
- UI completa com CSS inline
- Sub-componentes:
  - `StatusIcon` - Ícones por status
  - `ResultsSummary` - Exibe resultados
- Exemplo de uso no App

---

## 🚀 Quick Start para Frontend

### **Opção 1: Usar o SDK (Recomendado)**

```typescript
// 1. Copiar o arquivo FRONTEND-EDITAL-CLIENT.ts para seu projeto

// 2. Importar e usar:
import { createEditalClient } from './edital-client';

const client = createEditalClient('http://localhost:3000', 'auth-token');

const result = await client.processEdital({
  user_id: userId,
  schedule_plan_id: planId,
  url: transcriptionUrl,
});

console.log('Concursos processados:', result.concursos);
```

### **Opção 2: Usar o Componente React**

```typescript
// 1. Copiar FRONTEND-EDITAL-CLIENT.ts e FRONTEND-REACT-COMPONENT.tsx

// 2. Usar o componente:
import { EditalUpload } from './EditalUpload';

function App() {
  return (
    <EditalUpload
      userId={userId}
      schedulePlanId={planId}
      apiBaseUrl="http://localhost:3000"
      authToken={token}
      onComplete={(data) => console.log('Sucesso!', data)}
      onError={(error) => console.error('Erro:', error)}
    />
  );
}
```

### **Opção 3: Implementação Manual**

```typescript
// Requisição simples com Fetch
const response = await fetch('http://localhost:3000/api/edital-process', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    user_id: userId,
    schedule_plan_id: planId,
    url: transcriptionUrl,
  }),
});

const { filePath, jobId } = await response.json();

// Polling para verificar conclusão
while (true) {
  const statusResponse = await fetch(`http://localhost:3000${filePath}`);
  const data = await statusResponse.json();
  
  if (data.status === 'processing') {
    await sleep(5000); // Aguarda 5 segundos
    continue;
  }
  
  if (data.status === 'error') {
    throw new Error(data.error);
  }
  
  // Sucesso!
  console.log('Dados:', data.concursos);
  break;
}
```

---

## 📊 Fluxo Completo

```
┌─────────────────┐
│   FRONTEND      │
│  (Upload File)  │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Transcription   │
│    Service      │ ← Upload do PDF/vídeo
└────────┬────────┘
         │
         ↓ URL do texto transcrito
┌─────────────────┐
│  POST /api/     │
│ edital-process  │ ← { user_id, schedule_plan_id, url }
└────────┬────────┘
         │
         ↓ Response imediata
    { filePath, jobId, status: 'processing' }
         │
         ↓
┌─────────────────┐
│   BACKEND       │
│  (Background)   │ ← Processa com Claude Sonnet 4.5
│                 │   (~45s-240s)
└────────┬────────┘
         │
         ↓ Atualiza arquivo JSON
┌─────────────────┐
│   FRONTEND      │
│   (Polling)     │ ← GET /files/user-id/plan-id/file.json
│                 │   (a cada 5 segundos)
└────────┬────────┘
         │
         ↓ Arquivo atualizado
    { concursos: [...] }
         │
         ↓
┌─────────────────┐
│   FRONTEND      │
│ (Show Results)  │ ← Exibe dados processados
└─────────────────┘
```

---

## ⏱️ Performance Esperada

| Tamanho | Tempo de Processamento | Status |
|---------|------------------------|--------|
| Pequeno (< 10 pág) | 45s - 90s | ✅ Normal |
| Médio (10-30 pág) | 60s - 120s | ✅ Normal |
| Grande (> 30 pág) | 90s - 240s | ✅ Normal |

**Timeout recomendado:** 5 minutos (300s)

---

## 🔒 Autenticação

Todas as requisições devem incluir:

```typescript
headers: {
  'Authorization': `Bearer ${YOUR_AUTH_TOKEN}`,
}
```

---

## 📋 Checklist de Implementação

- [ ] **1. Copiar arquivos de referência**
  - [ ] `FRONTEND-EDITAL-CLIENT.ts`
  - [ ] `FRONTEND-REACT-COMPONENT.tsx` (se usar React)

- [ ] **2. Configurar URL base**
  - [ ] Desenvolvimento: `http://localhost:3000`
  - [ ] Produção: `https://sua-api.com`

- [ ] **3. Implementar upload para transcrição**
  - [ ] Endpoint de upload
  - [ ] Retorno da URL do texto

- [ ] **4. Implementar chamada para `/api/edital-process`**
  - [ ] Request body com `user_id`, `schedule_plan_id`, `url`
  - [ ] Headers com Authorization

- [ ] **5. Implementar sistema de polling**
  - [ ] Polling a cada 5 segundos
  - [ ] Máximo 60 tentativas (5 minutos)
  - [ ] Verificar status: `processing` | `error` | `completed`

- [ ] **6. Implementar UI**
  - [ ] Botão de upload
  - [ ] Barra de progresso
  - [ ] Mensagens de status
  - [ ] Exibição de resultados
  - [ ] Tratamento de erros

- [ ] **7. Testes**
  - [ ] Testar com edital pequeno
  - [ ] Testar com edital médio
  - [ ] Testar com edital grande
  - [ ] Testar tratamento de erros
  - [ ] Testar timeout

---

## 🐛 Erros Comuns e Soluções

### **Erro 400: Invalid request body**
❌ **Causa:** `user_id` ou `schedule_plan_id` não são UUIDs válidos
✅ **Solução:** Validar UUIDs antes de enviar

### **Erro 500: Internal server error**
❌ **Causa:** Erro no backend (Claude API, download de arquivo, etc.)
✅ **Solução:** Verificar logs do backend, tentar novamente

### **Timeout no polling**
❌ **Causa:** Edital muito grande ou Claude demorou muito
✅ **Solução:** Aumentar `maxAttempts` ou tentar com edital menor

### **CORS Error**
❌ **Causa:** Backend não configurado para aceitar requisições do frontend
✅ **Solução:** Configurar CORS no backend

---

## 📞 Suporte

- **Documentação Completa:** `docs/FRONTEND-API-GUIDE.md`
- **SDK TypeScript:** `docs/FRONTEND-EDITAL-CLIENT.ts`
- **Componente React:** `docs/FRONTEND-REACT-COMPONENT.tsx`
- **Script de Teste:** `test/test-edital-process.sh`

---

## 🎯 Exemplo Mínimo (Copy-Paste)

```typescript
// Função completa pronta para uso
async function processarEdital(
  userId: string,
  planId: string,
  fileUrl: string
) {
  // 1. Iniciar processamento
  const res = await fetch('http://localhost:3000/api/edital-process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer TOKEN',
    },
    body: JSON.stringify({
      user_id: userId,
      schedule_plan_id: planId,
      url: fileUrl,
    }),
  });

  const { filePath } = await res.json();

  // 2. Polling até conclusão
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000)); // Aguarda 5s
    
    const statusRes = await fetch(`http://localhost:3000${filePath}`);
    const data = await statusRes.json();
    
    if (data.status !== 'processing') {
      return data; // Retorna dados processados
    }
  }

  throw new Error('Timeout');
}

// USO:
const resultado = await processarEdital(
  '98d8b11a-8a32-4f6b-9dae-6e42efa23116',
  'bca596cc-d484-4df1-8cf2-e9a5ca637eac',
  'http://example.com/edital.txt'
);

console.log(resultado.concursos); // Array de concursos processados
```

---

**✅ Tudo pronto para integração!**
