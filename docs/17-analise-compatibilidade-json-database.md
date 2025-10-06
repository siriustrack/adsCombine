# Análise de Compatibilidade: JSON Editais vs Database Schema

## 📊 Status: ⚠️ INCOMPATIBILIDADES CRÍTICAS IDENTIFICADAS

Data: 6 de outubro de 2025  
Revisão: v1.0

---

## 1. Executive Summary

Após análise detalhada do formato JSON gerado pelo `EditalProcessService` e do schema do database Supabase, **identificamos incompatibilidades estruturais** que impedirão os agentes de orquestração de criar os planos de estudo corretamente sem ajustes.

**Principais problemas:**
1. ❌ Estrutura hierárquica incompatível (disciplinas dentro de grupos vs disciplinas diretas)
2. ❌ Campos obrigatórios ausentes no JSON gerado
3. ❌ Nomenclatura de campos divergente
4. ❌ Tipos de dados incompatíveis (arrays vs valores únicos)
5. ❌ Informações de legislações não mapeadas para o banco

**Taxa de compatibilidade estimada:** ~40%

---

## 2. Comparação Estrutural

### 2.1. Estrutura do JSON Gerado (EditalProcessService)

```json
{
  "concursos": [
    {
      "metadata": {
        "examName": "Nome do Concurso",
        "examOrg": "Órgão",
        "cargo": "Cargo",
        "area": "Área",
        "startDate": "2023-04-30",
        "examTurn": "manha",
        "totalQuestions": 100,
        "notaMinimaAprovacao": 50,
        "notaMinimaEliminatoria": 50,
        "criteriosEliminatorios": [...],
        "notes": "..."
      },
      "fases": [
        {
          "tipo": "objetiva",
          "data": "2023-04-30",
          "turno": "manha",
          "totalQuestoes": 100,
          "caraterEliminatorio": true,
          "notaMinima": 50,
          "peso": 1.0
        }
      ],
      "disciplinas": [
        {
          "nome": "Grupo I",
          "numeroQuestoes": 46,
          "peso": 1.0,
          "materias": [
            {
              "nome": "Direito Constitucional",
              "ordem": 1,
              "subtopicos": [...],
              "legislacoes": [
                {
                  "tipo": "lei",
                  "numero": "12.562",
                  "ano": 2011,
                  "ementa": "..."
                }
              ],
              "observacoes": "..."
            }
          ]
        }
      ]
    }
  ]
}
```

### 2.2. Estrutura Esperada pelo Database

```sql
-- study_plans (1 por concurso)
{
  exam_name: TEXT,
  exam_org: TEXT,
  start_date: DATE,
  notes: TEXT,
  edital_id: UUID
}

-- exams (1:1 com study_plan)
{
  plan_id: UUID,
  exam_type: ENUM('objetiva','discursiva','pratica','oral'),
  exam_date: VARCHAR(255),
  exam_turn: ENUM('manha','tarde','noite'),
  total_questions: INT
}

-- disciplines (N por study_plan)
{
  plan_id: UUID,
  name: TEXT,
  color: TEXT,
  number_of_questions: INT
}

-- topics (N por discipline)
{
  plan_id: UUID,
  discipline_id: BIGINT,
  name: TEXT,
  weight: NUMERIC(3,1) CHECK (IN 1.0, 1.5, 2.0)
}
```

---

## 3. Incompatibilidades Detalhadas

### 3.1. ❌ CRÍTICO: Hierarquia de Disciplinas

**Problema:** JSON tem estrutura aninhada `Grupo → Disciplina → Matéria`, mas database espera `Disciplina → Tópico` (flat).

**JSON Gerado:**
```json
{
  "disciplinas": [
    {
      "nome": "Grupo I",              // ← GRUPO (não é disciplina real!)
      "numeroQuestoes": 46,
      "materias": [
        {
          "nome": "Direito Constitucional",  // ← Disciplina real
          "subtopicos": [...]                // ← Tópicos
        },
        {
          "nome": "Direito Administrativo",
          "subtopicos": [...]
        }
      ]
    }
  ]
}
```

