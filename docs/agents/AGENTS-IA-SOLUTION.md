# 🤖 Solução: Agentes IA para Inserção Inteligente de Editais

## 📋 Resumo Executivo

Sistema de **orquestração inteligente de agentes IA** que transforma JSONs de editais processados em registros estruturados no Supabase, usando **Model Context Protocol (MCP)** para comunicação direta com o banco de dados.

### ✨ Por que Agentes IA?

❌ **Abordagem antiga (não funciona):**
```typescript
// Código rígido com validações de regex
if (json.metadata.startDate !== /^\d{4}-\d{2}-\d{2}$/) throw Error;
// ❌ Quebra quando IA muda formato
// ❌ Não adapta a variações no JSON
// ❌ Manutenção difícil
```

✅ **Nova abordagem (funciona):**
```typescript
// Agente IA interpreta contexto
"Extraia a data da prova do metadata e formate como YYYY-MM-DD"
// ✅ Adapta-se a mudanças
// ✅ Entende contexto semanticamente
// ✅ Resiliente a variações
```

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                  ORCHESTRATOR AGENT                          │
│  "Coordenador Mestre" - Delega tarefas e mantém contexto    │
└─────────────────────────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┬───────────────┐
         │               │               │               │
    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
    │ Edital  │    │  Study  │    │  Exams  │    │Disciplines│
    │  File   │───▶│  Plan   │───▶│  Agent  │───▶│  Agent   │
    │ Agent   │    │ Agent   │    │         │    │          │
    └─────────┘    └─────────┘    └─────────┘    └────┬─────┘
                                                        │
                                                   ┌────▼────┐
                                                   │ Topics  │
                                                   │ Agent   │
                                                   └─────────┘
```

### Fluxo de Dados

```typescript
// 1. JSON de entrada (flexível)
{
  "concursos": [{
    "metadata": { "examName": "...", "startDate": "..." },
    "disciplinas": [{ "nome": "...", "materias": [...] }]
  }]
}

// 2. Orchestrator coordena
context = {
  user_id, edital_json, 
  edital_file_id?, study_plan_id?, discipline_ids?
}

// 3. Cada agente gera SQL dinamicamente
EditalFileAgent → "INSERT INTO edital_file ..."
StudyPlanAgent → "INSERT INTO study_plans ..."
...

// 4. Resultado
{
  success: true,
  edital_file_id: "uuid",
  study_plan_id: "uuid",
  stats: { exams: 4, disciplines: 10, topics: 87 }
}
```

---

## 🚀 Como Usar

### 1. Configuração do MCP Supabase

Adicione ao seu `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--project-ref=kqhrhafgnoxbgjtvkomx"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "sbp_e393c75e77d0e0d18d9212c5c82eada77ce12564"
      }
    }
  }
}
```

### 2. Instalar Dependências

```bash
bun install @anthropic-ai/sdk
```

### 3. Configurar Variável de Ambiente

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

### 4. Usar o Orchestrator

```typescript
import { editalOrchestratorAgent } from './src/core/agents/edital-orchestrator.agent';

const result = await editalOrchestratorAgent.orchestrate({
  user_id: '98d8b11a-8a32-4f6b-9dae-6e42efa23116',
  edital_json: processedEdital, // JSON do edital-process
  edital_file_url: 'https://storage.../edital.pdf',
  json_url: 'https://storage.../edital.json',
  transcription_url: 'https://storage.../edital.txt',
});

if (result.success) {
  console.log('✅ Edital inserido no banco!');
  console.log('Study Plan ID:', result.study_plan_id);
  console.log('Stats:', result.stats);
}
```

### 5. Executar Teste E2E

```bash
# Testar com editais reais
bun run test/e2e-orchestrator.test.ts

# Saída esperada:
# ✅ edital juiz sc.json → 3 disciplinas, 14 matérias
# ✅ edital ENAC.json → 10 disciplinas, 103 matérias
# ✅ edital MPRS.json → 2 disciplinas, 21 matérias
```

---

## 📊 Schema do Banco (Real via MCP)

```sql
-- Hierarquia de tabelas
edital_file (id: uuid)
  ├─ processing_result: jsonb (JSON completo)
  ├─ json_url: text
  └─ transcription_url: text

study_plans (id: uuid)
  ├─ edital_id → edital_file.id
  ├─ exam_name, exam_org, start_date
  └─ status: 'processing' | 'ready'

exams (sem PK, múltiplas provas por plano)
  ├─ plan_id → study_plans.id
  ├─ exam_type: 'objetiva' | 'discursiva' | 'prática' | 'oral'
  └─ exam_date, exam_turn, total_questions

disciplines (id: bigint auto-increment)
  ├─ plan_id → study_plans.id
  ├─ name, color, number_of_questions
  └─ usado para agrupar topics

topics (id: bigint auto-increment)
  ├─ plan_id → study_plans.id
  ├─ discipline_id → disciplines.id
  ├─ name, weight (1.0 | 1.5 | 2.0)
  └─ representa cada matéria do edital
