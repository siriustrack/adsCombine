import Anthropic from '@anthropic-ai/sdk';
import logger from 'lib/logger';
import type { EditalProcessado } from '../services/editais/edital-schema';
import { supabaseMCP } from '../services/supabase-mcp.service';

interface OrchestrationInput {
  user_id: string;
  edital_json: EditalProcessado;
  edital_file_url: string;
  edital_bucket_path: string; // NOT NULL no banco
  file_name?: string;
  file_size?: number;
  mime_type?: string;
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

interface AgentContext {
  user_id: string;
  edital_json: EditalProcessado;
  original_url: string;
  edital_bucket_path: string; // NOT NULL no banco
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  transcription_url?: string;
  json_url?: string;
  edital_file_id?: string;
  study_plan_id?: string;
  discipline_ids?: Record<string, number>;
  errors: string[];
  warnings: string[];
}

/**
 * Agente Orquestrador Inteligente
 * 
 * Coordena sub-agentes especializados para transformar JSON de editais
 * em registros estruturados no Supabase via MCP.
 * 
 * Arquitetura:
 * 1. EditalFileAgent - Cria registro do arquivo
 * 2. StudyPlanAgent - Cria plano de estudo
 * 3. ExamsAgent - Cria provas/fases
 * 4. DisciplinesAgent - Cria disciplinas e mapeia IDs
 * 5. TopicsAgent - Cria topics (matérias)
 */
export class EditalOrchestratorAgent {
  private anthropic: Anthropic;
  
  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_AI_API_KEY;
    
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY or CLAUDE_AI_API_KEY is required for EditalOrchestratorAgent');
    }
    
