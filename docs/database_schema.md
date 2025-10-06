# Database Schema - Cronograma de Estudos

## Visão Geral

O banco agora utiliza um modelo normalizado para melhor consistência, edição e consultas:
- `edital_file`: Registra uploads de arquivos de editais e seu status de processamento
- `study_plans`: Configurações-base do plano (nome do exame, org, datas base, owner) - referencia edital_file
- `exams`: Detalhes do exame (tipo, data, turno, total_questions) — 1:1 com study_plans
- `cycles_per_dow`: Quantidade de ciclos por dia da semana (substitui JSONB cycles_per_dow)
- `exception_periods`: Períodos de exceção do plano (substitui JSONB exception_periods)
- `disciplines`: Disciplinas do plano (nome, cor, número de questões)
- `topics`: Tópicos de cada disciplina com peso {1.0, 1.5, 2.0} apenas
- `study_schedule`: Agenda diária (1 linha = 1 ciclo de estudo)

Nota de migração: a migração que cria essas tabelas e move os dados está em `supabase/migrations/20250930090000_normalize_study_plans.sql`. Os payloads de API para popular as novas tabelas estão em `docs/09-api-request-payloads.md`.

Nota: O banco também contém tabelas auxiliares como `profiles`, `user_roles`, e `user_sessions` para gerenciamento de usuários e autenticação, mas estas não são detalhadas aqui pois focamos no schema de planejamento de estudos.

## Esquema Completo

### ENUMs e Types

```sql
-- ENUMs para padronização
CREATE TYPE exam_type AS ENUM ('objetiva','discursiva','prática','oral');
CREATE TYPE turn AS ENUM ('manha','tarde','noite');
CREATE TYPE slot_kind AS ENUM ('study','practice','practice_oral','rest','free','folga','prova','coringa');
CREATE TYPE phase AS ENUM ('impulso','sprint','aprendiz','hd','turbo');
CREATE TYPE plan_status AS ENUM ('processing','ready');
CREATE TYPE weekdayshort AS ENUM ('sun','mon','tue','wed','thu','fri','sat');
CREATE TYPE user_role AS ENUM ('admin','subscriber','guest');
```

### Tabela: study_plans

```sql
CREATE TABLE public.study_plans (
  -- Identificação
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Dados do Concurso
  exam_name TEXT NOT NULL,
  exam_org TEXT,                 -- ex: TJSC, OAB, ENAC, MPRS
  
  -- Planejamento
  start_date DATE NOT NULL,
  
  -- Configurações de Estudo
  fixed_off_days weekdayshort[] NULL,

  -- Referência ao arquivo do edital
  edital_id UUID REFERENCES public.edital_file(id) ON DELETE CASCADE,

  -- Progresso do Wizard
  current_step SMALLINT DEFAULT 1 CHECK (current_step BETWEEN 1 AND 3),

  -- Observações
  notes TEXT,
  status plan_status DEFAULT 'processing'
);

-- Indexes
CREATE INDEX idx_study_plans_user_id ON public.study_plans(user_id);
CREATE INDEX idx_study_plans_edital_id ON public.study_plans(edital_id);
```

### Tabela: study_schedule

```sql
CREATE TABLE public.study_schedule (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.study_plans(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Identificação Temporal
  day DATE,                   -- data do ciclo
  dow SMALLINT,             -- dia da semana (0=domingo, 1=segunda, ...)
  turn turn NOT NULL,                -- manha|tarde|noite
  cycle_number SMALLINT NOT NULL,    -- 1..N dentro do turno/dia

  -- Classificação do Ciclo
  phase phase,                       -- impulso/sprint ou aprendiz/hd/turbo
  kind slot_kind,           -- study/practice/practice_oral/rest/free/folga/prova/coringa

  -- Conteúdo (nulo para rest/folga/prova/coringa)
  discipline TEXT,                   
  topic TEXT,
  color TEXT,                        -- redundante para render mais rápido

  -- Metadados
  summary JSONB                      -- resumo do dia, estatísticas, etc.
);

-- Indexes críticos para performance
CREATE INDEX idx_schedule_plan_date ON public.study_schedule (plan_id, day);
CREATE INDEX idx_schedule_plan_date_turn ON public.study_schedule (plan_id, day, turn);
CREATE INDEX idx_schedule_kind ON public.study_schedule (kind);
CREATE INDEX idx_schedule_discipline ON public.study_schedule (discipline) WHERE discipline IS NOT NULL;
```

