docs/
├── edital-process/  (11 arquivos)
├── agents/          (13 arquivos)
├── frontend/        (4 arquivos)
├── api-reference/   (1 arquivo)
├── database/        (1 arquivo)
├── debug-logs/      (9 arquivos)
├── phase-status/    (6 arquivos)
├── legacy/          (17 arquivos)
└── raiz             (9 arquivos)# 🤖 Arquitetura de Agentes IA para Inserção Inteligente de Editais no Supabase

## 🎯 Visão Geral

Sistema de **orquestração inteligente** onde um agente coordenador delega tarefas a agentes especializados para transformar JSONs de editais processados em registros estruturados no Supabase via MCP.

### ✨ Características

- ✅ **Sem validação rígida de regex** - agentes interpretam contexto semanticamente
- ✅ **Resiliente a mudanças** - adaptável a variações no JSON da IA
- ✅ **Inserção sequencial controlada** - ordem de dependências respeitada
- ✅ **Uso do MCP Supabase** - interface moderna e tipada
- ✅ **Contextual e inteligente** - entende relações entre entidades

---

## 🗄️ Schema Real do Banco (via MCP)

```typescript
// Estrutura hierárquica simplificada
study_plans (plan_id: uuid)
  ├─ edital_file (id: uuid) - opcional, linkado via edital_id
  ├─ exams (plan_id)
  ├─ disciplines (plan_id)
  │   └─ topics (discipline_id, plan_id)
  ├─ cycles_per_dow (plan_id)
  └─ study_schedule (plan_id)
```

### Tabelas Principais

**1. `edital_file`** - Arquivo do edital processado
```sql
- id: uuid (PK)
- user_id: uuid (FK → auth.users)
- edital_file_url: text (URL do PDF/arquivo original)
- transcription_url: text (URL do .txt)
- json_url: text (URL do JSON processado)
- processing_result: jsonb (JSON completo do edital processado)
- edital_status: text ('processing' | 'ready' | 'error')
- created_at, updated_at: timestamptz
```

**2. `study_plans`** - Plano de estudo do usuário
```sql
- id: uuid (PK)
- user_id: uuid (FK → auth.users)
- edital_id: uuid (FK → edital_file.id) - NULLABLE
- exam_name: text
- exam_org: text
- start_date: date
- status: plan_status ('processing' | 'ready')
- current_step: smallint (1-3, wizard progress)
- fixed_off_days: weekday[] (dias de folga fixos)
- notes: text
- created_at, updated_at: timestamptz
```

**3. `exams`** - Provas/fases do concurso
```sql
- plan_id: uuid (FK → study_plans.id)
- exam_type: exam_type ('objetiva' | 'discursiva' | 'prática' | 'oral')
- exam_date: text (YYYY-MM-DD ou 'a_divulgar')
- exam_turn: turn ('manha' | 'tarde' | 'noite')
- total_questions: integer
```

**4. `disciplines`** - Disciplinas do edital
```sql
- id: bigint (PK, auto-increment)
- plan_id: uuid (FK → study_plans.id)
- name: text
- color: text (hex color para UI)
- number_of_questions: integer
```

**5. `topics`** - Matérias/assuntos de cada disciplina
```sql
- id: bigint (PK, auto-increment)
- plan_id: uuid (FK → study_plans.id)
- discipline_id: bigint (FK → disciplines.id)
- name: text
- weight: numeric (1.0 | 1.5 | 2.0)
```

---

## 🏗️ Arquitetura de Agentes

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR AGENT                            │
│  Coordena todo o fluxo, mantém contexto, delega tarefas         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ├─► 1️⃣ EditalFileAgent
                              │    └─ Cria registro em edital_file
                              │
                              ├─► 2️⃣ StudyPlanAgent
                              │    └─ Cria study_plan linkado ao edital
                              │
                              ├─► 3️⃣ ExamsAgent
                              │    └─ Cria registros de provas/fases
                              │
                              ├─► 4️⃣ DisciplinesAgent
                              │    └─ Cria disciplinas e armazena IDs
                              │
                              └─► 5️⃣ TopicsAgent
                                   └─ Cria topics linkados às disciplines
