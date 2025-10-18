# Comparação Visual: JSON Extraído vs Agentes vs Database

## 📊 Guia Rápido de Incompatibilidades

### 🔴 Problema #1: Hierarquia de Disciplinas

```
┌─────────────────────────────────────────────────────────────────────┐
│ JSON EXTRAÍDO (EditalProcessService)                                │
├─────────────────────────────────────────────────────────────────────┤
│ {                                                                   │
│   "disciplinas": [                                                  │
│     {                                                               │
│       "nome": "Grupo I",           ← GRUPO (não é disciplina!)     │
│       "numeroQuestoes": 46,                                         │
│       "materias": [                ← Disciplinas estão aqui dentro │
│         {                                                           │
│           "nome": "Direito Constitucional",  ← Disciplina real     │
│           "subtopicos": [                    ← Tópicos             │
│             "Hermenêutica",                                         │
│             "Poder Constituinte"                                    │
│           ]                                                         │
│         }                                                           │
│       ]                                                             │
│     }                                                               │
│   ]                                                                 │
│ }                                                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ IDENTIFIER AGENT ESPERA GERAR (identifier-agent.ts linha 38)       │
├─────────────────────────────────────────────────────────────────────┤
│ {                                                                   │
│   "disciplines": [                ← Array flat (sem grupos)        │
│     {                                                               │
│       "name": "Direito Constitucional",  ← Disciplina direta       │
│       "color": "#3B82F6",                ← Cor obrigatória          │
│       "numberOfQuestions": 15,           ← Por disciplina          │
│       "topics": [                        ← Tópicos diretos         │
│         {                                                           │
│           "name": "Hermenêutica",                                   │
│           "weight": 1.0              ← Objeto com weight           │
│         }                                                           │
│       ]                                                             │
│     }                                                               │
│   ]                                                                 │
│ }                                                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR AGENT TENTA PROCESSAR (orchestrator-agent.ts:42)      │
├─────────────────────────────────────────────────────────────────────┤
│ const disciplinesData = planData.disciplines.map(discipline => ({  │
│   plan_id: planId,                                                  │
│   name: discipline.name,        ← undefined! (JSON tem .nome)      │
│   color: discipline.color,      ← undefined! (JSON não tem)        │
│   number_of_questions: ...      ← undefined! (JSON tem em grupo)   │
│ }));                                                                │
│                                                                     │
│ ❌ RESULTADO: Vai criar disciplina com nome "undefined"            │
│ ❌ ERRO NO BANCO: color violates not-null constraint               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ DATABASE EXIGE (database_schema.md)                                │
├─────────────────────────────────────────────────────────────────────┤
│ CREATE TABLE disciplines (                                          │
│   plan_id UUID,                                                     │
│   name TEXT NOT NULL,           ← Nome da disciplina real          │
│   color TEXT NOT NULL,          ← OBRIGATÓRIO (não pode ser NULL)  │
│   number_of_questions INT       ← Por disciplina, não por grupo    │
│ );                                                                  │
│                                                                     │
│ ✅ ESPERA:                                                          │
│   name = "Direito Constitucional"                                  │
│   color = "#3B82F6"                                                 │
│   number_of_questions = 15                                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ ✅ SOLUÇÃO: Transformer Adapter                                     │
├─────────────────────────────────────────────────────────────────────┤
│ class EditalJSONTransformer {                                       │
│   static transformDisciplines(disciplinas: any[]) {                │
│     const colors = ['#3B82F6', '#10B981', '#F59E0B'];              │
│     let idx = 0;                                                    │
│                                                                     │
│     // Achatar: grupo.materias → disciplines                       │
│     return disciplinas.flatMap(grupo =>                            │
│       grupo.materias.map(materia => ({                             │
│         name: materia.nome,                                         │
│         color: colors[idx++ % colors.length],  ← Gerar cor         │
│         numberOfQuestions: null,               ← Distribuir depois │
│         topics: materia.subtopicos.map(s => ({                     │
│           name: s,                                                  │
│           weight: 1.0                                               │
│         }))                                                         │
│       }))                                                           │
│     );                                                              │
│   }                                                                 │
│ }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 🔴 Problema #2: Múltiplas Fases

```
┌─────────────────────────────────────────────────────────────────────┐
│ JSON EXTRAÍDO                                                       │
├─────────────────────────────────────────────────────────────────────┤
│ "fases": [                                                          │
│   {                                                                 │
│     "tipo": "objetiva",      ← Fase 1                              │
│     "data": "2023-04-30",                                           │
│     "turno": "manha"                                                │
│   },                                                                │
│   {                                                                 │
│     "tipo": "discursiva",    ← Fase 2                              │
│     "data": "2023-06-17",                                           │
│     "turno": "tarde"                                                │
│   },                                                                │
│   {                                                                 │
│     "tipo": "discursiva",    ← Fase 3                              │
│     "data": "2023-06-18"                                            │
│   },                                                                │
│   {                                                                 │
│     "tipo": "oral",          ← Fase 4                              │
│     "data": "a_divulgar",                                           │
│     "turno": "nao_especificado"  ← ENUM INVÁLIDO!                  │
│   },                                                                │
│   {                                                                 │
│     "tipo": "titulos",       ← Fase 5 - TIPO INVÁLIDO!             │
│     "data": "a_divulgar"                                            │
│   }                                                                 │
│ ]                                                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR AGENT TENTA (orchestrator-agent.ts:28)                │
├─────────────────────────────────────────────────────────────────────┤
│ const examsData = planData.exams.map(exam => ({                    │
│   plan_id: planId,                                                  │
│   exam_type: exam.examType,     ← "titulos" (não existe no ENUM!)  │
│   exam_turn: exam.examTurn,     ← "nao_especificado" (inválido!)   │
│   total_questions: exam.totalQuestions                              │
│ }));                                                                │
│                                                                     │
│ await SupabaseService.insertExams(examsData, userId);              │
│                                                                     │
│ ❌ ERRO 1: Invalid input value for enum exam_type: "titulos"       │
│ ❌ ERRO 2: Invalid input value for enum turn: "nao_especificado"   │
│ ❌ ERRO 3: Duplicate key value violates constraint "exams_pkey"    │
│            (tentou inserir 5 exams, mas plan_id é PRIMARY KEY)     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ DATABASE SCHEMA                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ CREATE TYPE exam_type AS ENUM (                                    │
│   'objetiva',                                                       │
│   'discursiva',                                                     │
│   'prática',                                                        │
│   'oral'                    ← SEM "titulos"!                        │
│ );                                                                  │
│                                                                     │
│ CREATE TYPE turn AS ENUM (                                         │
│   'manha',                                                          │
│   'tarde',                                                          │
│   'noite'                   ← SEM "nao_especificado"!               │
│ );                                                                  │
│                                                                     │
│ CREATE TABLE exams (                                                │
│   plan_id UUID PRIMARY KEY,  ← PRIMARY KEY! Só 1 exam por plan!   │
│   exam_type exam_type,                                              │
│   exam_turn turn                                                    │
│ );                                                                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ ✅ SOLUÇÃO: Filtrar e Usar Fase Principal                           │
├─────────────────────────────────────────────────────────────────────┤
│ class EditalJSONTransformer {                                       │
│   static transformExams(fases: any[]): ExamData[] {                │
│     const VALID_TYPES = ['objetiva', 'discursiva', 'prática',      │
│                          'oral'];                                   │
│     const VALID_TURNS = ['manha', 'tarde', 'noite'];               │
│                                                                     │
│     // Filtrar apenas fases válidas                                │
│     const validFases = fases.filter(f =>                           │
│       VALID_TYPES.includes(f.tipo) &&                              │
│       (f.turno === undefined ||                                     │
│        VALID_TURNS.includes(f.turno))                              │
│     );                                                              │
│                                                                     │
│     // Usar apenas primeira fase (limitação do schema)             │
│     const mainFase = validFases[0];                                │
│                                                                     │
│     return [{                                                       │
│       examType: mainFase.tipo as any,                              │
│       examDate: mainFase.data,                                      │
│       examTurn: mainFase.turno || 'manha',  ← Fallback            │
│       totalQuestions: mainFase.totalQuestoes || 0                   │
│     }];                                                             │
│   }                                                                 │
│ }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 🔴 Problema #3: Nomenclatura e Tipos

