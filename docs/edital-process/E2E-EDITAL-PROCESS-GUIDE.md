# ## 🎯 Objetivo

Este documento fornece instruções completas para fazer o teste e2e do **edital-process** funcionar do início ao fim, usando **Agentes IA Orquestrados** para inserção inteligente de dados no Supabase via MCP.

## 🔑 Dados de Teste

```typescript
user_id: "98d8b11a-8a32-4f6b-9dae-6e42efa23116"
url: "https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/98d8b11a-8a32-4f6b-9dae-6e42efa23116/51955178-d788-491d-8dae-3537417d7553.txt"
```

## � Nova Abordagem: Agentes IA com MCP

**Mudança importante:** Ao invés de código rígido com validações de schema, agora usamos **Agentes IA Inteligentes** que:
- ✅ Interpretam JSONs semanticamente (sem regex rígidos)
- ✅ Adaptam-se a mudanças na estrutura do JSON
- ✅ Usam MCP Supabase para inserção direta
- ✅ Orquestram inserções sequenciais respeitando dependências

📚 **Documentação completa:** Ver `AI-ORCHESTRATOR-EDITAL-TO-DB.md`

---leto: Teste E2E do Edital Process

## 📋 Objetivo

Este documento fornece instruções completas para fazer o teste e2e do **edital-process** funcionar do início ao fim, incluindo a inserção de dados no Supabase.

## 🔑 Dados de Teste

```typescript
user_id: "98d8b11a-8a32-4f6b-9dae-6e42efa23116"
url: "https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/98d8b11a-8a32-4f6b-9dae-6e42efa23116/51955178-d788-491d-8dae-3537417d7553.txt"
```

---

## 🎯 Fluxo Completo do Edital-Process

```
┌─────────────────────────────────────────────────────────────────┐
│                    EDITAL PROCESSING PIPELINE                    │
└─────────────────────────────────────────────────────────────────┘

1️⃣  RECEPÇÃO DO REQUEST
    ├─ Entrada: { user_id, schedule_plan_id, url, options }
    ├─ Gera jobId único (UUID)
    └─ Cria estrutura de diretórios: /public/{user_id}/{schedule_plan_id}/
    
2️⃣  CRIAÇÃO DO ARQUIVO DE STATUS
    ├─ Cria arquivo JSON com status "processing"
    ├─ Salva jobId e timestamp de início
    └─ Retorna resposta imediata ao cliente com filePath público
    
3️⃣  PROCESSAMENTO EM BACKGROUND (assíncrono)
    │
    ├─ 📥 STEP 1: Fetch do Conteúdo
    │   ├─ GET na URL do edital (Supabase Storage)
    │   ├─ Retry logic: até 3 tentativas com backoff exponencial
    │   ├─ Timeout: 30 segundos por tentativa
    │   └─ Valida: content-type, tamanho (max 50MB)
    │
    ├─ 📊 STEP 2: Análise do Tamanho
    │   ├─ Calcula: chars, tokens estimados (~chars/4)
    │   ├─ Contexto: Claude Sonnet 4.5 = 200K tokens
    │   └─ Decisão: NO chunking needed (editais ~45K tokens)
    │
    ├─ 🤖 STEP 3: Processamento com Claude AI
    │   ├─ Model: claude-3-5-sonnet-20241022
    │   ├─ Streaming: previne timeout em processamentos longos
    │   ├─ Temperature: 0 (máxima precisão estrutural)
    │   ├─ System Prompt: extração estruturada JSON
    │   └─ Output: EditalProcessado (concursos, disciplinas, matérias)
    │
    ├─ 🔍 STEP 4: Validação do Schema
    │   ├─ Parse: JSON.parse() com cleanup de markdown
    │   ├─ Validate: Zod Schema (EditalProcessadoSchema)
    │   ├─ Integrity Check: soma questões, campos obrigatórios
    │   └─ Result: validacao { erros[], avisos[], integridadeOK }
    │
    └─ 💾 STEP 5: Persistência
        ├─ Adiciona metadata de processamento
        ├─ Salva JSON final no mesmo arquivo
        └─ Logging completo: stats, tempo, resultado

4️⃣  **INSERÇÃO NO SUPABASE via Agentes IA**
    │
    ├─ 🤖 Orchestrator Agent
    │   ├─ Coordena 5 sub-agentes especializados
    │   ├─ Mantém contexto compartilhado
    │   └─ Gerencia dependências e ordem de execução
    │
    ├─ 1️⃣ EditalFileAgent
    │   └─ INSERT em edital_file (armazena JSON completo + URLs)
    │
    ├─ 2️⃣ StudyPlanAgent
    │   └─ INSERT em study_plans (vinculado ao edital_file)
    │
    ├─ 3️⃣ ExamsAgent
    │   └─ INSERT em exams (fases/provas do concurso)
    │
    ├─ 4️⃣ DisciplinesAgent
    │   ├─ INSERT em disciplines
    │   └─ Retorna mapeamento nome → ID
    │
    └─ 5️⃣ TopicsAgent
        ├─ INSERT em topics (matérias de cada disciplina)
        └─ Usa mapeamento do agente anterior

5️⃣  FINALIZAÇÃO
    ├─ Logs completos de todo o processo
    ├─ Métricas: tempo total, tokens usados, dados extraídos
    └─ Arquivo JSON disponível via API/Storage
```