**Database Espera:**
```sql
-- Disciplinas diretas (sem grupos)
disciplines: [
  { name: "Direito Constitucional", number_of_questions: 15 },
  { name: "Direito Administrativo", number_of_questions: 20 }
]

-- Topics de cada disciplina
topics: [
  { discipline_id: 1, name: "Hermenêutica Constitucional", weight: 1.0 },
  { discipline_id: 1, name: "Poder Constituinte", weight: 1.5 }
]
```

**Impacto:** 🔴 **BLOQUEADOR** - Agente não conseguirá mapear grupos para disciplinas sem lógica customizada.

**Solução Necessária:**
1. **Opção A - Achatar JSON:** Transformar grupos em prefixos (`"Grupo I - Direito Constitucional"`)
2. **Opção B - Ignorar Grupos:** Criar apenas disciplinas reais (perder informação de agrupamento)
3. **Opção C - Adicionar Tabela:** Criar `discipline_groups` no database (mais complexo)

---

### 3.2. ❌ CRÍTICO: Campo `exam_type` vs Múltiplas Fases

**Problema:** Database espera 1 `exam_type` por `study_plan`, mas JSON tem múltiplas fases.

**JSON Gerado:**
```json
"fases": [
  { "tipo": "objetiva", "data": "2023-04-30" },
  { "tipo": "discursiva", "data": "2023-06-17" },
  { "tipo": "discursiva", "data": "2023-06-18" },
  { "tipo": "oral", "data": "a_divulgar" }
]
```

**Database Espera:**
```sql
exams {
  exam_type: ENUM('objetiva','discursiva','pratica','oral'),  -- UM ÚNICO TIPO!
  exam_date: VARCHAR(255),
  total_questions: INT
}
```

**Impacto:** 🔴 **BLOQUEADOR** - Impossível representar concursos com múltiplas fases no modelo atual.

**Solução Necessária:**
1. **Opção A - Criar study_plan por fase:** 1 concurso → 4 study_plans (objetiva, discursiva x3, oral)
2. **Opção B - Modificar Database:** Adicionar tabela `exam_phases` com 1:N com `study_plans`
3. **Opção C - Usar apenas fase principal:** Ignorar fases secundárias (perder informação)

---

### 3.3. ⚠️ ALTO: Campos Obrigatórios Ausentes

**Campos que database requer mas JSON não gera:**

| Campo Database | Presente no JSON? | Mapeamento Possível |
|----------------|-------------------|---------------------|
| `disciplines.color` | ❌ Não | ⚠️ Gerar aleatoriamente |
| `topics.weight` | ❌ Não (gera peso só em disciplinas) | ⚠️ Usar peso da disciplina pai |
| `study_plans.user_id` | ❌ Não | ✅ Passar via API |
| `study_plans.edital_id` | ❌ Não | ✅ Passar via API |

**Impacto:** 🟡 **ALTO** - Agente precisa inferir/gerar valores ausentes.

---

### 3.4. ⚠️ MÉDIO: Nomenclatura Divergente

**Campos com nomes diferentes:**

| JSON | Database | Conversão |
|------|----------|-----------|
| `metadata.examName` | `exam_name` | ✅ Trivial (snake_case) |
| `metadata.examOrg` | `exam_org` | ✅ Trivial |
| `metadata.totalQuestions` | `total_questions` | ✅ Trivial |
| `metadata.examTurn` | `exam_turn` | ✅ Trivial |
| `metadata.startDate` | `start_date` | ✅ Trivial |
| `fases[].totalQuestoes` | `total_questions` | ✅ Trivial |
| `disciplinas[].numeroQuestoes` | `number_of_questions` | ✅ Trivial |
| `materias[].subtopicos` | `topics[].name` | ⚠️ Precisa achatar array |

**Impacto:** 🟢 **BAIXO** - Fácil de mapear, mas agente precisa saber fazer snake_case.

---

### 3.5. ⚠️ MÉDIO: Informações de Legislações Não Mapeadas