```
┌────────────────────────────────────────────────────────────────────────────┐
│ MAPEAMENTO DE CAMPOS                                                       │
├────────────────────┬────────────────────┬─────────────────┬───────────────┤
│ JSON EXTRAÍDO      │ AGENT TYPES        │ DATABASE        │ CONVERSÃO     │
├────────────────────┼────────────────────┼─────────────────┼───────────────┤
│ .examName          │ .examName          │ exam_name       │ ✅ snake_case │
│ .examOrg           │ .examOrg           │ exam_org        │ ✅ snake_case │
│ .startDate         │ .startDate         │ start_date      │ ✅ snake_case │
│ .totalQuestions    │ .totalQuestions    │ total_questions │ ✅ snake_case │
│ .examTurn          │ .examTurn          │ exam_turn       │ ✅ snake_case │
│ ────────────────── │ ────────────────── │ ─────────────── │ ───────────── │
│ .disciplinas       │ .disciplines       │ disciplines     │ ⚠️ Rename     │
│ .materias          │ .disciplines       │ disciplines     │ 🔴 Flatten    │
│ .subtopicos[]      │ .topics[]          │ topics          │ 🔴 Transform  │
│ ────────────────── │ ────────────────── │ ─────────────── │ ───────────── │
│ ❌ não existe      │ .color (optional)  │ color NOT NULL  │ 🔴 GERAR      │
│ ❌ não existe      │ ❌ não existe      │ edital_id       │ ⚠️ Parâmetro  │
│ ❌ não existe      │ .weight = 1.0      │ weight          │ ✅ Default    │
└────────────────────┴────────────────────┴─────────────────┴───────────────┘
```