---

## 🗄️ Estrutura do Banco de Dados (Supabase)

### Schema Esperado

```sql
-- Tabela de usuários (já existe no Supabase Auth)
auth.users
  ├─ id (UUID) PRIMARY KEY
  └─ ...

-- Planos de estudo
schedule_plans
  ├─ id (UUID) PRIMARY KEY
  ├─ user_id (UUID) FOREIGN KEY → auth.users(id)
  ├─ name (TEXT)
  ├─ created_at (TIMESTAMP)
  └─ updated_at (TIMESTAMP)

-- Editais processados
editals
  ├─ id (UUID) PRIMARY KEY
  ├─ user_id (UUID) FOREIGN KEY → auth.users(id)
  ├─ schedule_plan_id (UUID) FOREIGN KEY → schedule_plans(id)
  ├─ original_url (TEXT) -- URL do arquivo .txt
  ├─ file_path (TEXT) -- Caminho público do JSON
  ├─ job_id (UUID)
  ├─ status (TEXT) -- 'processing', 'completed', 'error'
  ├─ processed_at (TIMESTAMP)
  └─ metadata (JSONB) -- stats do processamento

-- Concursos/Exames extraídos
exams
  ├─ id (UUID) PRIMARY KEY
  ├─ edital_id (UUID) FOREIGN KEY → editals(id)
  ├─ name (TEXT) -- metadata.examName
  ├─ organization (TEXT) -- metadata.examOrg
  ├─ cargo (TEXT)
  ├─ area (TEXT)
  ├─ exam_date (DATE) -- metadata.startDate
  ├─ exam_turn (TEXT)
  ├─ total_questions (INTEGER)
  └─ metadata (JSONB)

-- Disciplinas
disciplines
  ├─ id (UUID) PRIMARY KEY
  ├─ exam_id (UUID) FOREIGN KEY → exams(id)
  ├─ name (TEXT)
  ├─ number_of_questions (INTEGER)
  ├─ weight (NUMERIC)
  └─ notes (TEXT)

-- Matérias/Assuntos
subjects
  ├─ id (UUID) PRIMARY KEY
  ├─ discipline_id (UUID) FOREIGN KEY → disciplines(id)
  ├─ name (TEXT)
  ├─ order (INTEGER)
  ├─ subtopics (TEXT[])
  ├─ bibliography (TEXT)
  └─ notes (TEXT)

-- Legislações
legislations
  ├─ id (UUID) PRIMARY KEY
  ├─ subject_id (UUID) FOREIGN KEY → subjects(id)
  ├─ type (TEXT) -- 'lei', 'decreto', etc
  ├─ number (TEXT)
  ├─ year (TEXT)
  ├─ name (TEXT)
  └─ complement (TEXT)
```

---

## 🚀 Passos para Implementação do Teste E2E Completo

### Fase 1: Preparação do Ambiente

```bash
# 1. Verificar variáveis de ambiente
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY
echo $ANTHROPIC_API_KEY

# 2. Instalar dependências
bun install @supabase/supabase-js
```

### Fase 2: Criar Tabelas no Supabase