### Tabela: edital_file

```sql
CREATE TABLE public.edital_file (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- File information
  edital_file_url TEXT NOT NULL,
  edital_bucket_path TEXT NOT NULL,
  edital_status TEXT DEFAULT 'processing' CHECK (edital_status IN ('processing', 'ready', 'error')),

  -- Metadata
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT
);

-- Indexes
CREATE INDEX idx_edital_file_user_id ON public.edital_file(user_id);
CREATE INDEX idx_edital_file_status ON public.edital_file(edital_status);
```

### Novas Tabelas (normalizado)

#### exams

```sql
CREATE TABLE public.exams (
  plan_id UUID PRIMARY KEY REFERENCES public.study_plans(id) ON DELETE CASCADE,
  exam_type exam_type NOT NULL,
  exam_date varchar(255),  -- string para permitir "a divulgar" ou datas formatadas
  exam_turn turn NOT NULL,
  total_questions INT
);
```

#### cycles_per_dow

```sql
-- Tipo weekdayshort já existente no projeto
CREATE TABLE public.cycles_per_dow (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.study_plans(id) ON DELETE CASCADE,
  week_day weekdayshort NOT NULL,
  morning_cycles SMALLINT NOT NULL CHECK (morning_cycles BETWEEN 0 AND 8),
  afternoon_cycles SMALLINT NOT NULL CHECK (afternoon_cycles BETWEEN 0 AND 8),
  night_cycles SMALLINT NOT NULL CHECK (night_cycles BETWEEN 0 AND 8),
  CONSTRAINT uq_plan_weekday UNIQUE (plan_id, week_day)
);
```

#### exception_periods

```sql
CREATE TABLE public.exception_periods (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.study_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  CHECK (end_date >= start_date)
);
```

#### disciplines e topics

```sql
CREATE TABLE public.disciplines (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.study_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  number_of_questions INT,
  CONSTRAINT uq_discipline_per_plan UNIQUE (plan_id, name)
);

CREATE TABLE public.topics (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.study_plans(id) ON DELETE CASCADE,
  discipline_id BIGINT NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight NUMERIC(3,1) NOT NULL CHECK (weight IN (1.0, 1.5, 2.0)),
  CONSTRAINT uq_topic_per_discipline UNIQUE (discipline_id, name)
);
```

Observação: As antigas estruturas JSONB (`cycles_per_dow`, `exception_periods`, `disciplines`, `palette`, `raw_edital_meta`, `weight_overrides`) foram substituídas por tabelas; ver `docs/09-api-request-payloads.md` para exemplos de criação/atualização.

## Checklist de Implementação

### 1. Setup Inicial do Banco
- [ ] Criar database no Supabase
- [ ] Executar script de ENUMs
- [ ] Executar script das tabelas
- [ ] Verificar indexes criados
- [ ] Configurar Row Level Security (RLS)

### 2. Estruturas de Dados Detalhadas

As estruturas antes em JSONB foram normalizadas em tabelas: `exams`, `cycles_per_dow`, `exception_periods`, `disciplines`, `topics`. Veja exemplos de payloads em `docs/09-api-request-payloads.md`.

### 3. Queries de Exemplo

#### Buscar cronograma do dia
```sql
SELECT 
  day, turn, cycle_number, phase, kind,
  discipline, topic, color
FROM public.study_schedule 
WHERE plan_id = $1 
  AND day = $2 
ORDER BY turn, cycle_number;
```

#### Buscar cronograma da semana
```sql
SELECT 
  day, dow, turn, cycle_number, phase, kind,
  discipline, topic, color
FROM public.study_schedule 
WHERE plan_id = $1 
  AND day BETWEEN $2 AND $3
ORDER BY day, turn, cycle_number;
```

