# 📚 Documentação - adsCombine (Escola da Aprovação)

> **Última atualização:** 18 de outubro de 2025  
> **Estrutura:** 2 níveis organizacionais

---

## 📂 Estrutura de Pastas

```
docs/
├── 📁 edital-process/          # Pipeline completo de processamento de editais
├── 📁 agents/                  # Orchestrator e sub-agents (IA)
├── 📁 frontend/                # Documentação e código frontend
├── 📁 api-reference/           # Referência de APIs
├── 📁 database/                # Schema e estrutura do banco
├── 📁 debug-logs/              # Troubleshooting e análises de erros
├── 📁 phase-status/            # Status das fases do projeto
├── 📁 legacy/                  # Decisões antigas e migrações
│
└── 📄 Arquivos na raiz         # Checklists e utilitários gerais
```

---

## 🎯 1. Edital Process (`/edital-process`)

**Conteúdo:** Pipeline completo de upload → processamento → estudo

### Documentos Principais:
- **`README-EDITAL-PROCESS.md`** ⭐ - Comece aqui
- **`FLUXO-COMPLETO-EDITAL.md`** - Pipeline end-to-end
- **`IMPLEMENTACAO-BACKEND-FINAL.md`** - Correções backend (2h)
- **`INDICE-EDITAL-DOCS.md`** - Índice navegável

### Outros:
- `AI-ORCHESTRATOR-EDITAL-TO-DB.md` - Orchestrator original
- `AJUSTES-ROTA-EDITAL-PROCESS.md` - Ajustes históricos
- `E2E-EDITAL-PROCESS-GUIDE.md` - Testes E2E
- `EDITAL-PROCESS-API.md` - Spec da API
- `EDITAL-PROCESS-LOGS.md` - Estrutura de logs
- `IMPLEMENTACAO-ESTRATEGIA-ADAPTATIVA.md` - Estratégia Claude
- `ESTRUTURA-EDITAIS.md` - Estrutura de dados

**Quando usar:** Entender ou modificar pipeline de editais

---

## 🤖 2. Agents (`/agents`)

**Conteúdo:** Orchestrator e sub-agents que processam editais

### Documentação:
- `agents-readme.md` - README dos agents
- `AGENTS-IA-SOLUTION.md` - Solução IA completa
- `agent-pre-orchestra.md` - Pre-orchestrator

### Agents Individuais:
- `12-orquestrador-agent.md` - Orchestrator principal
- `13-study-plan-agent.md` - Study Plan agent
- `14-exams-agent.md` - Exams agent
- `15-disciplines-agent.md` - Disciplines agent
- `16-topics-agent.md` - Topics agent
- `20-pre-orchestrator-como-transformador.md` - Pre-orchestrator transformador

### Análises:
- `17-analise-compatibilidade-json-database.md`
- `18-analise-agentes-json-database.md`
- `19-comparacao-visual-json-agentes-database.md`
- `ANALISE-COMPATIBILIDADE-SUMMARY.md`

**Quando usar:** Entender ou modificar lógica dos agents IA

---

## 💻 3. Frontend (`/frontend`)

**Conteúdo:** Documentação e exemplos de integração frontend

### Documentos:
- `FRONTEND-QUICK-START.md` - Quick start
- `FRONTEND-API-GUIDE.md` - Guia de uso da API
- `FRONTEND-EDITAL-CLIENT.ts` - Cliente TypeScript
- `FRONTEND-REACT-COMPONENT.tsx` - Componente React exemplo

**Quando usar:** Integrar frontend com backend

---

## 📖 4. API Reference (`/api-reference`)

**Conteúdo:** Documentação de APIs

### Documentos:
- `API-USAGE-GUIDE.md` - Guia de uso geral

**Quando usar:** Consultar endpoints e contratos

---

## 🗄️ 5. Database (`/database`)

**Conteúdo:** Schema e estrutura do Supabase

### Documentos:
- `database_schema.md` - Schema completo do banco

**Quando usar:** Entender estrutura de tabelas

---

## 🔍 6. Debug Logs (`/debug-logs`)

**Conteúdo:** Troubleshooting, análises de erros, correções

### Documentos:
- `troubleshooting.md` - Guia de troubleshooting
- `DEBUG-DESCOBERTAS-REAIS.md` - Descobertas reais
- `DEBUG-PRODUCAO-EDITAL-PROCESS.md` - Debug produção
- `ENTENDIMENTO-COMPLETO-FALHAS.md` - Análise de falhas
- `ZOD-DEBUG-CORRECOES.md` - Correções Zod
- `ZOD-DEBUG-REPORT.md` - Report Zod
- `ANALISE-CRITICA-EXTRACAO.md` - Análise extração
- `ANALISE-CRITICA-PIPELINE.md` - Análise pipeline
- `ANALISE-RESULTADOS-FINAL.md` - Resultados finais