**Problema:** JSON extrai legislações, mas database não tem estrutura para armazená-las.

**JSON Gerado:**
```json
"legislacoes": [
  {
    "tipo": "lei",
    "numero": "12.562",
    "ano": 2011,
    "ementa": "Sobre intervenção federal",
    "artigos": "arts. 1º a 10"
  }
]
```

**Database:** ❌ **Não tem tabela `legislations`**

**Impacto:** 🟡 **MÉDIO** - Informação valiosa extraída será perdida.

**Solução Necessária:**
1. **Opção A - Adicionar Tabela:** Criar `legislations` e `topic_legislations` (N:N)
2. **Opção B - Armazenar em JSONB:** Adicionar campo `legislations JSONB` em `topics`
3. **Opção C - Ignorar:** Descartar legislações (perder dados)

---

### 3.6. ⚠️ BAIXO: Dados Extras Não Utilizados

**Campos no JSON que database não usa:**

- `metadata.cargo`
- `metadata.area`
- `metadata.notaMinimaAprovacao`
- `metadata.notaMinimaEliminatoria`
- `metadata.criteriosEliminatorios`
- `fases[].caraterEliminatorio`
- `fases[].peso`
- `materias[].ordem`
- `materias[].observacoes`

**Impacto:** 🟢 **BAIXO** - Podem ser ignorados ou salvos em `notes`.

---

## 4. Análise dos Agentes

### 4.1. Agente Orquestrador (12-orquestrador-agent.md)

**O que ele espera fazer:**

```markdown
1. Extrair informações de study_plan do JSON
2. Chamar create_study_plan() → receber plan_id
3. Extrair exams e chamar create_exams(plan_id)
4. Extrair disciplines e chamar create_disciplines(plan_id) → receber discipline_ids[]
5. Extrair topics e chamar create_topics(discipline_ids)
```

**Problemas identificados:**

❌ **Passo 1 - Study Plan:**
- Consegue extrair `exam_name`, `exam_org`, `start_date` ✅
- NÃO consegue extrair `user_id`, `edital_id` (não está no JSON) ❌
- `notes` pode ser montado agregando campos extras ⚠️

❌ **Passo 2 - Exams:**
- JSON tem **array de fases**, database espera **1 único exam** ❌
- Agente ficará confuso: qual fase usar? Primeira? Todas? ❌

❌ **Passo 3 - Disciplines:**
- JSON tem **grupos contendo disciplinas**, database espera **disciplinas diretas** ❌
- Agente precisa **achatar hierarquia** mas prompt não instrui isso ❌
- Falta `color` - agente precisa gerar (prompt não menciona) ❌

❌ **Passo 4 - Topics:**
- JSON tem `subtopicos[]` (array de strings), database espera objetos com `weight` ❌
- Prompt não instrui como gerar `weight` (1.0, 1.5, 2.0) ❌
- Agente precisa associar cada subtópico ao `discipline_id` correto ⚠️

**Conclusão:** 🔴 **AGENTE NÃO CONSEGUIRÁ EXECUTAR SEM AJUSTES**

---

### 4.2. Sub-Agentes Especializados

#### 4.2.1. Agente Study Plans (13-study-plan-agent.md)

**Inputs esperados vs disponíveis:**

| Campo | Disponível? | Observação |
|-------|-------------|------------|
| `exam_name` | ✅ Sim | `metadata.examName` |
| `exam_org` | ✅ Sim | `metadata.examOrg` |
| `start_date` | ✅ Sim | `metadata.startDate` |
| `user_id` | ❌ Não | Precisa vir de contexto externo |
| `edital_id` | ❌ Não | Precisa vir de contexto externo |
| `notes` | ⚠️ Parcial | Pode montar de campos extras |

**Conclusão:** ⚠️ **Precisa receber `user_id` e `edital_id` como parâmetros adicionais**

---

#### 4.2.2. Agente Exams (14-exams-agent.md)

**Problema crítico:** JSON tem múltiplas fases, agente espera criar 1 exam.