---

### 🔴 Problema #4: Legislações Sem Destino

```
┌─────────────────────────────────────────────────────────────────────┐
│ JSON EXTRAÍDO (100+ legislações)                                    │
├─────────────────────────────────────────────────────────────────────┤
│ "materias": [                                                       │
│   {                                                                 │
│     "nome": "Direito Administrativo",                               │
│     "legislacoes": [                                                │
│       {                                                             │
│         "tipo": "lei",                                              │
│         "numero": "8666",                                           │
│         "ano": "1993",                                              │
│         "nome": "Lei de Licitações e Contratos"                     │
│       },                                                            │
│       {                                                             │
│         "tipo": "lei",                                              │
│         "numero": "14133",                                          │
│         "ano": "2021",                                              │
│         "nome": "Nova Lei de Licitações"                            │
│       }                                                             │
│     ]                                                               │
│   }                                                                 │
│ ]                                                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ AGENT TYPES (types.ts)                                              │
├─────────────────────────────────────────────────────────────────────┤
│ export interface DisciplineWithTopics {                            │
│   name: string;                                                     │
│   topics: TopicData[];                                              │
│   // ❌ Não tem campo para legislações!                            │
│ }                                                                   │
│                                                                     │
│ export interface TopicData {                                        │
│   name: string;                                                     │
│   weight: 1.0 | 1.5 | 2.0;                                         │
│   // ❌ Não tem campo para legislações!                            │
│ }                                                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ DATABASE SCHEMA                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ -- ❌ Não existe tabela "legislations"                             │
│ -- ❌ Não existe relação topic_legislations                        │
│                                                                     │
│ CREATE TABLE topics (                                               │
│   id BIGSERIAL PRIMARY KEY,                                         │
│   name TEXT,                                                        │
│   weight NUMERIC                                                    │
│   -- ❌ Não tem campo legislations                                 │
│ );                                                                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 🚨 IMPACTO: 100+ LEGISLAÇÕES SERÃO PERDIDAS                        │
├─────────────────────────────────────────────────────────────────────┤
│ Estatísticas dos 7 editais processados:                            │
│ • ENAC: 49 legislações                                              │
│ • MPRS: 125 legislações                                             │
│ • Juiz SC: 60 legislações                                           │
│ • OAB: 60 legislações                                               │
│ • Prefeitura: 60 legislações                                        │
│ • Advogado União: 28 legislações                                    │
│ • Cartórios RS: 72 legislações                                      │
│                                                                     │
│ TOTAL: 454 legislações extraídas → 0 salvas no banco! 💀           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ ✅ SOLUÇÃO RÁPIDA: Salvar em JSONB                                  │
├─────────────────────────────────────────────────────────────────────┤
│ ALTER TABLE topics ADD COLUMN legislations JSONB;                   │
│                                                                     │
│ -- Exemplo de dados:                                                │
│ UPDATE topics SET legislations = '[                                 │
│   {                                                                 │
│     "tipo": "lei",                                                  │
│     "numero": "8666",                                               │
│     "ano": "1993",                                                  │
│     "nome": "Lei de Licitações"                                     │
│   }                                                                 │
│ ]'::jsonb WHERE ...;                                                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ ✅ SOLUÇÃO COMPLETA: Tabelas Normalizadas (FASE 3)                  │
├─────────────────────────────────────────────────────────────────────┤
│ CREATE TABLE legislations (                                         │
│   id SERIAL PRIMARY KEY,                                            │
│   type VARCHAR(50),          -- "lei", "decreto", etc.              │
│   number VARCHAR(20),        -- "8666", "14133"                     │
│   year INT,                  -- 1993, 2021                          │
│   name TEXT,                 -- "Lei de Licitações..."              │
│   UNIQUE(type, number, year)                                        │
│ );                                                                  │
│                                                                     │
│ CREATE TABLE topic_legislations (                                   │
│   topic_id BIGINT REFERENCES topics(id),                           │
│   legislation_id INT REFERENCES legislations(id),                   │
│   PRIMARY KEY (topic_id, legislation_id)                            │
│ );                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Fluxo Completo: Do PDF ao Database

```
┌──────────────┐
│   PDF DO     │
│   EDITAL     │
└──────┬───────┘
       │
       ▼