#### Estatísticas por disciplina
```sql
SELECT 
  discipline,
  COUNT(*) as total_cycles,
  COUNT(DISTINCT d) as days_studied,
  phase
FROM public.study_schedule 
WHERE plan_id = $1 
  AND kind = 'study'
  AND discipline IS NOT NULL
GROUP BY discipline, phase
ORDER BY discipline, phase;
```

### 4. Row Level Security (RLS)

```sql
-- Habilitar RLS
ALTER TABLE public.study_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_schedule ENABLE ROW LEVEL SECURITY;

-- Políticas para study_plans
CREATE POLICY "Users can view their own plans" ON public.study_plans
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own plans" ON public.study_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own plans" ON public.study_plans
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own plans" ON public.study_plans
  FOR DELETE USING (auth.uid() = user_id);

-- Políticas para study_schedule (baseadas no plano)
CREATE POLICY "Users can view their own schedules" ON public.study_schedule
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.study_plans 
      WHERE id = plan_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own schedules" ON public.study_schedule
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.study_plans 
      WHERE id = plan_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own schedules" ON public.study_schedule
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.study_plans 
      WHERE id = plan_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own schedules" ON public.study_schedule
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.study_plans 
      WHERE id = plan_id AND user_id = auth.uid()
    )
  );
```

### 5. Validações e Constraints

```sql
-- Constraints adicionais para integridade
-- Regra exam_date >= start_date movida para trigger em public.exams

ALTER TABLE public.study_schedule 
  ADD CONSTRAINT check_dow_range 
  CHECK (dow >= 0 AND dow <= 6);

ALTER TABLE public.study_schedule 
  ADD CONSTRAINT check_cycle_number_positive 
  CHECK (cycle_number > 0);

-- Constraint para garantir que discipline não seja nulo quando kind = 'study'
ALTER TABLE public.study_schedule 
  ADD CONSTRAINT check_discipline_when_study
  CHECK (NOT (kind = 'study' AND discipline IS NULL));
```

### 6. Triggers para Auditoria

```sql
-- Função para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para study_plans
CREATE TRIGGER update_study_plans_updated_at 
  BEFORE UPDATE ON public.study_plans 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();
```

## Fluxo de Upload e Processamento de Editais

### Visão Geral do Fluxo

O processo de upload e processamento de editais segue um fluxo estruturado que envolve múltiplas tabelas e etapas:

### 1. Upload do Arquivo (Tabela: edital_file)

**Início do processo:**
1. Usuário faz upload do PDF do edital na interface
2. Arquivo é enviado para o Supabase Storage
3. Registro criado na tabela `edital_file`:
   ```sql
   INSERT INTO public.edital_file (
     user_id,
     edital_file_url,
     edital_bucket_path,
     edital_status,
     file_name,
     file_size,
     mime_type
   ) VALUES (
     auth.uid(),
     'https://storage.supabase.co/...',
     'editals/user_id/filename.pdf',
     'processing',  -- Status inicial
     'edital_oab.pdf',
     1234567,
     'application/pdf'
   );
   ```

### 2. Processamento do Edital (Edge Function)

**Extração de dados:**
1. Edge Function `upload-and-process` é acionada
2. Conteúdo do PDF é extraído e processado
3. IA (Claude API) analisa o conteúdo e identifica:
   - Concursos/exames mencionados no edital
   - Disciplinas e tópicos de cada concurso
   - Metadados (organizadora, tipo de prova, número de questões)

### 3. Criação dos Study Plans (Tabela: study_plans)

**Para cada concurso identificado no edital:**
1. Criar registro em `study_plans`:
   ```sql
   INSERT INTO public.study_plans (
     user_id,
     exam_name,
     exam_org,
     start_date,
     edital_id,  -- Referência ao edital_file
     status
   ) VALUES (
     auth.uid(),
     'OAB XXXVI Exame',
     'FGV',
     CURRENT_DATE,
     'uuid-do-edital',
     'processing'  -- Ainda processando
   );
   ```

