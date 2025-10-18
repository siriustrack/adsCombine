# 📚 Documentação: Fluxo Edital Process

> **Status:** Consolidado - 18 de outubro de 2025  
> **Pipeline:** Frontend → Edge Functions → Backend Node.js → Orchestrator → Supabase

---

## 🎯 Documentos Principais

### 1. **FLUXO-COMPLETO-EDITAL.md** 📊
**Descrição:** Fluxo end-to-end completo do upload de edital até criação de study_plans

**Conteúdo:**
- Etapa 1: Frontend - Upload do PDF
- Etapa 2: Edge Function - Upload e Transcrição
- Etapa 3: Backend - Processar TXT e Extrair Dados
- Etapa 4: Orchestrator - Criar Study Plans
- Etapa 5: Frontend - Polling e Configuração
- Diagrama consolidado
- Timeline esperado (17-52s)
- Estados do `edital_file`
- Validação via MCP

**Quando usar:**
- ✅ Entender o pipeline completo
- ✅ Debugar onde pipeline quebrou
- ✅ Onboarding de novos devs
- ✅ Documentar para cliente/stakeholders

---

### 2. **IMPLEMENTACAO-BACKEND-FINAL.md** 🔧
**Descrição:** Plano de implementação das correções no backend Node.js (1-2h)

**Conteúdo:**
- Situação atual (o que funciona / o que está quebrado)
- Fluxo correto esperado
- Problema 1: Nome do parâmetro errado (`schedule_plan_id` → `edital_file_id`)
- Problema 2: Backend não atualiza banco nem chama orchestrator
- 6 passos de implementação (código completo)
  - Passo 1: Controller - Aceitar ambos parâmetros
  - Passo 2: Service Interface
  - Passo 3: Service - Cliente Supabase
  - Passo 4: Service - execute()
  - Passo 5: Service - processInBackground()
  - Passo 6: Service - triggerOrchestrator()
- Checklist de implementação
- Validação via MCP após deploy
- Estimativa: 75min código + 45min testes = 2h

**Quando usar:**
- ✅ Implementar correções no backend
- ✅ Revisar código antes de commit
- ✅ Testar após deploy
- ✅ Validar via MCP que tudo funcionou

---

## 🔍 Problema Identificado

### Resumo Executivo:
1. ✅ **Edge function (frontend) JÁ funciona** - Cria `edital_file`, faz transcrição PDF→TXT
2. ❌ **Edge function usa nome errado** - Envia `schedule_plan_id` (deveria ser `edital_file_id`)
3. ❌ **Backend não atualiza banco** - Processa TXT, salva JSON, mas não atualiza `edital_file`
4. ❌ **Backend não chama orchestrator** - `study_plans` nunca são criados

### Impacto:
- JSON extraído fica "órfão" no filesystem
- Usuario não vê concursos no frontend
- Orchestrator nunca cria study_plans, disciplines, topics

### Solução:
**Apenas backend precisa mudança** (1-2h):
- Aceitar `schedule_plan_id` E `edital_file_id` (compatibilidade)
- Atualizar `edital_file` após processar (processing_result, json_url, status: 'ready')
- Chamar orchestrator → criar study_plans

---

## 📂 Arquivos do Código

### Backend (Node.js):
```
src/api/controllers/editais.controllers.ts
  ↳ Validação do request (Zod schema)
  ↳ MUDANÇA: aceitar schedule_plan_id OU edital_file_id

src/core/services/editais/edital-process.service.ts
  ↳ Processamento com Claude
  ↳ MUDANÇA: adicionar cliente Supabase
  ↳ MUDANÇA: atualizar edital_file após processar
  ↳ MUDANÇA: chamar triggerOrchestrator()

src/agents/index.ts
  ↳ Orchestrator principal (createStudyPlan)
  ↳ JÁ FUNCIONA - apenas precisa ser chamado
```

### Frontend (Edge Functions - outro repo):
```
supabase/functions/upload-and-process/index.ts
  ↳ Upload PDF, transcrição, criação edital_file
  ↳ JÁ FUNCIONA - não mexemos aqui
```

---

## 🧪 Como Testar