**Soluções possíveis:**

1. **Criar múltiplos study_plans:**
   - 1 study_plan para "Concurso AGU - Fase Objetiva"
   - 1 study_plan para "Concurso AGU - Fase Discursiva 1"
   - etc.
   - ⚠️ Usuário não esperaria isso (confuso na UI)

2. **Usar apenas fase principal:**
   - Pegar `fases[0]` (geralmente objetiva)
   - Ignorar demais fases
   - ❌ Perder informação valiosa

3. **Modificar database:**
   - Criar tabela `exam_phases` separada
   - 1:N com study_plans
   - ✅ Solução ideal, mas requer mudança no schema

**Conclusão:** 🔴 **BLOQUEADOR - Requer decisão de arquitetura**

---

#### 4.2.3. Agente Disciplines (15-disciplines-agent.md)

**Transformação necessária:**

```
JSON (hierárquico):
  Grupo I (46 questões)
    ├─ Direito Constitucional
    ├─ Direito Administrativo
    ├─ Direito Tributário
    └─ ...
  Grupo II (54 questões)
    ├─ Direito Civil
    └─ ...

↓ TRANSFORMAR EM ↓

Database (flat):
  disciplines: [
    { name: "Direito Constitucional", number_of_questions: ?, color: ? },
    { name: "Direito Administrativo", number_of_questions: ?, color: ? },
    ...
  ]
```

**Problemas:**

1. ❌ **Distribuição de questões:** JSON não especifica questões por disciplina, só por grupo
2. ❌ **Cores:** Agente precisa gerar (paleta de cores não está no JSON)
3. ⚠️ **Nome da disciplina:** Está em `materias[].nome`, não `disciplinas[].nome`

**Conclusão:** 🔴 **AGENTE NÃO CONSEGUE PROCESSAR ESTRUTURA ATUAL**

---

#### 4.2.4. Agente Topics (16-topics-agent.md)

**Transformação necessária:**

```
JSON:
  materias: [
    {
      nome: "Direito Constitucional",
      subtopicos: [
        "Hermenêutica constitucional",
        "Poder constituinte",
        ...
      ]
    }
  ]

↓ TRANSFORMAR EM ↓

Database:
  topics: [
    { discipline_id: 1, name: "Hermenêutica constitucional", weight: 1.0 },
    { discipline_id: 1, name: "Poder constituinte", weight: 1.5 },
    ...
  ]
```

**Problemas:**

1. ❌ **Weight:** JSON não tem `weight` por tópico, só `peso` por disciplina
2. ⚠️ **Mapping:** Precisa mapear `materia` → `discipline_id` corretamente
3. ⚠️ **Quantidade:** Pode ter 100+ tópicos por disciplina (performance?)

**Conclusão:** ⚠️ **FUNCIONA COM AJUSTES** - Precisa gerar weights aleatórios (1.0, 1.5, 2.0)

---

## 5. Matriz de Compatibilidade

| Componente | Compatibilidade | Bloqueador? | Esforço de Ajuste |
|------------|----------------|-------------|-------------------|
| **Study Plans** | 🟡 60% | Não | Baixo (passar user_id/edital_id) |
| **Exams** | 🔴 20% | **SIM** | Alto (múltiplas fases) |
| **Disciplines** | 🔴 30% | **SIM** | Alto (hierarquia aninhada) |
| **Topics** | 🟡 70% | Não | Médio (gerar weights) |
| **Legislações** | 🔴 0% | Não | Alto (adicionar tabela) |
| **Overall** | 🟡 40% | **SIM** | **Alto** |

---

## 6. Recomendações

### 6.1. Opções de Resolução

#### 🎯 **OPÇÃO 1: Ajustar JSON Gerado** (Recomendado)

**Modificar `EditalProcessService` para gerar JSON compatível:**

