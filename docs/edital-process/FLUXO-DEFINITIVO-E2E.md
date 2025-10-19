# 🎯 FLUXO DEFINITIVO: EDITAL PROCESS END-TO-END

> **Documento Canônico** - Última atualização: 19 de Outubro de 2025  
> Este documento descreve o fluxo completo e definitivo do processamento de editais, desde o upload até a criação de planos de estudo no banco de dados.

---

## 📋 ÍNDICE

1. [Visão Geral](#visão-geral)
2. [Arquitetura do Sistema](#arquitetura-do-sistema)
3. [Fluxo Completo Passo a Passo](#fluxo-completo-passo-a-passo)
4. [Estrutura de Dados](#estrutura-de-dados)
5. [Dependências e Integrações](#dependências-e-integrações)
6. [Verificação e Validação](#verificação-e-validação)

---

## 🎨 VISÃO GERAL

### Objetivo
Processar editais de concursos públicos (PDF → TXT → JSON estruturado) e criar automaticamente planos de estudo completos com disciplinas, tópicos e cronogramas.

### Tecnologias
- **Backend**: Node.js + TypeScript + Express
- **IA**: Claude Sonnet 3.5 (claude-sonnet-4-5-20250929)
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage (bucket `editals`)
- **Validação**: Zod schemas

### Tempo de Processamento
- **Texto curto** (< 50K chars): 1-2 minutos
- **Texto médio** (50-100K chars): 3-4 minutos
- **Texto longo** (100-200K chars): 5-8 minutos

---

## 🏗️ ARQUITETURA DO SISTEMA

```
┌─────────────────────────────────────────────────────────────────┐
│                      EDGE FUNCTION v26                          │
│  (Upload PDF → Transcrição → Cria edital_file)                 │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ POST /api/edital-process
                  │ { user_id, edital_file_id, url }
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND: CONTROLLER                           │
│  ✅ Valida apenas edital_file_id (sem compatibilidade legada)   │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                 BACKEND: SERVICE (BACKGROUND)                    │
│  1. Download TXT do Supabase Storage                            │
│  2. Processamento com Claude (5-8min)                           │
│  3. Extração estruturada (JSON)                                 │
│  4. Validação Zod                                               │
│  5. Upload JSON → Supabase Storage                              │
│  6. UPDATE edital_file (processing_result, json_url)            │
│  7. Trigger Orchestrator                                        │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ JSON estruturado (EditalProcessado)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PRE-ORCHESTRATOR                              │
│  ✅ Detecta JSON estruturado (não reprocessa texto)             │
│  ✅ Converte EditalProcessado → StudyPlanData[]                 │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ StudyPlanData[]
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                                │
│  1. Cria study_plans (1 registro)                              │
│  2. Cria disciplines (N registros)                              │
│  3. Cria topics (M registros)                                   │
│  4. Cria exams (fases)                                          │
│  5. UPDATE study_plans.edital_id = edital_file_id              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📍 FLUXO COMPLETO PASSO A PASSO

### **FASE 1: REQUISIÇÃO HTTP**

#### Endpoint
```
POST http://localhost:3000/api/edital-process
```

#### Headers
```http
Content-Type: application/json
Authorization: Bearer {TOKEN}
```

#### Body
```json
{
  "user_id": "uuid",
  "edital_file_id": "uuid",
  "url": "https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/{path}.txt"
}
```

#### Validação (Controller)
- **Arquivo**: `src/api/controllers/editais.controllers.ts`
- **Schema**: `EditalProcessBodySchema`
- **Campos obrigatórios**:
  - `user_id` (UUID)
  - `edital_file_id` (UUID - referência ao registro em `edital_file`)
  - `url` (URL válida do arquivo TXT)

#### Resposta Imediata
```json
{
  "filePath": "texts/{edital_file_id}/{job_id}.json",
  "status": "processing",
  "jobId": "uuid-v4",
  "estimation": {
    "totalCharacters": 143912,
    "estimatedTimeMinutes": 6
  }
}
```

---

### **FASE 2: PROCESSAMENTO EM BACKGROUND**

#### Arquivo
`src/core/services/editais/edital-process.service.ts`

#### Método
`processInBackground()`

#### Etapas

##### **2.1. Download do Conteúdo TXT**
```typescript
const response = await axios.get(url);
const content = response.data;
// Exemplo: 143.912 caracteres em ~5.5 segundos
```

##### **2.2. Processamento com Claude**
- **Model**: `claude-sonnet-4-5-20250929`
- **Context Window**: 200.000 tokens
- **Max Tokens**: 64.000 tokens
- **Estratégia**: Adaptive
  - **Tentativa 1**: Full extraction (single call)
  - **Fallback**: Hierarchical chunking (3 passes)

**Passes (se necessário)**:
- **Pass 1**: Extrai estrutura (metadata + lista de disciplinas)
- **Pass 2**: Extrai detalhes por disciplina (paralelo, full text)
- **Pass 3**: Merge programático (sem IA)

##### **2.3. Extração Estruturada**
```typescript
interface EditalProcessado {
  concursos: Concurso[];
  validacao: Validacao;
  metadataProcessamento: MetadataProcessamento;
}
```

**Exemplo de resultado**:
- 1 concurso
- 15 disciplinas
- 347 matérias/tópicos
- Tempo: ~340 segundos (5min 43s)

##### **2.4. Validação com Zod**
```typescript
const validation = validateEditalIntegrity(processedData);
if (!validation.isValid) {
  // Adiciona warnings/erros na validação
  processedData.validacao.erros.push(...validation.errors);
}
```

##### **2.5. Salvamento Local**
```typescript
const outputPath = `public/texts/${edital_file_id}/${job_id}.json`;
fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2), 'utf8');
```

##### **2.6. Upload para Supabase Storage**
```typescript
const jsonFileName = `${user_id}/${job_id}.json`;
const jsonBuffer = Buffer.from(JSON.stringify(finalOutput, null, 2), 'utf8');

await supabase.storage
  .from('editals')
  .upload(jsonFileName, jsonBuffer, {
    contentType: 'application/json',
    upsert: true,
  });

const jsonPublicUrl = `${SUPABASE_URL}/storage/v1/object/public/editals/${jsonFileName}`;
```

##### **2.7. Atualização do Banco de Dados**
```typescript
await supabase
  .from('edital_file')
  .update({ 
    processing_result: finalOutput,  // JSONB completo
    json_url: jsonPublicUrl,         // URL pública
    edital_status: 'ready'           // Status atualizado
  })
  .eq('id', edital_file_id);
```

---

### **FASE 3: TRIGGER DO ORCHESTRATOR**

#### Arquivo
`src/core/services/editais/edital-process.service.ts`

#### Método
`triggerOrchestrator(userId, editalData, editalFileId)`

#### Implementação
```typescript
const { createStudyPlan } = await import('../../../agents/index');

// ✅ Passa JSON estruturado (NÃO reprocessa texto)
const result = await createStudyPlan({
  userId,
  content: editalData  // EditalProcessado object
});

if (result.success && result.data) {
  // Vincula study_plan ao edital_file
  await supabase
    .from('study_plans')
    .update({ edital_id: editalFileId })
    .eq('id', result.data);
}
```

**⚠️ IMPORTANTE**: 
- NÃO busca `txt_url` no banco (coluna não existe)
- NÃO baixa TXT novamente
- NÃO reprocessa o texto (desperdiçaria 5-8min de trabalho)
- Passa JSON já processado diretamente

---

### **FASE 4: PRE-ORCHESTRATOR**

#### Arquivo
`src/agents/sub-agents/pre-orchestrator.ts`

#### Função
`preOrchestrate(input: StudyPlanInput)`

#### Detecção de Input
```typescript
// ✅ Detecta se content é objeto estruturado ou string
if (typeof input.content === 'object' && input.content !== null) {
  if ('concursos' in input.content && Array.isArray(input.content.concursos)) {
    // NOVO: Recebe JSON estruturado
    const studyPlans = convertEditalToStudyPlans(input.content);
    return { success: true, data: studyPlans };
  }
}

// LEGADO: Backward compatibility com texto bruto
const identificationResult = await identifyPlans(input.content as string);
```

#### Conversão de Tipos
```typescript
function convertEditalToStudyPlans(edital: EditalProcessado): StudyPlanData[] {
  return edital.concursos.map(concurso => ({
    metadata: {
      examName: concurso.metadata.examName,
      examOrg: concurso.metadata.examOrg,
      startDate: concurso.metadata.startDate || new Date().toISOString().split('T')[0],
      notes: concurso.metadata.notes
    },
    exams: concurso.fases.map(fase => ({
      examType: fase.tipo,
      examDate: fase.data || 'a divulgar',
      examTurn: fase.turno === 'nao_especificado' ? 'manha' : fase.turno,
      totalQuestions: fase.totalQuestoes || 0
    })),
    disciplines: concurso.disciplinas.map(disc => ({
      name: disc.nome,
      numberOfQuestions: disc.numeroQuestoes,
      topics: disc.materias.map(mat => ({
        name: mat.nome,
        weight: 1.0
      }))
    }))
  }));
}
```

---

### **FASE 5: ORCHESTRATOR (CRIAÇÃO NO BANCO)**

#### Arquivo
`src/agents/orchestrator-agent.ts`

#### Função
`createStudyPlan(input: StudyPlanInput)`

#### Fluxo de Criação

##### **5.1. Criar Study Plan**
```sql
INSERT INTO study_plans (
  user_id,
  exam_name,
  exam_org,
  start_date,
  status
) VALUES (?, ?, ?, ?, 'processing')
RETURNING id;
```

##### **5.2. Criar Exams**
```sql
INSERT INTO exams (
  plan_id,
  exam_type,
  exam_date,
  exam_turn,
  total_questions
) VALUES (?, ?, ?, ?, ?);
```

##### **5.3. Criar Disciplines**
```sql
INSERT INTO disciplines (
  plan_id,
  name,
  color,
  number_of_questions
) VALUES (?, ?, ?, ?)
RETURNING id;
```

##### **5.4. Criar Topics**
```sql
INSERT INTO topics (
  plan_id,
  discipline_id,
  name,
  weight
) VALUES (?, ?, ?, ?);
```

##### **5.5. Vincular ao Edital**
```sql
UPDATE study_plans 
SET edital_id = ?
WHERE id = ?;
```

##### **5.6. Atualizar Status**
```sql
UPDATE study_plans 
SET status = 'ready'
WHERE id = ?;
```

---

## 📊 ESTRUTURA DE DADOS

### **EditalProcessado** (Formato de Extração)

```typescript
interface EditalProcessado {
  concursos: {
    metadata: {
      examName: string;
      examOrg: string;
      cargo?: string;
      area?: string;
      startDate: string | null;  // YYYY-MM-DD
      examTurn: 'manha' | 'tarde' | 'noite' | 'integral' | 'nao_especificado';
      totalQuestions: number;
      notaMinimaAprovacao?: number;
      criteriosEliminatorios: string[];
      notes?: string;
    };
    fases: {
      tipo: 'objetiva' | 'discursiva' | 'pratica' | 'oral' | 'titulos' | 'aptidao_fisica';
      data: string | null;
      turno: 'manha' | 'tarde' | 'noite' | 'integral' | 'nao_especificado';
      totalQuestoes?: number;
      duracao?: string;
      notaMinima?: number;
      peso: number;
    }[];
    disciplinas: {
      nome: string;
      numeroQuestoes: number;
      peso: number;
      materias: {
        nome: string;
        ordem: number;
        subtopicos?: string[];
        legislacoes?: string[];
      }[];
    }[];
  }[];
  validacao: {
    totalDisciplinas: number;
    totalQuestoes: number;
    totalMaterias: number;
    integridadeOK: boolean;
    avisos: string[];
    erros: string[];
  };
  metadataProcessamento: {
    dataProcessamento: string;
    versaoSchema: string;
    tempoProcessamento: number;
    modeloIA: string;
    strategy?: 'full-extraction-single-call' | 'hierarchical-chunking';
  };
}
```

### **StudyPlanData** (Formato do Orchestrator)

```typescript
interface StudyPlanData {
  metadata: {
    examName: string;
    examOrg: string;
    startDate: string;  // YYYY-MM-DD
    notes?: string;
  };
  exams: {
    examType: 'objetiva' | 'discursiva' | 'prática' | 'oral';
    examDate: string;  // YYYY-MM-DD ou "a divulgar"
    examTurn: 'manha' | 'tarde' | 'noite';
    totalQuestions: number;
  }[];
  disciplines: {
    name: string;
    numberOfQuestions?: number;
    topics: {
      name: string;
      weight: 1.0 | 1.5 | 2.0;
    }[];
  }[];
}
```

---

## 🔗 DEPENDÊNCIAS E INTEGRAÇÕES

### **Database Schema**

#### Tabela: `edital_file`
```sql
CREATE TABLE edital_file (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  edital_file_url TEXT NOT NULL,
  edital_bucket_path TEXT NOT NULL,
  edital_status TEXT CHECK (edital_status IN ('processing', 'ready', 'error')),
  processing_result JSONB,           -- JSON completo do edital processado
  transcription_url TEXT,             -- URL do TXT original
  json_url TEXT,                      -- URL pública do JSON processado
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### Tabela: `study_plans`
```sql
CREATE TABLE study_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  exam_name TEXT NOT NULL,
  exam_org TEXT,
  start_date DATE NOT NULL,
  status plan_status DEFAULT 'processing',
  edital_id UUID REFERENCES edital_file(id),  -- FK para edital_file
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### Tabela: `disciplines`
```sql
CREATE TABLE disciplines (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID REFERENCES study_plans(id) NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  number_of_questions INTEGER
);
```

#### Tabela: `topics`
```sql
CREATE TABLE topics (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID REFERENCES study_plans(id) NOT NULL,
  discipline_id BIGINT REFERENCES disciplines(id) NOT NULL,
  name TEXT NOT NULL,
  weight NUMERIC CHECK (weight IN (1.0, 1.5, 2.0))
);
```

#### Tabela: `exams`
```sql
CREATE TABLE exams (
  plan_id UUID REFERENCES study_plans(id) NOT NULL,
  exam_type exam_type NOT NULL,
  exam_date TEXT,
  exam_turn turn NOT NULL,
  total_questions INTEGER
);
```

### **Supabase Storage**

#### Bucket: `editals`
- **Nome**: `editals`
- **Público**: `true`
- **Estrutura**:
  ```
  editals/
  ├── {user_id}/
  │   ├── {original_file}.pdf
  │   ├── {transcription_id}.txt
  │   └── {job_id}.json  ← JSON processado
  ```

### **Variáveis de Ambiente**

```bash
# Supabase
SUPABASE_URL="https://kqhrhafgnoxbgjtvkomx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..."

# Claude AI
CLAUDE_AI_API_KEY="sk-ant-api03-..."

# Server
PORT="3000"
TOKEN="..." # Bearer token para autenticação
```

---

## ✅ VERIFICAÇÃO E VALIDAÇÃO

### **Checklist Pré-Execução**

#### **1. Database**
- [ ] Tabela `edital_file` existe
- [ ] Colunas: `processing_result` (jsonb), `json_url` (text), `transcription_url` (text)
- [ ] Tabela `study_plans` existe
- [ ] Coluna `edital_id` (uuid) com FK para `edital_file.id`
- [ ] Tabelas `disciplines`, `topics`, `exams` existem
- [ ] Foreign keys configuradas

#### **2. Supabase Storage**
- [ ] Bucket `editals` existe
- [ ] Bucket é público (`public: true`)
- [ ] Permissões de upload/download configuradas

#### **3. Variáveis de Ambiente**
- [ ] `SUPABASE_URL` configurada
- [ ] `SUPABASE_SERVICE_ROLE_KEY` configurada
- [ ] `CLAUDE_AI_API_KEY` configurada
- [ ] `TOKEN` configurado (Bearer auth)

#### **4. Código**
- [ ] Controller aceita apenas `edital_file_id` (sem `schedule_plan_id`)
- [ ] Service não usa `txt_url` (coluna não existe)
- [ ] Upload para Supabase Storage implementado
- [ ] Orchestrator recebe JSON estruturado (não texto)
- [ ] Pre-orchestrator converte `EditalProcessado` → `StudyPlanData[]`

### **Monitoramento de Logs**

#### **Logs Esperados (Sucesso)**

```
[EDITAL-BG] 📥 Starting background processing
[EDITAL-BG] 📊 Step 1/7: Fetching content
[EDITAL-BG] ✅ Content fetched (143,912 characters)
[EDITAL-BG] 🤖 Step 2/7: Processing with Claude
[EDITAL-BG] ⏱️  Processing... elapsed: 10s
[EDITAL-BG] ⏱️  Processing... elapsed: 20s
...
[EDITAL-BG] ⏱️  Processing... elapsed: 340s
[EDITAL-BG] ✅ Claude response received (98,510 characters)
[EDITAL-BG] 🔍 Step 3/7: Parsing JSON
[EDITAL-BG] ✅ JSON parsed successfully
[EDITAL-BG] ✅ Schema validation passed
[EDITAL-BG] 💾 Step 7/7: Writing processed content
[EDITAL-BG] ☁️  Uploading JSON to Supabase storage
[EDITAL-BG] ✅ JSON uploaded to Supabase storage
[EDITAL-BG] ✅ Database updated successfully
[EDITAL-BG] 🚀 Triggering orchestrator with processed JSON
[EDITAL-BG] ✅ Orchestrator completed successfully
[EDITAL-BG] 🔗 Study plan linked to edital_file
[EDITAL-BG] 🎉 Edital processing completed successfully
```

#### **Logs de Erro Possíveis**

```
⚠️  Schema validation warnings - Questões extraídas vs esperadas
⚠️  Failed to upload JSON to Supabase storage
⚠️  Failed to update edital_file in database
❌ Orchestrator failed
❌ Critical error during processing
```

### **Validação de Resultados**

#### **No Banco de Dados**

```sql
-- Verificar edital processado
SELECT 
  id,
  edital_status,
  json_url,
  processing_result->'validacao'->>'totalDisciplinas' as disciplinas,
  processing_result->'validacao'->>'totalMaterias' as materias
FROM edital_file 
WHERE id = 'edital_file_id';

-- Verificar study plan criado
SELECT 
  id,
  exam_name,
  edital_id,
  status
FROM study_plans
WHERE edital_id = 'edital_file_id';

-- Verificar disciplinas criadas
SELECT COUNT(*) FROM disciplines WHERE plan_id = 'study_plan_id';

-- Verificar tópicos criados
SELECT COUNT(*) FROM topics WHERE plan_id = 'study_plan_id';
```

#### **No Supabase Storage**

```bash
# URL esperada do JSON
https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/{user_id}/{job_id}.json
```

---

## 🎯 RESUMO EXECUTIVO

### **Fluxo em 7 Etapas**

1. **Requisição HTTP** → Controller valida `edital_file_id`
2. **Download TXT** → Fetch do Supabase Storage (~5s)
3. **Processamento Claude** → Extração estruturada (~5-8min)
4. **Validação** → Zod schema integrity check
5. **Upload Storage** → JSON público no Supabase
6. **Update Database** → `edital_file.processing_result` + `json_url`
7. **Orchestrator** → Cria `study_plans`, `disciplines`, `topics`, `exams`

### **Pontos Críticos**

✅ **Sistema NÃO chunka o input** - Processa texto completo (até 200K tokens)  
✅ **Orchestrator recebe JSON** - NÃO reprocessa o texto  
✅ **JSON salvo no Supabase** - URL pública acessível  
✅ **Foreign Keys em cascata** - `study_plans.edital_id` → `edital_file.id`  

### **Performance**

- **143KB de texto**: ~5min 43s
- **Rate**: ~2.5ms por caractere
- **Tokens**: ~35K input + ~25K output (estimado)

---

## 📚 REFERÊNCIAS

- **Schema Zod**: `src/core/services/editais/edital-schema.ts`
- **Service**: `src/core/services/editais/edital-process.service.ts`
- **Controller**: `src/api/controllers/editais.controllers.ts`
- **Pre-orchestrator**: `src/agents/sub-agents/pre-orchestrator.ts`
- **Orchestrator**: `src/agents/orchestrator-agent.ts`
- **Database Schema**: `docs/database/database_schema.md`

---

**Documento mantido por**: GitHub Copilot  
**Última revisão**: 19 de Outubro de 2025