### 1. Teste Local (Development):
```bash
# 1. Implementar mudanças no backend (seguir IMPLEMENTACAO-BACKEND-FINAL.md)
# 2. Rodar backend local
npm run dev

# 3. Upload 1 PDF via frontend
# 4. Monitorar logs backend:
tail -f logs/combined.log | grep EDITAL

# 5. Validar via MCP após 30-60s:
mcp_supabase_execute_sql({
  query: "SELECT * FROM edital_file ORDER BY created_at DESC LIMIT 1"
})
```

### 2. Validação Completa:
```typescript
// Query via MCP para verificar pipeline completo:
SELECT 
  ef.id as edital_file_id,
  ef.file_name,
  ef.edital_status,
  ef.transcription_url IS NOT NULL as tem_txt,
  ef.json_url IS NOT NULL as tem_json,
  COUNT(DISTINCT sp.id) as num_study_plans,
  COUNT(DISTINCT d.id) as num_disciplines,
  COUNT(DISTINCT t.id) as num_topics
FROM edital_file ef
LEFT JOIN study_plans sp ON sp.edital_id = ef.id
LEFT JOIN disciplines d ON d.plan_id = sp.id
LEFT JOIN topics t ON t.plan_id = sp.id
WHERE ef.created_at > NOW() - INTERVAL '1 hour'
GROUP BY ef.id
ORDER BY ef.created_at DESC;
```

**Esperado:**
- `edital_status` = 'ready'
- `tem_txt` = true
- `tem_json` = true
- `num_study_plans` ≥ 1
- `num_disciplines` ≥ 10
- `num_topics` ≥ 50

---

## ⏱️ Cronograma de Implementação

| Passo | Tempo | Descrição |
|-------|-------|-----------|
| 1. Controller | 5min | Aceitar ambos parâmetros |
| 2. Service interface | 5min | Renomear para edital_file_id |
| 3. Supabase client | 5min | Adicionar no constructor |
| 4. execute() | 10min | Renomear variáveis |
| 5. processInBackground() | 30min | Atualizar banco |
| 6. triggerOrchestrator() | 20min | Novo método |
| **Subtotal código** | **75min** | |
| Teste E2E | 30min | Upload PDF real |
| Validação MCP | 15min | Queries de verificação |
| **TOTAL** | **2h** | |

---

## 🚀 Deploy

```bash
# 1. Branch
git checkout -b fix/edital-process-orchestrator-integration

# 2. Implementar (seguir IMPLEMENTACAO-BACKEND-FINAL.md)

# 3. Commit
git add .
git commit -m "fix: accept schedule_plan_id from edge function and integrate orchestrator

- Controller: accept both schedule_plan_id and edital_file_id
- Service: update edital_file after Claude processing
- Service: trigger orchestrator to create study_plans
- Service: link study_plans.edital_id to edital_file.id"

# 4. Push
git push origin fix/edital-process-orchestrator-integration

# 5. Deploy (Railway/Vercel/Docker)
```

---

## 📞 Suporte

### Documentos Removidos (Consolidados):
- ❌ ANALISE-CRITICA-FLUXO-REAL.md
- ❌ PLANO-ACAO-CORRECAO-EDITAL-PROCESS.md
- ❌ RESUMO-EXECUTIVO-VALIDACAO-FLUXO.md
- ❌ DIAGRAMAS-FLUXO-EDITAL.md
- ❌ DESCOBERTAS-VALIDACAO-EDITAL.md
- ❌ INDICE-ANALISE-EDITAL-PROCESS.md
- ❌ FLUXO-REAL-CORRETO.md
- ❌ IMPLEMENTACAO-RAPIDA-1-2H.md
- ❌ VALIDACAO-COMPLETA-MCP.md

**Motivo:** Tudo foi consolidado em 2 documentos principais (acima)

---

## 📚 Leitura Recomendada

1. **Primeiro:** Leia `FLUXO-COMPLETO-EDITAL.md` para entender pipeline
2. **Depois:** Leia `IMPLEMENTACAO-BACKEND-FINAL.md` para implementar
3. **Durante:** Use este README como referência rápida

---

**Última atualização:** 18 de outubro de 2025  
**Autor:** GitHub Copilot  
**Status:** ✅ Documentação consolidada e pronta para uso