┌────────────────────────────────────────────┐
│  EditalProcessService (PRONTO)             │
│  • Extrai texto com pdf-parse              │
│  • Processa com Claude AI                  │
│  • Gera JSON estruturado                   │
└────────────┬───────────────────────────────┘
             │
             ▼
        ┌────────────────────────────┐
        │  JSON EXTRAÍDO             │
        │  (formato hierárquico)     │
        │                            │
        │  {                         │
        │    concursos: [{           │
        │      metadata: {...},      │
        │      fases: [...],         │
        │      disciplinas: [        │
        │        {                   │
        │          nome: "Grupo I",  │
        │          materias: [...]   │
        │        }                   │
        │      ]                     │
        │    }]                      │
        │  }                         │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  🚨 INCOMPATIBILIDADE AQUI! 🚨     │
        │                                    │
        │  Agentes esperam formato flat:    │
        │  {                                 │
        │    disciplines: [                  │
        │      { name, color, topics }       │
        │    ]                               │
        │  }                                 │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  ✅ SOLUÇÃO: EditalJSONTransformer │
        │  • Achata grupos → disciplinas     │
        │  • Filtra fases inválidas          │
        │  • Gera cores                      │
        │  • Converte para formato esperado  │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │  JSON TRANSFORMADO         │
        │  (formato compatível)      │
        │                            │
        │  {                         │
        │    metadata: {...},        │
        │    exams: [1 item],        │
        │    disciplines: [          │
        │      {                     │
        │        name: "Dir. Const", │
        │        color: "#3B82F6",   │
        │        topics: [...]       │
        │      }                     │
        │    ]                       │
        │  }                         │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  Identifier Agent                  │
        │  (pode pular se JSON já está ok)   │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  Orchestrator Agent                │
        │  • Cria study_plan                 │
        │  • Cria exam (1 único)             │
        │  • Cria disciplines (flat)         │
        │  • Cria topics                     │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  Supabase Database                 │
        │                                    │
        │  study_plans                       │
        │  ├─ id                             │
        │  ├─ exam_name                      │
        │  └─ user_id                        │
        │                                    │
        │  exams (1:1)                       │
        │  ├─ plan_id (PK)                   │
        │  ├─ exam_type                      │
        │  └─ exam_turn                      │
        │                                    │
        │  disciplines (1:N)                 │
        │  ├─ plan_id                        │
        │  ├─ name                           │
        │  └─ color                          │
        │                                    │
        │  topics (1:N)                      │
        │  ├─ discipline_id                  │
        │  ├─ name                           │
        │  └─ weight                         │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  Verifier Agent                    │
        │  • Compara com original            │
        │  • Valida contagens                │
        │  • Atualiza status → "ready"       │
        └────────────────────────────────────┘