**Quando usar:** Debugar erros em produção

---

## 📊 7. Phase Status (`/phase-status`)

**Conteúdo:** Status e planejamento de fases do projeto

### Documentos:
- `PROGRESS-TRACKER.md` - Tracker de progresso
- `FASE-1-STATUS.md` - Status Fase 1
- `FASE-3-STATUS.md` - Status Fase 3
- `FASE-4-STATUS.md` - Status Fase 4
- `FASE-5-PLANEJAMENTO-E2E.md` - Planejamento E2E
- `FASE-5-DECISOES-E2E.md` - Decisões E2E

**Quando usar:** Acompanhar progresso do projeto

---

## 📦 8. Legacy (`/legacy`)

**Conteúdo:** Decisões antigas, migrações, testes históricos

### Decisões:
- `DECISAO-MIGRACAO-CLAUDE.md` - Migração Claude
- `DECISAO-SERVICE-ROLE.md` - Service role

### Migrações:
- `MIGRACAO-CLAUDE-RESULTADOS.md` - Resultados
- `MIGRACAO-CLAUDE-STATUS.md` - Status

### Testes Antigos:
- `TESTE-BLOCOS-FIX-SUCESSO.md`
- `TESTE-RESULTADO-SUCESSO.md`
- `TESTE-VALIDACAO-FINAL.md`
- `VALIDATION_REPORT.md`

### Correções:
- `CORRECAO-HEURISTICA.md`
- `CORRECOES-IMPLEMENTADAS.md`
- `PROMPT-UPDATE-BLOCOS-FIX.md`
- `RESUMO-EXECUTIVO-PROMPT-FIX.md`
- `RESUMO-EXECUTIVO-REVISAO.md`

### Soluções:
- `SOLUCAO-1-REFINADA.md`
- `SOLUCOES-JSON-GRANDE.md`
- `REPROCESS-FLOW-COMPARISON.md`

### Resumos:
- `RESUMO-DIA-2025-10-07.md`

**Quando usar:** Consultar decisões históricas

---

## 📄 Arquivos na Raiz

### Checklists:
- `CHECKLIST-PRE-TESTE-E2E.md` - Checklist pré-teste
- `PRE-DEPLOY-CHECKLIST.md` - Checklist pré-deploy
- `PRONTO-PARA-TESTE.md` - Checklist pronto
- `REFACTORING-CHECKLIST.md` - Checklist refactoring
- `checklist-implementation.md` - Checklist implementação

### Utilitários:
- `COMMIT-MESSAGE.md` - Padrão de commits
- `prompts.md` - Prompts IA
- `content-example.md` - Exemplo de conteúdo

---

## 🚀 Navegação Rápida

### Estou perdido, por onde começar?
👉 `/edital-process/README-EDITAL-PROCESS.md`

### Quero entender o pipeline completo?
👉 `/edital-process/FLUXO-COMPLETO-EDITAL.md`

### Preciso corrigir o backend?
👉 `/edital-process/IMPLEMENTACAO-BACKEND-FINAL.md`

### Como integrar o frontend?
👉 `/frontend/FRONTEND-QUICK-START.md`

### Erro em produção, como debugar?
👉 `/debug-logs/troubleshooting.md`

### Qual o schema do banco?
👉 `/database/database_schema.md`

### Como funcionam os agents IA?
👉 `/agents/agents-readme.md`

### Qual o progresso atual do projeto?
👉 `/phase-status/PROGRESS-TRACKER.md`

---

## 📋 Estrutura de 2 Níveis

```
docs/
├── README.md (você está aqui)
│
├── edital-process/
│   ├── README-EDITAL-PROCESS.md ⭐
│   ├── FLUXO-COMPLETO-EDITAL.md
│   ├── IMPLEMENTACAO-BACKEND-FINAL.md
│   ├── INDICE-EDITAL-DOCS.md
│   └── ... (9 arquivos)
│
├── agents/
│   ├── agents-readme.md
│   ├── 12-orquestrador-agent.md
│   └── ... (11 arquivos)
│
├── frontend/
│   ├── FRONTEND-QUICK-START.md
│   └── ... (4 arquivos)
│
├── api-reference/
│   └── API-USAGE-GUIDE.md
│
├── database/
│   └── database_schema.md
│
├── debug-logs/
│   ├── troubleshooting.md
│   └── ... (9 arquivos)
│
├── phase-status/
│   ├── PROGRESS-TRACKER.md
│   └── ... (6 arquivos)
│
├── legacy/
│   └── ... (16 arquivos)
│
└── (raiz)
    ├── CHECKLIST-PRE-TESTE-E2E.md
    ├── PRE-DEPLOY-CHECKLIST.md
    └── ... (8 arquivos)
```

---

**Total:** ~70 arquivos organizados em 8 categorias + raiz