```typescript
// NOVO FORMATO PLANO (sem hierarquia de grupos)
{
  "concursos": [
    {
      "metadata": { ... },
      "exam": {  // ← SINGULAR, não array de fases
        "type": "objetiva",
        "date": "2023-04-30",
        "turn": "manha",
        "total_questions": 100
      },
      "disciplines": [  // ← FLAT, sem grupos
        {
          "name": "Direito Constitucional",
          "color": "#3B82F6",
          "number_of_questions": 15,
          "topics": [
            { "name": "Hermenêutica constitucional", "weight": 1.0 },
            { "name": "Poder constituinte", "weight": 1.5 }
          ]
        }
      ]
    }
  ]
}
```

**Vantagens:**
- ✅ 100% compatível com database
- ✅ Agentes funcionam sem modificações
- ✅ Não requer mudanças no schema

**Desvantagens:**
- ❌ Perde informação de grupos
- ❌ Perde informação de múltiplas fases
- ❌ Precisa refatorar `EditalProcessService` e schema Zod

**Esforço:** 🟡 Médio (2-3 dias)

---

#### 🔧 **OPÇÃO 2: Criar Camada de Transformação**

**Adicionar adapter entre JSON e Database:**

```typescript
class EditalToDatabaseAdapter {
  transform(editalJSON: EditalProcessado): DatabaseInsert {
    // 1. Achatar grupos em disciplinas
    const disciplines = this.flattenGroups(editalJSON);
    
    // 2. Selecionar fase principal
    const mainExam = this.selectMainPhase(editalJSON.fases);
    
    // 3. Gerar cores para disciplinas
    const withColors = this.assignColors(disciplines);
    
    // 4. Gerar weights para tópicos
    const withWeights = this.assignWeights(withColors);
    
    return { study_plan, exam, disciplines, topics };
  }
}
```

**Vantagens:**
- ✅ Mantém JSON rico em informações
- ✅ Database recebe formato esperado
- ✅ Lógica centralizada e testável

**Desvantagens:**
- ⚠️ Adiciona complexidade
- ⚠️ Pode ter perdas de informação (grupos, fases secundárias)

**Esforço:** 🟡 Médio (3-4 dias)

---

#### 🏗️ **OPÇÃO 3: Expandir Database Schema**

**Adicionar tabelas para suportar estrutura completa:**

```sql
-- Nova tabela: grupos de disciplinas
CREATE TABLE discipline_groups (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID REFERENCES study_plans(id),
  name TEXT NOT NULL,
  number_of_questions INT
);

-- Adicionar foreign key em disciplines
ALTER TABLE disciplines 
  ADD COLUMN group_id BIGINT REFERENCES discipline_groups(id);

-- Nova tabela: fases do exame
CREATE TABLE exam_phases (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID REFERENCES study_plans(id),
  phase_order SMALLINT,
  type exam_type NOT NULL,
  date VARCHAR(255),
  turn turn,
  total_questions INT,
  eliminatory BOOLEAN,
  min_score NUMERIC,
  weight NUMERIC
);

-- Nova tabela: legislações
CREATE TABLE legislations (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(50),
  number VARCHAR(20),
  year INT,
  summary TEXT
);

-- Nova tabela: relação tópico-legislação
CREATE TABLE topic_legislations (
  topic_id BIGINT REFERENCES topics(id),
  legislation_id BIGINT REFERENCES legislations(id),
  PRIMARY KEY (topic_id, legislation_id)
);
```

**Vantagens:**
- ✅ 100% das informações preservadas
- ✅ Modelo de dados mais rico
- ✅ Suporta casos complexos (múltiplas fases, grupos)

**Desvantagens:**
- ❌ Mudança significativa no database
- ❌ Precisa refatorar todos os agentes
- ❌ Migração de dados existentes
- ❌ UI precisa ser adaptada

**Esforço:** 🔴 Alto (1-2 semanas)

---

### 6.2. Roadmap Proposto

#### 🚀 **FASE 1: Quick Fix (1-2 dias)**

**Objetivo:** Fazer agentes funcionarem com dados básicos

1. Criar adapter simples que:
   - Achata grupos em disciplinas individuais
   - Usa apenas primeira fase como `exam`
   - Distribui questões igualmente entre disciplinas
   - Gera cores aleatórias
   - Usa weight 1.0 para todos os tópicos