```sql
-- Execute no SQL Editor do Supabase Dashboard

-- 1. Tabela schedule_plans
CREATE TABLE IF NOT EXISTS schedule_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabela editals
CREATE TABLE IF NOT EXISTS editals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schedule_plan_id UUID NOT NULL REFERENCES schedule_plans(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,
  file_path TEXT,
  job_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'error')),
  processed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabela exams
CREATE TABLE IF NOT EXISTS exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edital_id UUID NOT NULL REFERENCES editals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  organization TEXT NOT NULL,
  cargo TEXT,
  area TEXT,
  exam_date DATE,
  exam_turn TEXT,
  total_questions INTEGER NOT NULL CHECK (total_questions >= 1),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tabela disciplines
CREATE TABLE IF NOT EXISTS disciplines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  number_of_questions INTEGER NOT NULL DEFAULT 0,
  weight NUMERIC DEFAULT 1.0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Tabela subjects
CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  subtopics TEXT[] DEFAULT '{}',
  bibliography TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Tabela legislations
CREATE TABLE IF NOT EXISTS legislations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('lei', 'decreto', 'decreto_lei', 'resolucao', 'portaria', 'instrucao_normativa', 'sumula')),
  number TEXT NOT NULL,
  year TEXT,
  name TEXT NOT NULL,
  complement TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_editals_user_id ON editals(user_id);
CREATE INDEX IF NOT EXISTS idx_editals_schedule_plan_id ON editals(schedule_plan_id);
CREATE INDEX IF NOT EXISTS idx_editals_job_id ON editals(job_id);
CREATE INDEX IF NOT EXISTS idx_exams_edital_id ON exams(edital_id);
CREATE INDEX IF NOT EXISTS idx_disciplines_exam_id ON disciplines(exam_id);
CREATE INDEX IF NOT EXISTS idx_subjects_discipline_id ON subjects(discipline_id);
CREATE INDEX IF NOT EXISTS idx_legislations_subject_id ON legislations(subject_id);

-- RLS Policies (Row Level Security)
ALTER TABLE schedule_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE editals ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE legislations ENABLE ROW LEVEL SECURITY;

-- Policies para schedule_plans
CREATE POLICY "Users can view own schedule plans" ON schedule_plans
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own schedule plans" ON schedule_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own schedule plans" ON schedule_plans
  FOR UPDATE USING (auth.uid() = user_id);

-- Policies para editals
CREATE POLICY "Users can view own editals" ON editals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own editals" ON editals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own editals" ON editals
  FOR UPDATE USING (auth.uid() = user_id);

-- Policies para exams (através de editals)
CREATE POLICY "Users can view own exams" ON exams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM editals WHERE editals.id = exams.edital_id AND editals.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own exams" ON exams
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM editals WHERE editals.id = exams.edital_id AND editals.user_id = auth.uid()
    )
  );

-- Policies semelhantes para disciplines, subjects, legislations
-- (Implementar conforme necessário)
```

### Fase 3: Criar Serviço de Persistência no Supabase

Criar arquivo: `src/core/services/editais/edital-database.service.ts`