```

### Fluxo Sequencial com Contexto

```typescript
// Contexto compartilhado entre agentes
interface OrchestrationContext {
  user_id: string;
  edital_json: EditalProcessado;
  original_url: string;
  
  // IDs criados durante orquestração
  edital_file_id?: string;
  study_plan_id?: string;
  discipline_ids?: Record<string, bigint>; // nome → ID
  
  // Metadados
  created_at: string;
  errors: string[];
  warnings: string[];
}
```

---

## 📝 Implementação dos Agentes

### 1️⃣ EditalFileAgent

**Responsabilidade:** Criar registro do arquivo de edital processado

**Entrada:**
```typescript
{
  user_id: "uuid",
  edital_file_url: "storage URL do arquivo original",
  transcription_url: "storage URL do .txt", 
  json_url: "storage URL do JSON processado",
  processing_result: { /* JSON completo do edital */ }
}
```

**Prompt do Agente:**
```markdown
Você é o EditalFileAgent. Sua tarefa é criar um registro na tabela `edital_file`.

Use o MCP Supabase para executar:

INSERT INTO edital_file (
  user_id,
  edital_file_url,
  transcription_url,
  json_url,
  processing_result,
  edital_status
) VALUES (
  '{user_id}',
  '{edital_file_url}',
  '{transcription_url}',
  '{json_url}',
  '{processing_result_json}'::jsonb,
  'ready'
) RETURNING id;

Retorne o ID criado para o orchestrator.
```

---

### 2️⃣ StudyPlanAgent

**Responsabilidade:** Criar plano de estudo baseado nos dados do edital

**Contexto Necessário:**
- `edital_file_id` (do agente anterior)
- Metadata do primeiro concurso no JSON

**Prompt do Agente:**
```markdown
Você é o StudyPlanAgent. Analise o JSON do edital e crie um study_plan.

Extraia do JSON:
- concursos[0].metadata.examName → exam_name
- concursos[0].metadata.examOrg → exam_org  
- concursos[0].metadata.startDate → start_date

Use o MCP Supabase para executar:

INSERT INTO study_plans (
  user_id,
  edital_id,
  exam_name,
  exam_org,
  start_date,
  status,
  current_step
) VALUES (
  '{user_id}',
  '{edital_file_id}',
  '{exam_name}',
  '{exam_org}',
  '{start_date}',
  'processing',
  1
) RETURNING id;

Retorne o plan_id criado.
```

---

### 3️⃣ ExamsAgent

**Responsabilidade:** Criar registros de provas/fases do concurso

**Contexto Necessário:**
- `study_plan_id`
- Array `concursos[0].fases[]`

**Prompt do Agente:**
```markdown
Você é o ExamsAgent. Analise as fases do concurso e crie registros em `exams`.

Para cada item em `concursos[0].fases[]`:
- tipo → exam_type (mapeie: "objetiva", "discursiva", "pratica" → "prática", "oral")
- data → exam_date
- turno → exam_turn (mapeie: "manha", "tarde", "noite")
- totalQuestoes → total_questions (pode ser null)

Use o MCP Supabase para executar múltiplos INSERTs:

INSERT INTO exams (plan_id, exam_type, exam_date, exam_turn, total_questions)
VALUES
  ('{plan_id}', 'objetiva', '2025-04-27', 'tarde', 100),
  ('{plan_id}', 'discursiva', '2025-06-22', 'manha', 5),
  ...;

Confirme quantos registros foram criados.
```

---

### 4️⃣ DisciplinesAgent

**Responsabilidade:** Criar disciplinas e manter mapeamento nome → ID

**Contexto Necessário:**
- `study_plan_id`
- Array `concursos[0].disciplinas[]`

**Prompt do Agente:**
```markdown
Você é o DisciplinesAgent. Crie registros de disciplinas e retorne um mapa de IDs.

Para cada item em `concursos[0].disciplinas[]`:
- nome → name
- numeroQuestoes → number_of_questions
- Gere uma cor aleatória hex → color (ex: "#3B82F6")

Use o MCP Supabase para executar:

INSERT INTO disciplines (plan_id, name, color, number_of_questions)
VALUES
  ('{plan_id}', 'Direito Civil', '#3B82F6', 40),
  ('{plan_id}', 'Direito Penal', '#EF4444', 30),
  ...
RETURNING id, name;