    this.anthropic = new Anthropic({
      apiKey,
    });
  }

  /**
   * Orquestra toda a inserção de dados no banco
   */
  async orchestrate(input: OrchestrationInput): Promise<OrchestrationResult> {
    logger.info('[ORCHESTRATOR] 🎼 Starting edital data orchestration', {
      user_id: input.user_id,
      concursos: input.edital_json.concursos.length,
      totalDisciplinas: input.edital_json.validacao.totalDisciplinas,
      totalMaterias: input.edital_json.validacao.totalMaterias,
    });

    const context: AgentContext = {
      user_id: input.user_id,
      edital_json: input.edital_json,
      original_url: input.edital_file_url,
      edital_bucket_path: input.edital_bucket_path,
      file_name: input.file_name,
      file_size: input.file_size,
      mime_type: input.mime_type,
      transcription_url: input.transcription_url,
      json_url: input.json_url,
      errors: [],
      warnings: [],
    };

    try {
      // FASE 1: Criar registro do edital_file
      logger.info('[ORCHESTRATOR] 📄 Phase 1/5: Creating edital_file record');
      const editalFileId = await this.executeEditalFileAgent(context);
      
      if (!editalFileId) {
        throw new Error('Failed to create edital_file record');
      }
      context.edital_file_id = editalFileId;
      logger.info('[ORCHESTRATOR] ✅ Phase 1/5 completed', { edital_file_id: context.edital_file_id });

      // FASE 2: Criar study_plan
      logger.info('[ORCHESTRATOR] 📚 Phase 2/5: Creating study_plan');
      const studyPlanId = await this.executeStudyPlanAgent(context);
      
      if (!studyPlanId) {
        throw new Error('Failed to create study_plan record');
      }
      context.study_plan_id = studyPlanId;
      logger.info('[ORCHESTRATOR] ✅ Phase 2/5 completed', { study_plan_id: context.study_plan_id });

      // FASE 3: Criar exams
      logger.info('[ORCHESTRATOR] 📝 Phase 3/5: Creating exams');
      const examsCount = await this.executeExamsAgent(context);
      logger.info('[ORCHESTRATOR] ✅ Phase 3/5 completed', { exams_created: examsCount });

      // FASE 4: Criar disciplines e obter mapeamento de IDs
      logger.info('[ORCHESTRATOR] 📖 Phase 4/5: Creating disciplines');
      const disciplineIds = await this.executeDisciplinesAgent(context);
      
      if (!disciplineIds) {
        throw new Error('Failed to create disciplines');
      }
      context.discipline_ids = disciplineIds;
      logger.info('[ORCHESTRATOR] ✅ Phase 4/5 completed', { 
        disciplines_created: Object.keys(context.discipline_ids).length,
      });

      // FASE 5: Criar topics
      logger.info('[ORCHESTRATOR] 🎯 Phase 5/5: Creating topics');
      const topicsCount = await this.executeTopicsAgent(context);
      logger.info('[ORCHESTRATOR] ✅ Phase 5/5 completed', { topics_created: topicsCount });

      logger.info('[ORCHESTRATOR] 🎉 Orchestration completed successfully', {
        edital_file_id: context.edital_file_id,
        study_plan_id: context.study_plan_id,
        stats: {
          exams: examsCount,
          disciplines: Object.keys(context.discipline_ids).length,
          topics: topicsCount,
        },
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
        stack: error instanceof Error ? error.stack : undefined,
      });

      return {
        success: false,
        errors: [
          error instanceof Error ? error.message : 'Unknown orchestration error',
          ...context.errors,
        ],
        warnings: context.warnings,
        stats: {
          exams: 0,
          disciplines: 0,
          topics: 0,
        },
      };
    }
  }

  /**
   * EditalFileAgent - Cria registro em edital_file
   */
  private async executeEditalFileAgent(context: AgentContext): Promise<string | null> {
    const systemPrompt = `Você é o EditalFileAgent, especializado em criar registros na tabela edital_file do Supabase.

Sua tarefa: Analisar os dados fornecidos e gerar um SQL INSERT statement válido.

Schema da tabela edital_file:
- id (uuid, auto-generated)
- user_id (uuid, NOT NULL)
- edital_file_url (text, NOT NULL)
- edital_bucket_path (text, NOT NULL) ← Caminho no storage bucket
- edital_status (text, default 'processing')
- file_name (text, opcional)
- file_size (bigint, opcional)
- mime_type (text, opcional)
- processing_result (jsonb, opcional)
- transcription_url (text, opcional)
- json_url (text, opcional)
- created_at (timestamp, auto)
- updated_at (timestamp, auto)

IMPORTANTE:
- O campo processing_result é JSONB e deve conter o JSON completo do edital processado
- edital_status deve ser 'ready' pois o processamento já foi concluído
- edital_bucket_path é obrigatório (NOT NULL)
- Use aspas simples para strings SQL e escape aspas internas corretamente
- Para o JSONB, converta o JSON para string e faça cast com ::jsonb
- Para valores NULL, use NULL sem aspas

Retorne APENAS o SQL INSERT com RETURNING id, sem explicações.`;

    const userPrompt = `Crie um registro em edital_file com os seguintes dados:

user_id: ${context.user_id}
edital_file_url: ${context.original_url}
edital_bucket_path: ${context.edital_bucket_path}
file_name: ${context.file_name || 'NULL'}
file_size: ${context.file_size || 'NULL'}
mime_type: ${context.mime_type || 'NULL'}
transcription_url: ${context.transcription_url || 'NULL'}
json_url: ${context.json_url || 'NULL'}
edital_status: 'ready'
processing_result (JSON): ${JSON.stringify(context.edital_json)}

Gere o SQL INSERT statement com RETURNING id. Retorne APENAS o SQL.`;

    try {
      const sql = await this.callAgent('EditalFileAgent', systemPrompt, userPrompt);
      logger.debug('[EditalFileAgent] Generated SQL', { sql: sql.substring(0, 200) + '...' });
      
      // Executar via Supabase MCP Service
      logger.info('[EditalFileAgent] Executing SQL in Supabase');
      const result = await supabaseMCP.execute_sql({ query: sql });
      
      if (result.error) {
        throw new Error(`SQL execution failed: ${result.error}`);
      }
      
      const editalFileId = result.rows?.[0]?.id;
      if (!editalFileId) {
        throw new Error('No ID returned from edital_file insert');
      }
      
      logger.info('[EditalFileAgent] ✅ Record created in Supabase', { id: editalFileId });
      return editalFileId;
      
    } catch (error) {
      logger.error('[EditalFileAgent] Failed to execute', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      context.errors.push(`EditalFileAgent: ${error instanceof Error ? error.message : 'Failed'}`);
      return null;
    }
  }

  /**
   * StudyPlanAgent - Cria study_plan vinculado ao edital
   */
  private async executeStudyPlanAgent(context: AgentContext): Promise<string | null> {
    const concurso = context.edital_json.concursos[0];
    
    const systemPrompt = `Você é o StudyPlanAgent, especializado em criar planos de estudo.

Sua tarefa: Extrair dados do metadata do concurso e gerar SQL INSERT para study_plans.

Campos importantes:
- exam_name: Nome do exame/concurso
- exam_org: Órgão organizador
- start_date: Data da prova no formato DATE (YYYY-MM-DD)
- status: 'processing' (será atualizado depois)
- current_step: 1 (início do wizard)

Retorne APENAS o SQL INSERT statement:

INSERT INTO study_plans (user_id, edital_id, exam_name, exam_org, start_date, status, current_step)
VALUES ('uuid', 'uuid', 'Nome', 'Órgão', '2025-04-27', 'processing', 1)
RETURNING id;`;

    const userPrompt = `Crie um study_plan com os dados:

user_id: ${context.user_id}
edital_id: ${context.edital_file_id}

Metadata do concurso:
${JSON.stringify(concurso.metadata, null, 2)}

Extraia exam_name, exam_org e start_date. Gere o SQL INSERT.`;

    try {
      const sql = await this.callAgent('StudyPlanAgent', systemPrompt, userPrompt);
      logger.debug('[StudyPlanAgent] Generated SQL', { sql });
      
      // Executar via Supabase MCP Service
      logger.info('[StudyPlanAgent] Executing SQL in Supabase');
      const result = await supabaseMCP.execute_sql({ query: sql });
      
      if (result.error) {
        throw new Error(`SQL execution failed: ${result.error}`);
      }
      
      const studyPlanId = result.rows?.[0]?.id;
      if (!studyPlanId) {
        throw new Error('No ID returned from study_plans insert');
      }
      
      logger.info('[StudyPlanAgent] ✅ Record created in Supabase', { id: studyPlanId });
      return studyPlanId;
      
    } catch (error) {
      logger.error('[StudyPlanAgent] Failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      context.errors.push(`StudyPlanAgent: ${error instanceof Error ? error.message : 'Failed'}`);
      return null;
    }
  }

  /**
   * ExamsAgent - Cria registros de provas/fases
   */
  private async executeExamsAgent(context: AgentContext): Promise<number> {
    const fases = context.edital_json.concursos[0].fases || [];
    
    if (fases.length === 0) {
      logger.warn('[ExamsAgent] No fases found in edital');
      return 0;
    }

    const systemPrompt = `Você é o ExamsAgent, especializado em criar registros de provas/fases.

Sua tarefa: Converter fases do edital em registros da tabela exams.

IMPORTANTE: exam_turn é NOT NULL - sempre forneça um valor válido!

Mapeamento de tipos (tipo → exam_type):
- "objetiva" → 'objetiva'
- "discursiva" → 'discursiva'  
- "pratica" ou "prática" → 'prática'
- "oral" → 'oral'

Mapeamento de turnos (turno → exam_turn):
- "manha" → 'manha'
- "tarde" → 'tarde'
- "noite" → 'noite'
- Se não especificado ou oral → 'manha' (padrão)

Regras:
- exam_date: Se 'a_divulgar' ou null, use NULL no SQL
- exam_turn: NUNCA use NULL - sempre forneça 'manha', 'tarde' ou 'noite'
- total_questions: Se não especificado, use NULL

Retorne SQL com INSERT multi-row:

INSERT INTO exams (plan_id, exam_type, exam_date, exam_turn, total_questions)
VALUES
  ('uuid', 'objetiva', '2025-04-27', 'tarde', 100),
  ('uuid', 'oral', NULL, 'manha', NULL);`;

    const userPrompt = `Crie registros de exams para plan_id: ${context.study_plan_id}

Fases do concurso:
${JSON.stringify(fases, null, 2)}

Para cada fase, gere uma linha no INSERT. Retorne o SQL completo.`;

    try {
      const sql = await this.callAgent('ExamsAgent', systemPrompt, userPrompt);
      logger.debug('[ExamsAgent] Generated SQL', { sql });
      
      // Executar via Supabase MCP Service
      logger.info('[ExamsAgent] Executing SQL in Supabase');
      const result = await supabaseMCP.execute_sql({ query: sql });
      
      if (result.error) {
        throw new Error(`SQL execution failed: ${result.error}`);
      }
      
      const examsCount = result.rows?.length || 0;
      logger.info('[ExamsAgent] ✅ Records created in Supabase', { count: examsCount });
      return examsCount;
      
    } catch (error) {
      logger.error('[ExamsAgent] Failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      context.warnings.push(`ExamsAgent: ${error instanceof Error ? error.message : 'Failed'}`);
      return 0;
    }
  }

  /**
   * DisciplinesAgent - Cria disciplinas e retorna mapeamento nome → ID
   */
  private async executeDisciplinesAgent(context: AgentContext): Promise<Record<string, number> | null> {
    const disciplinas = context.edital_json.concursos[0].disciplinas || [];
    
    if (disciplinas.length === 0) {
      logger.error('[DisciplinesAgent] No disciplinas found in edital');
      return null;
    }

    const systemPrompt = `Você é o DisciplinesAgent, especializado em criar disciplinas REAIS.

⚠️ ATENÇÃO: HIERARQUIA DO JSON DO EDITAL ⚠️

O JSON pode vir em 2 formatos:

FORMATO 1 - COM GRUPOS (hierárquico):
{
  "disciplinas": [
    {
      "nome": "Bloco I",  // ← GRUPO, NÃO É DISCIPLINA!
      "materias": [
        { "nome": "Direito Civil" },      // ← DISCIPLINA REAL
        { "nome": "Direito Penal" }       // ← DISCIPLINA REAL
      ]
    }
  ]
}

FORMATO 2 - SEM GRUPOS (flat):
{
  "disciplinas": [
    { "nome": "Direito Civil" },    // ← DISCIPLINA REAL (sem materias[])
    { "nome": "Direito Penal" }     // ← DISCIPLINA REAL (sem materias[])
  ]
}

🎯 SUA TAREFA:

1. IDENTIFIQUE o formato:
   - Se disciplina tem array "materias" → FORMATO 1 (hierárquico)
   - Se disciplina NÃO tem "materias" → FORMATO 2 (flat)

2. EXTRAIA as disciplinas REAIS:
   - FORMATO 1: Use "materias[].nome" como disciplinas (IGNORE "disciplinas[].nome" que são grupos)
   - FORMATO 2: Use "disciplinas[].nome" diretamente

3. DISTRIBUA questões:
   - FORMATO 1: Distribua as questões do grupo entre as matérias proporcionalmente
   - FORMATO 2: Use "numeroQuestoes" diretamente

4. CORES: Gere hex vibrante e diferente para cada disciplina

FORMATO SQL:

INSERT INTO disciplines (plan_id, name, color, number_of_questions)
VALUES 
  ('uuid', 'Direito Civil', '#3B82F6', 15),
  ('uuid', 'Direito Penal', '#EF4444', 15)
RETURNING id, name;`;

    const userPrompt = `Crie disciplinas REAIS para plan_id: ${context.study_plan_id}

⚠️ ESTRUTURA DO EDITAL:
${JSON.stringify(disciplinas, null, 2)}

🔍 ANALISE A ESTRUTURA:
- Se tiver "materias[]" → Use materias[].nome como disciplinas (ignore grupo)
- Se NÃO tiver "materias[]" → Use disciplinas[].nome diretamente

📊 DISTRIBUIÇÃO DE QUESTÕES:
- Se hierárquico: Distribua questões do grupo entre as matérias
- Se flat: Use numeroQuestoes direto

Gere SQL com RETURNING id, name.`;

    try {
      const sql = await this.callAgent('DisciplinesAgent', systemPrompt, userPrompt);
      logger.debug('[DisciplinesAgent] Generated SQL', { sql });
      
      // Executar via Supabase MCP Service e parsear resultado
      logger.info('[DisciplinesAgent] Executing SQL in Supabase');
      const result = await supabaseMCP.execute_sql({ query: sql });
      
      if (result.error) {
        throw new Error(`SQL execution failed: ${result.error}`);
      }
      
      if (!result.rows || result.rows.length === 0) {
        throw new Error('No rows returned from disciplines insert');
      }
      
      // Criar mapeamento nome → id
      const mapping: Record<string, number> = {};
      result.rows.forEach((row: any) => {
        if (row.name && row.id) {
          mapping[row.name] = row.id;
        }
      });
      
      logger.info('[DisciplinesAgent] ✅ Records created in Supabase', { 
        count: Object.keys(mapping).length,
        mapping,
      });
      return mapping;
      
    } catch (error) {
      logger.error('[DisciplinesAgent] Failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      context.errors.push(`DisciplinesAgent: ${error instanceof Error ? error.message : 'Failed'}`);
      return null;
    }
  }

  /**
   * TopicsAgent - Cria topics (matérias) vinculados às disciplinas
   */
  private async executeTopicsAgent(context: AgentContext): Promise<number> {
    const disciplinas = context.edital_json.concursos[0].disciplinas || [];
    
    if (!context.discipline_ids) {
      logger.error('[TopicsAgent] discipline_ids not available');
      return 0;
    }

    const systemPrompt = `Você é o TopicsAgent, especializado em criar TÓPICOS REAIS.

⚠️ ATENÇÃO: HIERARQUIA DO JSON DO EDITAL ⚠️

O JSON pode vir em 2 formatos:

FORMATO 1 - COM GRUPOS (hierárquico):
{
  "disciplinas": [
    {
      "nome": "Bloco I",  // ← GRUPO (ignorar)
      "materias": [
        {
          "nome": "Direito Civil",  // ← DISCIPLINA (já criada em disciplines)
          "subtopicos": [
            "Teoria Geral",         // ← TÓPICO REAL (criar em topics!)
            "Obrigações"            // ← TÓPICO REAL
          ]
        }
      ]
    }
  ]
}

FORMATO 2 - SEM GRUPOS (flat):
{
  "disciplinas": [
    {
      "nome": "Direito Civil",  // ← DISCIPLINA (já criada em disciplines)
      "subtopicos": [
        "Teoria Geral",         // ← TÓPICO REAL (criar em topics!)
        "Obrigações"            // ← TÓPICO REAL
      ]
    }
  ]
}

🎯 SUA TAREFA:

1. IDENTIFIQUE o formato:
   - Se tem "materias[]" → FORMATO 1 (use materias[].subtopicos como topics)
   - Se NÃO tem "materias[]" → FORMATO 2 (use disciplinas[].subtopicos como topics)

2. CRIE TOPICS a partir dos SUBTÓPICOS:
   - FORMATO 1: Para cada materia → criar topics dos subtopicos[] dessa materia
   - FORMATO 2: Para cada disciplina → criar topics dos subtopicos[] dessa disciplina

3. MAPEAMENTO discipline_id:
   - FORMATO 1: Use o nome da MATERIA para encontrar o discipline_id
   - FORMATO 2: Use o nome da DISCIPLINA para encontrar o discipline_id

4. WEIGHTS: Use 1.0 como padrão

FORMATO SQL:

INSERT INTO topics (plan_id, discipline_id, name, weight)
VALUES
  ('uuid', 782, 'Teoria Geral do Direito Civil', 1.0),
  ('uuid', 782, 'Obrigações', 1.0),
  ('uuid', 783, 'Teoria Geral do Direito Penal', 1.0);`;

    const userPrompt = `Crie TÓPICOS REAIS para plan_id: ${context.study_plan_id}

🗺️ MAPEAMENTO discipline_ids (nome da disciplina → id):
${JSON.stringify(context.discipline_ids, null, 2)}

⚠️ ESTRUTURA DO EDITAL:
${JSON.stringify(disciplinas, null, 2)}

🔍 ANÁLISE A ESTRUTURA E CRIE TOPICS:
- Se tiver "materias[]": 
  * Para cada materia → pegar subtopicos[] 
  * Usar materia.nome para encontrar discipline_id no mapeamento
- Se NÃO tiver "materias[]":
  * Para cada disciplina → pegar subtopicos[]
  * Usar disciplina.nome para encontrar discipline_id no mapeamento

⚠️ IMPORTANTE: 
- Os SUBTÓPICOS são os TOPICS reais que devem ser criados!
- NÃO crie topics com nomes de disciplinas ou grupos!
- APENAS os subtópicos devem virar registros em topics!

Gere o SQL INSERT com TODOS os subtópicos.`;

    try {
      const sql = await this.callAgent('TopicsAgent', systemPrompt, userPrompt);
      logger.debug('[TopicsAgent] Generated SQL', { 
        sql: sql.substring(0, 300) + '...',
      });
      
      // Executar via Supabase MCP Service
      logger.info('[TopicsAgent] Executing SQL in Supabase');
      const result = await supabaseMCP.execute_sql({ query: sql });
      
      if (result.error) {
        throw new Error(`SQL execution failed: ${result.error}`);
      }
      
      const topicsCount = result.rows?.length || 0;
      logger.info('[TopicsAgent] ✅ Records created in Supabase', { count: topicsCount });
      return topicsCount;
      
    } catch (error) {
      logger.error('[TopicsAgent] Failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      context.warnings.push(`TopicsAgent: ${error instanceof Error ? error.message : 'Failed'}`);
      return 0;
    }
  }

  /**
   * Chamada genérica para um agente via Claude
   */
  private async callAgent(
    agentName: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    logger.debug(`[${agentName}] Calling Claude API`);

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929', // Claude Sonnet 4.5 - Melhor modelo (highest intelligence)
      max_tokens: 8192,
      temperature: 0, // Máxima precisão
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

    // Extrair SQL de code blocks se presente
    const sqlMatch = resultText.match(/```sql\s*([\s\S]*?)\s*```/);
    const sql = sqlMatch ? sqlMatch[1].trim() : resultText.trim();

    logger.debug(`[${agentName}] Response received`, {
      responseLength: resultText.length,
      sqlLength: sql.length,
    });

    return sql;
  }
}

export const editalOrchestratorAgent = new EditalOrchestratorAgent();