```

---

## 🎯 Vantagens da Solução

### 1. **Flexibilidade**
```typescript
// IA adapta-se automaticamente
// Funciona com qualquer variação do JSON
"A data está em metadata.startDate ou metadata.examDate? Não importa!"
```

### 2. **Resiliência**
```typescript
// Se um agente falha, outros continuam
try {
  await DisciplinesAgent.execute();
} catch {
  context.warnings.push('Disciplines failed, continuing...');
  // Processo continua!
}
```

### 3. **Extensibilidade**
```typescript
// Fácil adicionar novos agentes
class CyclesPerDowAgent { /* INSERT em cycles_per_dow */ }
class ExceptionPeriodsAgent { /* INSERT em exception_periods */ }
```

### 4. **Observabilidade**
```typescript
// Logs detalhados em cada fase
logger.info('[EditalFileAgent] Creating record...');
logger.info('[StudyPlanAgent] Extracting metadata...');
logger.info('[DisciplinesAgent] Generated 10 colors...');
```

### 5. **Testabilidade**
```typescript
// Cada agente é testável isoladamente
test('EditalFileAgent generates valid SQL', async () => {
  const sql = await agent.generateSQL(mockData);
  expect(sql).toContain('INSERT INTO edital_file');
});
```

---

## 🔧 Customização

### Adicionar Novo Agente

```typescript
// 1. Definir responsabilidade
class MyNewAgent {
  async execute(context: AgentContext): Promise<any> {
    // Lógica do agente
  }
}

// 2. Criar system prompt
const systemPrompt = `
Você é o MyNewAgent.
Sua tarefa: ...
Retorne: SQL INSERT statement
`;

// 3. Adicionar ao orchestrator
// Em EditalOrchestratorAgent.orchestrate()
const result = await this.executeMyNewAgent(context);
```

### Modificar Prompts

```typescript
// Em edital-orchestrator.agent.ts
private getAgentSystemPrompt(agentName: string): string {
  return `
    Você é o ${agentName}.
    
    Regras:
    - Seja preciso
    - Gere SQL válido
    - Retorne APENAS SQL
    
    Exemplo: ...
  `;
}
```

### Integrar MCP Real

```typescript
// Substituir mocks por chamadas reais
import { mcp_supabase_execute_sql } from '../mcp/supabase';

// Em parseAgentResult()
const result = await mcp_supabase_execute_sql({ 
  query: sql 
});

// Parsear resultado baseado no agent
if (agentName === 'StudyPlanAgent') {
  return result.rows[0].id; // UUID do study_plan criado
}
```

---

## 📚 Documentação Adicional

- **`AI-ORCHESTRATOR-EDITAL-TO-DB.md`** - Arquitetura completa dos agentes
- **`E2E-EDITAL-PROCESS-GUIDE.md`** - Fluxo end-to-end atualizado
- **`edital-orchestrator.agent.ts`** - Implementação do orchestrator
- **`e2e-orchestrator.test.ts`** - Teste E2E com editais reais

---

## ⚡ Quick Start

```bash
# 1. Clonar e instalar
git clone <repo>
cd adsCombine
bun install

# 2. Configurar variáveis
export ANTHROPIC_API_KEY="..."
export SUPABASE_URL="https://kqhrhafgnoxbgjtvkomx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."

# 3. Executar teste
bun run test/e2e-orchestrator.test.ts

# 4. Ver resultados
# ✅ 3 editais testados
# ✅ 15 disciplinas criadas
# ✅ 138 topics criados
```

---

## 🎓 Conceitos-Chave

### Agente vs Função
```typescript
// ❌ Função rígida
function insertDiscipline(data) {
  if (!data.name) throw Error;
  db.insert({ name: data.name }); // Quebra se schema mudar
}

// ✅ Agente flexível
class DisciplineAgent {
  async execute(context) {
    const sql = await ai.generate(`
      Analise os dados e crie SQL INSERT para disciplines.
      Dados: ${JSON.stringify(context.data)}
    `);
    return db.execute(sql); // Adapta-se a mudanças
  }
}
```

### Orquestração vs Sequência
```typescript
// ❌ Sequência simples (frágil)
await step1();
await step2(); // Se step1 falhar, para tudo
await step3();

// ✅ Orquestração (resiliente)
const orchestrator = new Orchestrator();
await orchestrator.execute([
  { agent: Agent1, required: true },
  { agent: Agent2, required: false }, // Pode falhar
  { agent: Agent3, dependsOn: [Agent1] },
]);
```

### Contexto Compartilhado
```typescript
// Contexto flui entre agentes
interface Context {
  user_id: string;
  edital_json: any;
  
  // Preenchido durante orquestração
  edital_file_id?: string;   // ← Agent 1 cria
  study_plan_id?: string;    // ← Agent 2 usa
  discipline_ids?: Record<string, number>; // ← Agent 4 cria, Agent 5 usa
}
```

---

## 🚦 Status do Projeto

- ✅ **Orchestrator Agent** - Implementado
- ✅ **5 Sub-Agentes** - Implementados com prompts
- ✅ **Teste E2E** - Pronto para rodar
- 🚧 **Integração MCP Real** - Mocks prontos, aguardando MCP ativo
- 🚧 **Tratamento de Erros** - Básico implementado, melhorias planejadas
- 📋 **Retry Logic** - A implementar
- 📋 **Monitoring/Metrics** - A implementar

---

## 💡 Próximos Passos

1. **Ativar MCP Supabase** e substituir mocks
2. **Testar com editais reais** em ambiente de dev
3. **Adicionar retry logic** para resiliência
4. **Implementar agentes adicionais** (cycles, schedules, etc)
5. **Criar dashboard** de monitoramento de agentes
6. **Deploy em produção** com observabilidade completa

---

**Autor:** GitHub Copilot + Paulo Chaves  
**Data:** 17 de Outubro de 2025  
**Versão:** 1.0.0  
**Status:** 🚀 Ready for Implementation