Retorne um objeto mapeando nome → id:
{
  "Direito Civil": 123,
  "Direito Penal": 124,
  ...
}
```

---

### 5️⃣ TopicsAgent

**Responsabilidade:** Criar topics (matérias) vinculados às disciplinas

**Contexto Necessário:**
- `study_plan_id`
- `discipline_ids` (mapa do agente anterior)
- Array `concursos[0].disciplinas[].materias[]`

**Prompt do Agente:**
```markdown
Você é o TopicsAgent. Crie registros de topics para cada matéria.

Para cada disciplina em `concursos[0].disciplinas[]`:
1. Obtenha o discipline_id do mapa usando disciplinas[].nome
2. Para cada matéria em disciplinas[].materias[]:
   - nome → name
   - peso → weight (default 1.0, aceita 1.0, 1.5, 2.0)

Use o MCP Supabase para executar:

INSERT INTO topics (plan_id, discipline_id, name, weight)
VALUES
  ('{plan_id}', 123, 'Compreensão de textos', 1.0),
  ('{plan_id}', 123, 'Ortografia oficial', 1.0),
  ('{plan_id}', 124, 'Crimes contra a vida', 1.5),
  ...;

Confirme quantos topics foram criados.
```

---

## 🎼 Orchestrator Agent - Implementação

```typescript
// src/core/agents/edital-orchestrator.agent.ts

import Anthropic from '@anthropic-ai/sdk';
import logger from 'lib/logger';
import type { EditalProcessado } from '../services/editais/edital-schema';

interface OrchestrationInput {
  user_id: string;
  edital_json: EditalProcessado;
  edital_file_url: string;
  transcription_url?: string;
  json_url?: string;
}

interface OrchestrationResult {
  success: boolean;
  edital_file_id?: string;
  study_plan_id?: string;
  stats: {
    exams: number;
    disciplines: number;
    topics: number;
  };
  errors: string[];
  warnings: string[];
}