2. Modificar prompts dos agentes para:
   - Aceitar `user_id` e `edital_id` como parâmetros
   - Instruir sobre snake_case
   - Explicar mapeamento de campos

3. Testar com 1 edital simples (OAB ou Prefeitura)

**Resultado esperado:** ✅ Agentes criam study_plans básicos funcionais

---

#### 🎯 **FASE 2: Refinamento (3-5 dias)**

**Objetivo:** Melhorar qualidade dos dados gerados

1. Implementar lógica inteligente de distribuição de questões:
   - Analisar quantas matérias por grupo
   - Distribuir proporcionalmente

2. Criar paleta de cores consistente:
   - 12 cores predefinidas por área
   - Atribuir por tipo de disciplina

3. Implementar lógica de weights:
   - Tópicos básicos: 1.0
   - Tópicos intermediários: 1.5
   - Tópicos avançados/complexos: 2.0
   - Usar heurísticas (tamanho do nome, palavras-chave)

4. Adicionar validações:
   - Verificar total de questões
   - Garantir uniqueness de nomes
   - Validar ENUMs

**Resultado esperado:** ✅ Study plans com qualidade alta

---

#### 🏗️ **FASE 3: Expansão (Opcional, 1-2 semanas)**

**Objetivo:** Suportar casos complexos

1. Adicionar tabelas no database:
   - `discipline_groups`
   - `exam_phases`
   - `legislations`

2. Refatorar JSON para incluir:
   - Múltiplas fases preservadas
   - Grupos preservados
   - Legislações linkadas

3. Atualizar agentes para popular novas tabelas

4. Adaptar UI para mostrar:
   - Grupos de disciplinas
   - Fases múltiplas
   - Legislações por tópico

**Resultado esperado:** ✅ Sistema completo e robusto

---

## 7. Conclusão

### ❓ Resposta à Pergunta Original

> "Você acredita que com o novo formato que criamos os agentes de orquestra são capazes de criar os planos de estudos adequadamente para cada concurso sem erro?"

**Resposta:** ❌ **NÃO, não na configuração atual.**

**Motivos:**

1. 🔴 **Incompatibilidade estrutural crítica:** Hierarquia aninhada (grupos) vs estrutura plana (disciplinas)
2. 🔴 **Múltiplas fases não suportadas:** Database espera 1 exam, JSON gera array de fases
3. 🟡 **Campos obrigatórios ausentes:** `color`, `weight`, `user_id`, `edital_id`
4. 🟡 **Informações não mapeadas:** Legislações extraídas não têm destino no banco

### 🎯 Próximos Passos Recomendados

**Para fazer funcionar RAPIDAMENTE (1-2 dias):**

1. ✅ Implementar adapter de transformação (OPÇÃO 2)
2. ✅ Ajustar prompts dos agentes
3. ✅ Testar com 1 edital simples
4. ✅ Validar end-to-end

**Para ter sistema COMPLETO (2-3 semanas):**

1. ✅ Executar FASE 1 (Quick Fix)
2. ✅ Executar FASE 2 (Refinamento)
3. ✅ Considerar FASE 3 (Expansão) conforme necessidade

### 📊 Métricas de Sucesso

**Critérios para considerar "100% funcional":**

- [ ] Agente cria study_plan sem erros
- [ ] Todas as disciplinas reais são criadas (não grupos)
- [ ] Topics são corretamente associados às disciplines
- [ ] Weights são atribuídos com lógica (não todos 1.0)
- [ ] Colors são atribuídas com paleta consistente
- [ ] Total de questões bate com edital original
- [ ] Legislações são preservadas (ou decisão consciente de descartá-las)
- [ ] Múltiplas fases são tratadas (mesmo que simplificando para fase principal)

---

**Documento gerado em:** 2025-10-06  
**Autor:** Análise AI Assistant  
**Status:** ⚠️ AÇÃO NECESSÁRIA