2. Criar registro em `exams` (1:1 com study_plan):
   ```sql
   INSERT INTO public.exams (
     plan_id,
     exam_type,
     exam_date,
     exam_turn,
     total_questions
   ) VALUES (
     'uuid-do-study-plan',
     'objetiva',
     'a divulgar',
     'manha',
     80
   );
   ```

3. Criar disciplinas em `disciplines`:
   ```sql
   INSERT INTO public.disciplines (
     plan_id,
     name,
     color,
     number_of_questions
   ) VALUES 
     ('uuid-do-study-plan', 'Direito Constitucional', '#3B82F6', 15),
     ('uuid-do-study-plan', 'Direito Civil', '#10B981', 20),
     ...;
   ```

4. Criar tópicos em `topics`:
   ```sql
   INSERT INTO public.topics (
     plan_id,
     discipline_id,
     name,
     weight
   ) VALUES 
     ('uuid-do-study-plan', discipline_id_1, 'Direitos Fundamentais', 1.0),
     ('uuid-do-study-plan', discipline_id_1, 'Organização do Estado', 1.5),
     ...;
   ```

### 4. Finalização do Processamento

**Atualização do status do edital:**

⚠️ **IMPORTANTE**: Após a criação de **TODOS** os `study_plans` referentes aos concursos identificados no edital, o status deve ser atualizado na tabela `edital_file` (e não mais em `study_plans` como era feito anteriormente):

```sql
-- CORRETO: Atualizar status do edital após processar todos os concursos
UPDATE public.edital_file 
SET 
  edital_status = 'ready',
  updated_at = now()
WHERE id = 'uuid-do-edital';
```

**Nota sobre status dos study_plans:**
- Os `study_plans` individuais mantêm `status = 'processing'` até que o usuário complete a configuração no wizard (Steps 1-3)
- Apenas após salvar todas as configurações no Step 3, o `study_plan` passa para `status = 'ready'`
- O `edital_file.edital_status = 'ready'` indica que a extração e criação inicial dos planos foi concluída, mas não que os planos estão prontos para uso

### 5. Wizard de Configuração (Frontend)

**Fluxo do usuário após processamento:**

1. **Step 1 - Seleção**: Usuário visualiza todos os `study_plans` do edital
2. **Step 2 - Revisão**: Ajusta disciplinas, tópicos e pesos
3. **Step 3 - Planejamento**: 
   - Define `start_date` e `exam_date`
   - Configura `cycles_per_dow`
   - Adiciona `exception_periods`
   - Salva configurações

4. **Após salvar Step 3**:
   ```sql
   -- Atualizar study_plan para ready
   UPDATE public.study_plans 
   SET 
     status = 'ready',
     current_step = 3,
     updated_at = now()
   WHERE id = 'uuid-do-study-plan';
   ```

### Diagrama de Estados

```
UPLOAD
  ↓
edital_file (status='processing')
  ↓
EDGE FUNCTION: Extração IA
  ↓
study_plans[] (status='processing') + exams + disciplines + topics
  ↓
edital_file (status='ready') ← Todos os planos criados
  ↓
WIZARD: Steps 1-3 (usuário configura cada plan)
  ↓
study_plan (status='ready', current_step=3) ← Plano individual configurado
  ↓
ALGORITMO: Gerar cronograma
  ↓
study_schedule[] (registros de ciclos de estudo)
```

### Observações Importantes

1. **Múltiplos Concursos**: Um único edital pode gerar múltiplos `study_plans` (ex: edital com concurso nível médio e nível superior)

2. **Processamento Assíncrono**: O status `edital_file.edital_status = 'processing'` permite feedback visual ao usuário durante extração

3. **Integridade Referencial**: 
   - `study_plans.edital_id` → `edital_file.id`
   - `ON DELETE CASCADE` garante limpeza automática

4. **RLS (Row Level Security)**: Todos os dados são isolados por `user_id`, garantindo privacidade

5. **Rollback**: Se houver erro durante processamento:
   ```sql
   UPDATE public.edital_file 
   SET edital_status = 'error' 
   WHERE id = 'uuid-do-edital';
   ```