```

---

## 🎯 Checklist de Ação Imediata

### PRIORIDADE CRÍTICA (Hoje/Amanhã):

```
[ ] 1. Criar EditalJSONTransformer
    [ ] transformExams() - filtrar "titulos", usar apenas fase principal
    [ ] transformDisciplines() - achatar grupos, gerar cores
    [ ] Testes com JSON real (ENAC, AGU, Cartórios RS)

[ ] 2. Refatorar Orchestrator
    [ ] Adicionar parâmetro editalId
    [ ] Validar ENUMs antes de inserir
    [ ] Garantir color sempre presente
    [ ] Usar apenas 1 exam

[ ] 3. Adicionar Validações em SupabaseService
    [ ] Validar exam_type ∈ ['objetiva', 'discursiva', 'prática', 'oral']
    [ ] Validar turn ∈ ['manha', 'tarde', 'noite']
    [ ] Validar color NOT NULL
    [ ] Método rollbackStudyPlan()

[ ] 4. Testes E2E
    [ ] processEditalJSON(userId, enacJSON) → success
    [ ] Verificar dados no Supabase
    [ ] Validar 10 disciplinas criadas (não 1 grupo)
    [ ] Validar 100 tópicos com weight 1.0
```

### IMPORTANTE (Próximos 3-5 dias):

```
[ ] 5. Distribuição Inteligente de Questões
    [ ] Calcular proporção por número de subtópicos
    [ ] Distribuir questões do grupo entre disciplinas

[ ] 6. Inferência de Weights
    [ ] Keywords: "teoria", "doutrina" → 2.0
    [ ] Keywords: "aplicação", "prática" → 1.5
    [ ] Default → 1.0

[ ] 7. Paleta de Cores por Área
    [ ] Direito Constitucional → #3B82F6 (azul)
    [ ] Direito Administrativo → #10B981 (verde)
    [ ] Direito Civil → #F59E0B (laranja)
    [ ] etc.
```

### OPCIONAL (Futuro, se necessário):

```
[ ] 8. Suporte a Múltiplas Fases
    [ ] Migration: CREATE TABLE exam_phases
    [ ] Refatorar agentes para inserir N fases

[ ] 9. Preservar Grupos
    [ ] Migration: CREATE TABLE discipline_groups
    [ ] Adicionar group_id em disciplines

[ ] 10. Salvar Legislações
    [ ] Opção A: JSONB em topics
    [ ] Opção B: Tabelas legislations + topic_legislations
```

---

**Status:** 🚨 SISTEMA NÃO FUNCIONAL - AÇÃO IMEDIATA NECESSÁRIA  
**ETA para funcionar:** 1-2 dias com FASE 1  
**ETA para qualidade alta:** 4-7 dias com FASE 1+2