export class EditalOrchestratorAgent {
  private anthropic: Anthropic;
  
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }

  async orchestrate(input: OrchestrationInput): Promise<OrchestrationResult> {
    logger.info('[ORCHESTRATOR] Starting edital data orchestration', {
      user_id: input.user_id,
      concursos: input.edital_json.concursos.length,
    });

    const context: any = {
      user_id: input.user_id,
      edital_json: input.edital_json,
      original_url: input.edital_file_url,
      transcription_url: input.transcription_url || null,
      json_url: input.json_url || null,
      errors: [],
      warnings: [],
    };

    try {
      // FASE 1: EditalFileAgent
      logger.info('[ORCHESTRATOR] Phase 1: Creating edital_file record');
      context.edital_file_id = await this.executeAgent('EditalFileAgent', context, {
        task: 'create_edital_file',
        data: {
          user_id: input.user_id,
          edital_file_url: input.edital_file_url,
          transcription_url: input.transcription_url,
          json_url: input.json_url,
          processing_result: input.edital_json,
        },
      });

      // FASE 2: StudyPlanAgent
      logger.info('[ORCHESTRATOR] Phase 2: Creating study_plan');
      context.study_plan_id = await this.executeAgent('StudyPlanAgent', context, {
        task: 'create_study_plan',
        concurso: input.edital_json.concursos[0],
      });

      // FASE 3: ExamsAgent
      logger.info('[ORCHESTRATOR] Phase 3: Creating exams');
      const examsCount = await this.executeAgent('ExamsAgent', context, {
        task: 'create_exams',
        fases: input.edital_json.concursos[0].fases,
      });

      // FASE 4: DisciplinesAgent
      logger.info('[ORCHESTRATOR] Phase 4: Creating disciplines');
      context.discipline_ids = await this.executeAgent('DisciplinesAgent', context, {
        task: 'create_disciplines',
        disciplinas: input.edital_json.concursos[0].disciplinas,
      });

      // FASE 5: TopicsAgent
      logger.info('[ORCHESTRATOR] Phase 5: Creating topics');
      const topicsCount = await this.executeAgent('TopicsAgent', context, {
        task: 'create_topics',
        disciplinas: input.edital_json.concursos[0].disciplinas,
        discipline_ids: context.discipline_ids,
      });

      logger.info('[ORCHESTRATOR] ✅ Orchestration completed successfully', {
        edital_file_id: context.edital_file_id,
        study_plan_id: context.study_plan_id,
        exams: examsCount,
        disciplines: Object.keys(context.discipline_ids).length,
        topics: topicsCount,
      });

      return {
        success: true,
        edital_file_id: context.edital_file_id,
        study_plan_id: context.study_plan_id,
        stats: {
          exams: examsCount,
          disciplines: Object.keys(context.discipline_ids).length,
          topics: topicsCount,
        },
        errors: context.errors,
        warnings: context.warnings,
      };

    } catch (error) {
      logger.error('[ORCHESTRATOR] ❌ Orchestration failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        phase: 'unknown',
      });

      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        warnings: context.warnings,
        stats: {
          exams: 0,
          disciplines: 0,
          topics: 0,
        },
      };
    }
  }

  private async executeAgent(
    agentName: string,
    context: any,
    taskData: any
  ): Promise<any> {
    logger.info(`[${agentName}] Executing task`, { task: taskData.task });

    const systemPrompt = this.getAgentSystemPrompt(agentName);
    const userPrompt = this.buildUserPrompt(agentName, context, taskData);

    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const resultText = response.content[0].type === 'text' 
      ? response.content[0].text 
      : '';

    logger.info(`[${agentName}] Task completed`, { 
      resultLength: resultText.length,
    });

    // Parse result based on agent type
    return this.parseAgentResult(agentName, resultText);
  }

  private getAgentSystemPrompt(agentName: string): string {
    const prompts: Record<string, string> = {
      EditalFileAgent: `Você é o EditalFileAgent especializado em criar registros na tabela edital_file do Supabase.

Você tem acesso ao MCP Supabase e deve usar o comando execute_sql para inserir dados.

Sua resposta deve conter APENAS o SQL INSERT statement formatado para execução direta.

Exemplo de saída:
\`\`\`sql
INSERT INTO edital_file (user_id, edital_file_url, processing_result, edital_status)
VALUES ('uuid-aqui', 'url-aqui', '{"json":"aqui"}'::jsonb, 'ready')
RETURNING id;
\`\`\`

Retorne APENAS o SQL, sem explicações adicionais.`,

      StudyPlanAgent: `Você é o StudyPlanAgent especializado em criar planos de estudo baseados em editais processados.

Você tem acesso ao MCP Supabase e deve gerar SQL INSERT para a tabela study_plans.

Analise o JSON do edital fornecido e extraia:
- exam_name (do metadata.examName)
- exam_org (do metadata.examOrg)
- start_date (do metadata.startDate, formato YYYY-MM-DD)

Sua resposta deve conter APENAS o SQL INSERT statement.

Exemplo:
\`\`\`sql
INSERT INTO study_plans (user_id, edital_id, exam_name, exam_org, start_date, status, current_step)
VALUES ('uuid', 'edital-id', 'Concurso XYZ', 'Órgão ABC', '2025-04-27', 'processing', 1)
RETURNING id;
\`\`\``,

      ExamsAgent: `Você é o ExamsAgent especializado em criar registros de provas/fases.

Analise o array de fases fornecido e crie INSERT statements para a tabela exams.

Mapeamento de tipos:
- "objetiva" → 'objetiva'
- "discursiva" → 'discursiva'
- "pratica" ou "prática" → 'prática'
- "oral" → 'oral'

Mapeamento de turnos:
- "manha" → 'manha'
- "tarde" → 'tarde'
- "noite" → 'noite'
- outros → 'manha' (default)

Retorne SQL multi-row INSERT ou múltiplos INSERTs.`,

      DisciplinesAgent: `Você é o DisciplinesAgent especializado em criar disciplinas.

Analise o array de disciplinas e crie INSERT statements para a tabela disciplines.

Para cada disciplina:
- name: nome da disciplina (texto exato)
- number_of_questions: número de questões (inteiro)
- color: gere uma cor hex aleatória e vibrante

Retorne SQL com RETURNING id, name para criar o mapeamento.

Exemplo:
\`\`\`sql
INSERT INTO disciplines (plan_id, name, color, number_of_questions)
VALUES 
  ('plan-id', 'Direito Civil', '#3B82F6', 40),
  ('plan-id', 'Direito Penal', '#EF4444', 30)
RETURNING id, name;
\`\`\``,

      TopicsAgent: `Você é o TopicsAgent especializado em criar topics (matérias).

Analise as disciplinas e suas matérias. Para cada matéria, crie um registro em topics.

Use o mapeamento discipline_ids fornecido para obter o discipline_id correto.

Campo weight deve ser 1.0, 1.5 ou 2.0 (use peso da matéria ou 1.0 default).

Retorne SQL multi-row INSERT.

Exemplo:
\`\`\`sql
INSERT INTO topics (plan_id, discipline_id, name, weight)
VALUES
  ('plan-id', 123, 'Compreensão de textos', 1.0),
  ('plan-id', 123, 'Ortografia', 1.0),
  ('plan-id', 124, 'Crimes contra a vida', 1.5);
\`\`\``,
    };

    return prompts[agentName] || 'Agente não configurado';
  }

  private buildUserPrompt(agentName: string, context: any, taskData: any): string {
    // Construir prompt específico baseado no agente e dados
    const prompts: Record<string, string> = {
      EditalFileAgent: `Crie um registro em edital_file com os seguintes dados:

user_id: ${context.user_id}
edital_file_url: ${taskData.data.edital_file_url}
transcription_url: ${taskData.data.transcription_url || 'NULL'}
json_url: ${taskData.data.json_url || 'NULL'}
processing_result: ${JSON.stringify(taskData.data.processing_result)}

Gere o SQL INSERT e retorne APENAS o SQL.`,

      StudyPlanAgent: `Crie um study_plan usando os dados do edital:

user_id: ${context.user_id}
edital_id: ${context.edital_file_id}

Metadados do concurso:
${JSON.stringify(taskData.concurso.metadata, null, 2)}

Extraia exam_name, exam_org e start_date. Gere o SQL INSERT.`,

      ExamsAgent: `Crie registros de exams para o plan_id: ${context.study_plan_id}

Fases do concurso:
${JSON.stringify(taskData.fases, null, 2)}

Para cada fase, crie um INSERT. Retorne o SQL completo.`,

      DisciplinesAgent: `Crie registros de disciplines para o plan_id: ${context.study_plan_id}

Disciplinas:
${JSON.stringify(taskData.disciplinas.map((d: any) => ({
  nome: d.nome,
  numeroQuestoes: d.numeroQuestoes,
})), null, 2)}

Gere cores hex vibrantes para cada disciplina. Retorne SQL com RETURNING id, name.`,

      TopicsAgent: `Crie registros de topics para o plan_id: ${context.study_plan_id}

Mapeamento de discipline_ids:
${JSON.stringify(taskData.discipline_ids, null, 2)}

Disciplinas com matérias:
${JSON.stringify(taskData.disciplinas.map((d: any) => ({
  nome: d.nome,
  materias: d.materias.map((m: any) => ({
    nome: m.nome,
    peso: m.peso || 1.0,
  })),
})), null, 2)}

Para cada matéria, use o discipline_id correspondente do mapa. Gere o SQL INSERT.`,
    };

    return prompts[agentName] || 'Prompt não configurado';
  }

  private parseAgentResult(agentName: string, resultText: string): any {
    // Extrair SQL do resultado
    const sqlMatch = resultText.match(/```sql\s*([\s\S]*?)\s*```/);
    const sql = sqlMatch ? sqlMatch[1].trim() : resultText.trim();

    logger.debug(`[${agentName}] Extracted SQL`, { sql });

    // TODO: Executar SQL via MCP Supabase
    // Por enquanto, retornar mock data baseado no agente
    
    if (agentName === 'EditalFileAgent') {
      return 'uuid-edital-file-id'; // Mock
    }
    if (agentName === 'StudyPlanAgent') {
      return 'uuid-study-plan-id'; // Mock
    }
    if (agentName === 'ExamsAgent') {
      return 4; // Mock: 4 exams criados
    }
    if (agentName === 'DisciplinesAgent') {
      return {
        'Direito Civil': 1,
        'Direito Penal': 2,
        'Direito Administrativo': 3,
      }; // Mock
    }
    if (agentName === 'TopicsAgent') {
      return 25; // Mock: 25 topics criados
    }

    return null;
  }
}