```typescript
import { createClient } from '@supabase/supabase-js';
import type { EditalProcessado } from './edital-schema';
import logger from 'lib/logger';

export interface EditalDatabaseRequest {
  user_id: string;
  schedule_plan_id: string;
  job_id: string;
  original_url: string;
  file_path: string;
  processedData: EditalProcessado;
}

export class EditalDatabaseService {
  private supabase;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async persistEdital(request: EditalDatabaseRequest): Promise<void> {
    const { user_id, schedule_plan_id, job_id, original_url, file_path, processedData } = request;

    try {
      logger.info('[EDITAL-DB] Starting database persistence', { job_id, user_id });

      // 1. Criar/verificar schedule_plan
      const { data: schedulePlan, error: schedulePlanError } = await this.supabase
        .from('schedule_plans')
        .select('id')
        .eq('id', schedule_plan_id)
        .single();

      if (schedulePlanError && schedulePlanError.code === 'PGRST116') {
        // Schedule plan não existe, criar um
        const { error: insertError } = await this.supabase
          .from('schedule_plans')
          .insert({
            id: schedule_plan_id,
            user_id,
            name: `Plano de Estudo ${new Date().toLocaleDateString('pt-BR')}`,
          });

        if (insertError) {
          throw new Error(`Failed to create schedule_plan: ${insertError.message}`);
        }
        logger.info('[EDITAL-DB] Created new schedule_plan', { schedule_plan_id });
      }

      // 2. Criar registro do edital
      const { data: edital, error: editalError } = await this.supabase
        .from('editals')
        .insert({
          user_id,
          schedule_plan_id,
          original_url,
          file_path,
          job_id,
          status: 'completed',
          processed_at: new Date().toISOString(),
          metadata: {
            totalConcursos: processedData.concursos.length,
            totalDisciplinas: processedData.validacao.totalDisciplinas,
            totalQuestoes: processedData.validacao.totalQuestoes,
            integridadeOK: processedData.validacao.integridadeOK,
          },
        })
        .select()
        .single();

      if (editalError) {
        throw new Error(`Failed to create edital: ${editalError.message}`);
      }

      const editalId = edital.id;
      logger.info('[EDITAL-DB] Created edital record', { edital_id: editalId });

      // 3. Inserir concursos/exames
      for (const concurso of processedData.concursos) {
        const { data: exam, error: examError } = await this.supabase
          .from('exams')
          .insert({
            edital_id: editalId,
            name: concurso.metadata.examName,
            organization: concurso.metadata.examOrg,
            cargo: concurso.metadata.cargo || null,
            area: concurso.metadata.area || null,
            exam_date: concurso.metadata.startDate || null,
            exam_turn: concurso.metadata.examTurn || 'nao_especificado',
            total_questions: concurso.metadata.totalQuestions,
            metadata: {
              notaMinimaAprovacao: concurso.metadata.notaMinimaAprovacao,
              notaMinimaEliminatoria: concurso.metadata.notaMinimaEliminatoria,
              criteriosEliminatorios: concurso.metadata.criteriosEliminatorios,
              notes: concurso.metadata.notes,
            },
          })
          .select()
          .single();

        if (examError) {
          logger.error('[EDITAL-DB] Failed to insert exam', { error: examError.message });
          continue;
        }

        const examId = exam.id;
        logger.info('[EDITAL-DB] Created exam', { exam_id: examId, name: concurso.metadata.examName });

        // 4. Inserir disciplinas
        for (const disciplina of concurso.disciplinas) {
          const { data: discipline, error: disciplineError } = await this.supabase
            .from('disciplines')
            .insert({
              exam_id: examId,
              name: disciplina.nome,
              number_of_questions: disciplina.numeroQuestoes,
              weight: disciplina.peso || 1.0,
              notes: disciplina.observacoes || null,
            })
            .select()
            .single();

          if (disciplineError) {
            logger.error('[EDITAL-DB] Failed to insert discipline', { error: disciplineError.message });
            continue;
          }

          const disciplineId = discipline.id;

          // 5. Inserir matérias
          for (const materia of disciplina.materias) {
            const { data: subject, error: subjectError } = await this.supabase
              .from('subjects')
              .insert({
                discipline_id: disciplineId,
                name: materia.nome,
                order: materia.ordem,
                subtopics: materia.subtopicos || [],
                bibliography: materia.bibliografia || null,
                notes: materia.observacoes || null,
              })
              .select()
              .single();

            if (subjectError) {
              logger.error('[EDITAL-DB] Failed to insert subject', { error: subjectError.message });
              continue;
            }

            const subjectId = subject.id;

            // 6. Inserir legislações
            if (materia.legislacoes && materia.legislacoes.length > 0) {
              const legislationsToInsert = materia.legislacoes.map(leg => ({
                subject_id: subjectId,
                type: leg.tipo,
                number: leg.numero,
                year: leg.ano || null,
                name: leg.nome,
                complement: leg.complemento || null,
              }));

              const { error: legislationError } = await this.supabase
                .from('legislations')
                .insert(legislationsToInsert);

              if (legislationError) {
                logger.error('[EDITAL-DB] Failed to insert legislations', { error: legislationError.message });
              }
            }
          }
        }
      }

      logger.info('[EDITAL-DB] Database persistence completed successfully', { 
        edital_id: editalId,
        job_id,
        totalConcursos: processedData.concursos.length,
      });

    } catch (error) {
      logger.error('[EDITAL-DB] Critical error during database persistence', {
        error: error instanceof Error ? error.message : 'Unknown error',
        job_id,
      });
      throw error;
    }
  }
}

export const editalDatabaseService = new EditalDatabaseService();
```

### Fase 4: Integrar Persistência ao Edital Process Service

Modificar `src/core/services/editais/edital-process.service.ts`:

```typescript
// Adicionar no topo do arquivo
import { editalDatabaseService } from './edital-database.service';

// No método processInBackground, após salvar o JSON (Step 7), adicionar:

// Step 8: Persist to Supabase
logger.info('[EDITAL-BG] 💽 Step 8/8: Persisting to Supabase', { jobId });
try {
  await editalDatabaseService.persistEdital({
    user_id,
    schedule_plan_id,
    job_id: jobId,
    original_url: url,
    file_path: outputPath,
    processedData: finalOutput,
  });
  logger.info('[EDITAL-BG] ✅ Database persistence completed', { jobId });
} catch (dbError) {
  logger.error('[EDITAL-BG] ⚠️  Database persistence failed (file saved successfully)', {
    error: dbError instanceof Error ? dbError.message : 'Unknown error',
    jobId,
  });
  // Não falhar o processo inteiro se apenas o DB falhar
  // O JSON já foi salvo com sucesso
}
```

### Fase 5: Criar e Executar Teste E2E

Criar arquivo: `test/e2e-edital-complete.test.ts`

```typescript
#!/usr/bin/env bun
/**
 * TESTE E2E COMPLETO - Edital Process + Database Persistence
 */

import { EditalProcessService } from '../src/core/services/editais/edital-process.service';

const TEST_USER_ID = '98d8b11a-8a32-4f6b-9dae-6e42efa23116';
const TEST_URL = 'https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/98d8b11a-8a32-4f6b-9dae-6e42efa23116/51955178-d788-491d-8dae-3537417d7553.txt';

async function runCompleteE2E() {
  console.log('\n🎯 E2E TEST: Complete Edital Process + Database');
  console.log('================================================\n');

  const service = new EditalProcessService();

  // Gerar schedule_plan_id para o teste
  const schedule_plan_id = 'e2e-test-' + Date.now();

  console.log('📝 Test Parameters:');
  console.log(`   user_id: ${TEST_USER_ID}`);
  console.log(`   schedule_plan_id: ${schedule_plan_id}`);
  console.log(`   url: ${TEST_URL}\n`);

  try {
    // Executar processamento completo
    console.log('🚀 Starting edital processing...\n');
    const response = await service.execute({
      user_id: TEST_USER_ID,
      schedule_plan_id,
      url: TEST_URL,
      options: {
        validateSchema: true,
      },
    });

    console.log('✅ Immediate response received:');
    console.log(`   filePath: ${response.filePath}`);
    console.log(`   status: ${response.status}`);
    console.log(`   jobId: ${response.jobId}\n`);

    console.log('⏳ Background processing started...');
    console.log('   Check logs for progress');
    console.log('   Processing typically takes 30-60 seconds\n');

    // Aguardar tempo suficiente para processamento
    console.log('⏱️  Waiting 90 seconds for background processing...');
    await new Promise(resolve => setTimeout(resolve, 90000));

    console.log('\n✅ E2E Test Completed!');
    console.log('   Check the following:');
    console.log('   1. JSON file created at: ' + response.filePath);
    console.log('   2. Database records in Supabase');
    console.log('   3. Processing logs for any errors\n');

  } catch (error) {
    console.error('\n❌ E2E Test Failed:');
    console.error(error);
    process.exit(1);
  }
}

runCompleteE2E();
```

### Fase 6: Executar o Teste

```bash
# Executar o teste E2E completo
bun run test/e2e-edital-complete.test.ts

# Monitorar logs em tempo real (em outro terminal)
tail -f logs/combined.log

# Verificar erros
tail -f logs/error.log
```

### Fase 7: Validar no Supabase