export const editalOrchestratorAgent = new EditalOrchestratorAgent();
```

---

## 🧪 Teste E2E com Agente Orquestrador

```typescript
// test/e2e-orchestrator.test.ts

import { editalOrchestratorAgent } from '../src/core/agents/edital-orchestrator.agent';
import fs from 'node:fs';
import path from 'node:path';

const TEST_USER_ID = '98d8b11a-8a32-4f6b-9dae-6e42efa23116';
const EDITAL_JSON_PATH = path.join(__dirname, '../temp/editais-json/edital juiz sc.json');

async function testOrchestratorE2E() {
  console.log('\n🤖 TESTE E2E: Orchestrator Agent\n');

  // Carregar JSON de teste
  const editalJson = JSON.parse(fs.readFileSync(EDITAL_JSON_PATH, 'utf-8'));

  console.log('📋 Edital carregado:');
  console.log(`   • Nome: ${editalJson.concursos[0].metadata.examName}`);
  console.log(`   • Órgão: ${editalJson.concursos[0].metadata.examOrg}`);
  console.log(`   • Disciplinas: ${editalJson.concursos[0].disciplinas.length}`);
  console.log(`   • Matérias: ${editalJson.validacao.totalMaterias}\n`);

  // Executar orquestração
  console.log('🚀 Iniciando orquestração...\n');
  
  const result = await editalOrchestratorAgent.orchestrate({
    user_id: TEST_USER_ID,
    edital_json: editalJson,
    edital_file_url: 'https://example.com/edital.pdf',
    json_url: 'https://example.com/edital.json',
  });

  console.log('\n📊 Resultado da Orquestração:');
  console.log(`   • Sucesso: ${result.success ? '✅' : '❌'}`);
  console.log(`   • Edital File ID: ${result.edital_file_id}`);
  console.log(`   • Study Plan ID: ${result.study_plan_id}`);
  console.log(`   • Exames criados: ${result.stats.exams}`);
  console.log(`   • Disciplinas criadas: ${result.stats.disciplines}`);
  console.log(`   • Topics criados: ${result.stats.topics}`);
  
  if (result.errors.length > 0) {
    console.log(`\n❌ Erros (${result.errors.length}):`);
    result.errors.forEach(err => console.log(`   • ${err}`));
  }
  
  if (result.warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${result.warnings.length}):`);
    result.warnings.forEach(warn => console.log(`   • ${warn}`));
  }

  console.log('\n✅ Teste concluído!\n');
}

testOrchestratorE2E().catch(console.error);
```

---

## 🎯 Próximos Passos

### 1. Integrar MCP Supabase Real

Substituir os mocks em `parseAgentResult()` por chamadas reais ao MCP:

```typescript
import { mcp_supabase_execute_sql } from '../mcp/supabase';

// Em parseAgentResult()
const result = await mcp_supabase_execute_sql({ query: sql });
```

### 2. Tratar Erros de Forma Resiliente

```typescript
try {
  const result = await mcp_supabase_execute_sql({ query: sql });
  return parseResult(result);
} catch (error) {
  context.errors.push(`${agentName} failed: ${error.message}`);
  return null; // Continuar com outros agentes
}
```

### 3. Implementar Retry Logic

```typescript
async function executeWithRetry(fn: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
}
```

### 4. Adicionar Logs Detalhados

```typescript
logger.debug('[Agent] SQL Generated', { agent: agentName, sql });
logger.debug('[Agent] SQL Result', { agent: agentName, result });
```

---

## 💡 Vantagens desta Arquitetura

✅ **Flexível** - Agentes interpretam contexto, não dependem de regex rígidos  
✅ **Resiliente** - Falha em um agente não quebra todo o fluxo  
✅ **Extensível** - Fácil adicionar novos agentes (ex: CyclesAgent, ScheduleAgent)  
✅ **Testável** - Cada agente pode ser testado isoladamente  
✅ **Observável** - Logs detalhados em cada fase  
✅ **Inteligente** - IA adapta-se a variações no JSON automaticamente

---

**Autor:** GitHub Copilot  
**Data:** 17 de Outubro de 2025  
**Status:** 🚧 Pronto para Implementação