```sql
-- No SQL Editor do Supabase, verificar os dados inseridos:

-- 1. Verificar schedule_plan
SELECT * FROM schedule_plans 
WHERE user_id = '98d8b11a-8a32-4f6b-9dae-6e42efa23116'
ORDER BY created_at DESC;

-- 2. Verificar edital processado
SELECT * FROM editals 
WHERE user_id = '98d8b11a-8a32-4f6b-9dae-6e42efa23116'
ORDER BY created_at DESC;

-- 3. Verificar exames extraídos
SELECT e.*, ed.original_url 
FROM exams e
JOIN editals ed ON e.edital_id = ed.id
WHERE ed.user_id = '98d8b11a-8a32-4f6b-9dae-6e42efa23116'
ORDER BY e.created_at DESC;

-- 4. Verificar disciplinas
SELECT d.*, e.name as exam_name
FROM disciplines d
JOIN exams e ON d.exam_id = e.id
JOIN editals ed ON e.edital_id = ed.id
WHERE ed.user_id = '98d8b11a-8a32-4f6b-9dae-6e42efa23116'
ORDER BY d.created_at DESC;

-- 5. Verificar matérias
SELECT s.*, d.name as discipline_name
FROM subjects s
JOIN disciplines d ON s.discipline_id = d.id
JOIN exams e ON d.exam_id = e.id
JOIN editals ed ON e.edital_id = ed.id
WHERE ed.user_id = '98d8b11a-8a32-4f6b-9dae-6e42efa23116'
ORDER BY s."order" ASC;

-- 6. Verificar legislações
SELECT l.*, s.name as subject_name
FROM legislations l
JOIN subjects s ON l.subject_id = s.id
JOIN disciplines d ON s.discipline_id = d.id
JOIN exams e ON d.exam_id = e.id
JOIN editals ed ON e.edital_id = ed.id
WHERE ed.user_id = '98d8b11a-8a32-4f6b-9dae-6e42efa23116';

-- 7. Estatísticas completas
SELECT 
  ed.job_id,
  ed.status,
  ed.processed_at,
  COUNT(DISTINCT e.id) as total_exams,
  COUNT(DISTINCT d.id) as total_disciplines,
  COUNT(DISTINCT s.id) as total_subjects,
  COUNT(DISTINCT l.id) as total_legislations,
  SUM(d.number_of_questions) as total_questions
FROM editals ed
LEFT JOIN exams e ON e.edital_id = ed.id
LEFT JOIN disciplines d ON d.exam_id = e.id
LEFT JOIN subjects s ON s.discipline_id = d.id
LEFT JOIN legislations l ON l.subject_id = s.id
WHERE ed.user_id = '98d8b11a-8a32-4f6b-9dae-6e42efa23116'
GROUP BY ed.id
ORDER BY ed.created_at DESC;
```

---

## ✅ Checklist de Implementação

- [ ] **Fase 1**: Verificar variáveis de ambiente
- [ ] **Fase 2**: Criar tabelas no Supabase (executar SQL)
- [ ] **Fase 3**: Implementar `edital-database.service.ts`
- [ ] **Fase 4**: Integrar persistência no `edital-process.service.ts`
- [ ] **Fase 5**: Criar arquivo de teste E2E
- [ ] **Fase 6**: Executar teste e monitorar logs
- [ ] **Fase 7**: Validar dados inseridos no Supabase
- [ ] **Bonus**: Criar endpoint API para consultar dados processados

---

## 🐛 Troubleshooting

### Erro: "Failed to create schedule_plan"
- Verificar se a tabela `schedule_plans` existe
- Verificar RLS policies
- Usar Service Role Key, não anon key

### Erro: "Foreign key violation"
- Verificar se `user_id` existe em `auth.users`
- Criar usuário de teste no Supabase Auth se necessário

### Teste não completa após 90 segundos
- Aumentar tempo de espera
- Verificar logs para identificar onde travou
- Processar edital menor primeiro para testar pipeline

### JSON salvo mas DB não tem dados
- Verificar logs para erros de persistência
- Executar queries SQL manualmente com dados de teste
- Validar constraints e tipos de dados

---

## 📊 Métricas de Sucesso

Um teste E2E bem-sucedido deve resultar em:

✅ **1 edital** na tabela `editals` (status='completed')  
✅ **N concursos** na tabela `exams` (depende do edital)  
✅ **M disciplinas** na tabela `disciplines`  
✅ **X matérias** na tabela `subjects` // DIEGO ATENCAO AQUI ELE SE CONFUDNO ENTRE SUBJECTS E TOPICS 
✅ **Y legislações** na tabela `legislations` (se houver)  
✅ **Arquivo JSON** salvo em `/public/{user_id}/{schedule_plan_id}/`  
✅ **Logs completos** sem erros críticos  
✅ **Integridade OK** (soma de questões bate com total)

---

## 🎓 Próximos Passos

Após o teste E2E funcionar completamente:

1. **Criar API endpoints** para consultar editais processados
2. **Implementar frontend** para visualizar dados
3. **Adicionar testes unitários** para cada serviço
4. **Monitoramento** com métricas e alertas
5. **Documentar APIs** com Swagger/OpenAPI
6. **Deploy em produção** com CI/CD

---

**Data de Criação:** 17 de Outubro de 2025  
**Última Atualização:** 17 de Outubro de 2025  
**Autor:** GitHub Copilot  
**Status:** 🚧 Em Implementação
