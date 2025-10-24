import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import logger from '../../../lib/logger';

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

// Configuração do Claude
const anthropicConfig = {
  model: 'claude-sonnet-4-5-20250929',
  temperature: 0, // Zero para máxima precisão e determinismo (respostas consistentes)
  max_tokens: 16000,
};

interface DisciplineData {
  id: string;
  name: string;
  topics_count: number;
  current_questions: number | null;
}

interface ExamData {
  exam_type: string;
  total_questions: number;
}

interface FetchedData {
  transcriptionUrl: string;
  disciplines: DisciplineData[];
  exams: ExamData[];
}

// Tipos para queries do Supabase
interface StudyPlanRow {
  edital_id: string;
}

interface EditalFileRow {
  transcription_url: string;
}

interface DisciplineRow {
  id: string;
  name: string;
  number_of_questions: number | null;
  topics: { id: string }[];
}

// Tipo de resposta do Claude
interface ClaudeResponse {
  disciplines: {
    id: string;
    name: string;
    questions: number;
    reasoning: string;
  }[];
  validation: {
    total_assigned: number;
    matches_exam: boolean;
  };
  exam_validation: {
    type: string;
    declared_total: number;
    is_correct: boolean;
    correct_total?: number;
  };
}

interface FixResult {
  disciplinesUpdated: number;
  examCorrected: boolean;
}

/**
 * QuestionCounterFixerService
 * 
 * Serviço independente para corrigir contagem de questões por disciplina.
 * 
 * **Contexto**: Após o orchestrator criar study_plans, pode haver disciplinas
 * com `number_of_questions = NULL`. Este serviço usa Claude para extrair as
 * contagens corretas do edital original (TXT) e atualiza o banco de dados.
 * 
 * **Arquitetura**: 100% independente, executado opcionalmente após orchestrator.
 * Não modifica código existente, apenas adiciona funcionalidade nova.
 * 
 * **Lógica de Extração (prioridade)**:
 * 1. **Direct Mention**: Se edital menciona "Disciplina X: N questões" → usar N
 * 2. **Group Split**: Se edital agrupa disciplinas, distribuir proporcionalmente
 * 3. **Proportional Split**: Distribuir baseado em número de tópicos
 * 
 * **Algoritmo Proportional Split**:
 * ```
 * base = floor(totalQuestions / disciplinesCount)
 * remainder = totalQuestions - (base × disciplinesCount)
 * Top N disciplines (most topics) get: base + 1
 * Others get: base
 * Total = (N × (base + 1)) + ((disciplinesCount - N) × base)
 * ```
 * 
 * **Validação**: sum(discipline.questions) DEVE === exam.total_questions
 * 
 * **Trigger**: `process.env.ENABLE_QUESTION_FIXER === 'true'`
 */
class QuestionCounterFixerService {
  /**
   * Método principal: corrige contagem de questões
   */
  async fix(studyPlanId: string, userId: string): Promise<FixResult | null> {
    const startTime = Date.now();
    
    try {
      logger.info('[QUESTION-FIXER] 🚀 Starting question correction', { 
        studyPlanId, 
        userId 
      });

      // Step 1: Buscar dados do study_plan
      const data = await this.fetchData(studyPlanId);
      
      if (!data) {
        logger.error('[QUESTION-FIXER] ❌ Failed to fetch data');
        return null;
      }

      // Step 2: Baixar edital TXT
      const editalText = await this.fetchEditalText(data.transcriptionUrl);
      
      if (!editalText) {
        logger.error('[QUESTION-FIXER] ❌ Failed to fetch edital text');
        return null;
      }

      // Step 3: Processar com Claude
      const result = await this.processWithClaude(
        editalText,
        data.disciplines,
        data.exams
      );

      if (!result) {
        logger.error('[QUESTION-FIXER] ❌ Claude processing failed');
        return null;
      }

      // Step 4: Validar resultado
      if (!this.validateResult(result, data.exams)) {
        logger.error('[QUESTION-FIXER] ❌ Validation failed', {
          result,
          expectedTotal: data.exams.find(e => e.exam_type === 'objetiva')?.total_questions,
        });
        return null;
      }

      // Step 5: Atualizar banco de dados
      await this.updateDatabase(studyPlanId, result);

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      logger.info('[QUESTION-FIXER] ✅ Question correction completed', {
        studyPlanId,
        totalTime: `${totalTime}s`,
        disciplinesUpdated: result.disciplines.length,
        examCorrected: !result.exam_validation.is_correct,
      });

      return {
        disciplinesUpdated: result.disciplines.length,
        examCorrected: !result.exam_validation.is_correct,
      };
      
    } catch (error) {
      logger.error('[QUESTION-FIXER] ❌ Critical error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        studyPlanId,
        userId,
      });
      return null;
    }
  }

  /**
   * Buscar dados necessários do Supabase
   */
  private async fetchData(studyPlanId: string): Promise<FetchedData | null> {
    if (!supabase) {
      logger.error('[QUESTION-FIXER] ❌ Supabase client not configured');
      return null;
    }

    try {
      // Buscar transcription_url via edital_id
      const { data: studyPlan, error: spError } = await supabase
        .from('study_plans')
        .select('edital_id')
        .eq('id', studyPlanId)
        .single() as { data: StudyPlanRow | null; error: any };

      if (spError || !studyPlan || !studyPlan.edital_id) {
        logger.error('[QUESTION-FIXER] ❌ Study plan not found', { error: spError });
        return null;
      }

      const { data: editalFile, error: efError } = await supabase
        .from('edital_file')
        .select('transcription_url')
        .eq('id', studyPlan.edital_id)
        .single() as { data: EditalFileRow | null; error: any };

      if (efError || !editalFile || !editalFile.transcription_url) {
        logger.error('[QUESTION-FIXER] ❌ Edital file not found', { error: efError });
        return null;
      }

      // Buscar disciplinas com contagem de tópicos
      const { data: disciplines, error: discError } = await supabase
        .from('disciplines')
        .select(`
          id,
          name,
          number_of_questions,
          topics:topics(id)
        `)
        .eq('plan_id', studyPlanId) as { data: DisciplineRow[] | null; error: any };

      if (discError || !disciplines || disciplines.length === 0) {
        logger.error('[QUESTION-FIXER] ❌ Failed to fetch disciplines', { error: discError });
        return null;
      }

      // Buscar exams
      const { data: exams, error: examsError } = await supabase
        .from('exams')
        .select('exam_type, total_questions')
        .eq('plan_id', studyPlanId) as { data: ExamData[] | null; error: any };

      if (examsError || !exams || exams.length === 0) {
        logger.error('[QUESTION-FIXER] ❌ Failed to fetch exams', { error: examsError });
        return null;
      }

      const disciplinesData: DisciplineData[] = disciplines.map((d: DisciplineRow) => ({
        id: d.id,
        name: d.name,
        topics_count: Array.isArray(d.topics) ? d.topics.length : 0,
        current_questions: d.number_of_questions,
      }));

      logger.info('[QUESTION-FIXER] 📊 Data fetched', {
        transcriptionUrl: editalFile.transcription_url,
        disciplinesCount: disciplinesData.length,
        examsCount: exams.length,
      });

      return {
        transcriptionUrl: editalFile.transcription_url,
        disciplines: disciplinesData,
        exams: exams as ExamData[],
      };
    } catch (error) {
      logger.error('[QUESTION-FIXER] ❌ Failed to fetch data', {
        error: error instanceof Error ? error.message : 'Unknown error',
        studyPlanId,
      });
      return null;
    }
  }

  /**
   * Baixar edital TXT do Supabase Storage
   */
  private async fetchEditalText(transcriptionUrl: string): Promise<string | null> {
    try {
      logger.info('[QUESTION-FIXER] 📥 Downloading edital text', { transcriptionUrl });

      const response = await axios.get(transcriptionUrl, {
        responseType: 'text',
        timeout: 30000,
      });

      if (response.status !== 200 || !response.data) {
        logger.error('[QUESTION-FIXER] ❌ Failed to download edital', {
          status: response.status,
          url: transcriptionUrl,
        });
        return null;
      }

      const textLength = response.data.length;
      logger.info('[QUESTION-FIXER] ✅ Edital text downloaded', {
        size: `${Math.round(textLength / 1024)}KB`,
        chars: textLength,
      });

      return response.data;
    } catch (error) {
      logger.error('[QUESTION-FIXER] ❌ Failed to fetch edital text', {
        error: error instanceof Error ? error.message : 'Unknown error',
        url: transcriptionUrl,
      });
      return null;
    }
  }

  /**
   * Processar com Claude para extrair contagem de questões
   */
  private async processWithClaude(
    editalText: string,
    disciplines: DisciplineData[],
    exams: ExamData[]
  ): Promise<ClaudeResponse | null> {
    try {
      const client = new Anthropic({
        apiKey: process.env.CLAUDE_AI_API_KEY,
      });

      const prompt = this.buildPrompt(disciplines, exams, editalText);

      logger.info('[QUESTION-FIXER] 🤖 Calling Claude API', {
        model: anthropicConfig.model,
        temperature: anthropicConfig.temperature,
        maxTokens: anthropicConfig.max_tokens,
        promptSize: `${Math.round(prompt.length / 1024)}KB`,
      });

      const message = await client.messages.create({
        model: anthropicConfig.model,
        temperature: anthropicConfig.temperature,
        max_tokens: anthropicConfig.max_tokens,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const responseText = message.content[0].type === 'text' 
        ? message.content[0].text 
        : '';

      logger.info('[QUESTION-FIXER] 📝 Claude response received', {
        usage: message.usage,
        responseSize: `${Math.round(responseText.length / 1024)}KB`,
      });

      // Extrair JSON da resposta
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        logger.error('[QUESTION-FIXER] ❌ No JSON found in Claude response', {
          response: responseText.substring(0, 500),
        });
        return null;
      }

      const result: ClaudeResponse = JSON.parse(jsonMatch[0]);

      logger.info('[QUESTION-FIXER] ✅ Claude result parsed', {
        disciplinesProcessed: result.disciplines.length,
        totalAssigned: result.validation.total_assigned,
        matchesExam: result.validation.matches_exam,
        examCorrect: result.exam_validation.is_correct,
      });

      return result;
    } catch (error) {
      logger.error('[QUESTION-FIXER] ❌ Claude processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  }

  /**
   * Construir prompt para Claude (English for better interpretation)
   */
  private buildPrompt(
    disciplines: DisciplineData[],
    exams: ExamData[],
    editalText: string
  ): string {
    const objetivaExam = exams.find(e => e.exam_type === 'objetiva');
    const totalQuestions = objetivaExam?.total_questions || 0;

    return `You are an expert at analyzing Brazilian public examination notices (editais) and extracting structured information.

**TASK**: Determine the number of questions per discipline for an exam.

**EXAM INFORMATION**:
- Total Questions: ${totalQuestions}
- Exam Type: ${objetivaExam?.exam_type || 'objetiva'}

**DISCIPLINES** (${disciplines.length} total) - YOU MUST USE THESE EXACT IDs IN YOUR RESPONSE:
${disciplines.map((d, idx) => `${idx + 1}. ID="${d.id}" | Name="${d.name}" | Topics=${d.topics_count}`).join('\n')}

**EXTRACTION PRIORITY** (use in this order):
1. **Direct Mention**: If edital explicitly states "Discipline X: N questions" → use N
2. **Group Split**: If edital groups disciplines, distribute proportionally within groups
3. **Proportional Split**: Distribute based on number of topics per discipline

**PROPORTIONAL SPLIT ALGORITHM** (when no explicit info) - FOLLOW THIS EXACTLY:

Given: ${totalQuestions} total questions, ${disciplines.length} disciplines

Step 1 - Calculate base questions per discipline:
  base = floor(${totalQuestions} / ${disciplines.length}) = ${Math.floor(totalQuestions / disciplines.length)}

Step 2 - Calculate remainder to distribute:
  remainder = ${totalQuestions} - (base × ${disciplines.length})
  remainder = ${totalQuestions} - (${Math.floor(totalQuestions / disciplines.length)} × ${disciplines.length})
  remainder = ${totalQuestions - (Math.floor(totalQuestions / disciplines.length) * disciplines.length)}

Step 3 - Distribution rule:
  • Top ${totalQuestions - (Math.floor(totalQuestions / disciplines.length) * disciplines.length)} disciplines (sorted by topic count DESC) → ${Math.floor(totalQuestions / disciplines.length) + 1} questions each
  • Remaining ${disciplines.length - (totalQuestions - (Math.floor(totalQuestions / disciplines.length) * disciplines.length))} disciplines → ${Math.floor(totalQuestions / disciplines.length)} questions each

Step 4 - Verification (MANDATORY):
  Total = (${totalQuestions - (Math.floor(totalQuestions / disciplines.length) * disciplines.length)} × ${Math.floor(totalQuestions / disciplines.length) + 1}) + (${disciplines.length - (totalQuestions - (Math.floor(totalQuestions / disciplines.length) * disciplines.length))} × ${Math.floor(totalQuestions / disciplines.length)})
  Total = ${(totalQuestions - (Math.floor(totalQuestions / disciplines.length) * disciplines.length)) * (Math.floor(totalQuestions / disciplines.length) + 1)} + ${(disciplines.length - (totalQuestions - (Math.floor(totalQuestions / disciplines.length) * disciplines.length))) * Math.floor(totalQuestions / disciplines.length)} = ${totalQuestions} ✓

Example: If 3 disciplines have 10 topics each, and 2 have 5 topics each, the 3 with more topics get (base+1), others get base.

**EDITAL TEXT**:
${editalText}

**OUTPUT FORMAT** (JSON only, no markdown):
{
  "disciplines": [
    {
      "id": "discipline_id",
      "name": "Discipline Name",
      "questions": 10,
      "reasoning": "Explicit mention in section X" OR "Proportional split" OR "Group split with..."
    }
  ],
  "validation": {
    "total_assigned": 80,
    "matches_exam": true
  },
  "exam_validation": {
    "type": "objetiva",
    "declared_total": 80,
    "is_correct": true,
    "correct_total": 80
  }
}

**CRITICAL RULES**:
- YOU MUST USE THE EXACT UUID "id" VALUES PROVIDED ABOVE (e.g., "f346eafd-7777-4942-83ea-4573b1d3156c")
- DO NOT invent sequential IDs like "881", "882", etc.
- Sum of all "questions" MUST equal ${totalQuestions} EXACTLY
- Every discipline MUST be assigned a value > 0
- Use "reasoning" to explain each assignment
- If exam total is wrong in database, provide correct_total
- Return ONLY valid JSON (no markdown, no extra text)

**MANDATORY VERIFICATION BEFORE RETURNING JSON**:
1. Calculate sum = discipline[0].questions + discipline[1].questions + ... + discipline[N-1].questions
2. If sum ≠ ${totalQuestions} → ADJUST:
   • If sum < ${totalQuestions} → Add 1 question to disciplines with MOST topics until sum = ${totalQuestions}
   • If sum > ${totalQuestions} → Remove 1 question from disciplines with LEAST topics until sum = ${totalQuestions}
3. Recalculate sum and verify: sum = ${totalQuestions} EXACTLY
4. Only after verification passes, return the JSON

**DISCIPLINE IDs FOR REFERENCE**:
${disciplines.map(d => `- ${d.name}: ${d.id}`).join('\n')}

Analyze the edital, verify your math, and return the JSON now.`;
  }

  /**
   * Validar resultado do Claude
   */
  private validateResult(result: ClaudeResponse, exams: ExamData[]): boolean {
    const objetivaExam = exams.find(e => e.exam_type === 'objetiva');
    
    if (!objetivaExam) {
      logger.error('[QUESTION-FIXER] ❌ No objetiva exam found');
      return false;
    }

    const expectedTotal = objetivaExam.total_questions;
    const assignedTotal = result.disciplines.reduce((sum, d) => sum + d.questions, 0);

    // Detailed breakdown for debugging
    const breakdown = result.disciplines.map(d => `${d.name}: ${d.questions}`).join(', ');
    
    logger.info('[QUESTION-FIXER] 🔍 Validating result', {
      expectedTotal,
      assignedTotal,
      difference: assignedTotal - expectedTotal,
      matches: assignedTotal === expectedTotal,
      disciplineCount: result.disciplines.length,
      breakdown: breakdown.length > 200 ? `${breakdown.substring(0, 200)}...` : breakdown,
    });

    if (!result.validation.matches_exam) {
      logger.error('[QUESTION-FIXER] ❌ Claude validation mismatch', {
        claudeReportedTotal: result.validation.total_assigned,
        actualSum: assignedTotal,
        expected: expectedTotal,
        discrepancy: `Claude said ${result.validation.total_assigned} but sum is ${assignedTotal}`,
      });
      return false;
    }

    if (assignedTotal !== expectedTotal) {
      logger.warn('[QUESTION-FIXER] ⚠️  Sum mismatch detected, attempting algorithmic redistribution', {
        assigned: assignedTotal,
        expected: expectedTotal,
        difference: assignedTotal - expectedTotal,
        breakdown,
      });
      
      // Redistribuir algoritmicamente
      this.redistributeQuestions(result, expectedTotal);
      
      // Revalidar após redistribuição
      const newTotal = result.disciplines.reduce((sum, d) => sum + d.questions, 0);
      if (newTotal !== expectedTotal) {
        logger.error('[QUESTION-FIXER] ❌ Redistribution failed', {
          assigned: newTotal,
          expected: expectedTotal,
        });
        return false;
      }
      
      logger.info('[QUESTION-FIXER] ✅ Redistribution successful', {
        from: assignedTotal,
        to: newTotal,
      });
    }

    logger.info('[QUESTION-FIXER] ✅ Validation passed');
    return true;
  }

  /**
   * Redistribuir questões algoritmicamente
   * - Se diferença ≤ 10%: ajusta nas disciplinas com menos/mais tópicos
   * - Se diferença > 10%: redistribui igualitariamente entre todas
   */
  private redistributeQuestions(result: ClaudeResponse, expectedTotal: number): void {
    const assignedTotal = result.disciplines.reduce((sum, d) => sum + d.questions, 0);
    const difference = assignedTotal - expectedTotal;
    const percentDiff = Math.abs(difference / expectedTotal);

    logger.info('[QUESTION-FIXER] 🔄 Redistributing questions', {
      assignedTotal,
      expectedTotal,
      difference,
      percentDiff: `${(percentDiff * 100).toFixed(1)}%`,
    });

    if (percentDiff > 0.10) {
      // Diferença > 10%: redistribuir igualitariamente
      logger.info('[QUESTION-FIXER] 📊 Large difference (>10%), equal redistribution');
      
      const base = Math.floor(expectedTotal / result.disciplines.length);
      const remainder = expectedTotal - (base * result.disciplines.length);
      
      // Ordenar por número de tópicos (do maior pro menor)
      const sorted = [...result.disciplines].sort((a, b) => {
        const topicsA = parseInt(a.reasoning.match(/\d+/)?.[0] || '0');
        const topicsB = parseInt(b.reasoning.match(/\d+/)?.[0] || '0');
        return topicsB - topicsA;
      });
      
      // Distribuir: Top N recebem base+1, outros recebem base
      sorted.forEach((disc, idx) => {
        const original = result.disciplines.find(d => d.id === disc.id)!;
        original.questions = idx < remainder ? base + 1 : base;
        original.reasoning = `[AUTO-ADJUSTED] ${original.reasoning}`;
      });
      
    } else if (difference > 0) {
      // Excesso ≤ 10%: reduzir das disciplinas com MENOS tópicos
      logger.info('[QUESTION-FIXER] ➖ Reducing from disciplines with fewer topics');
      
      const sorted = [...result.disciplines]
        .filter(d => d.questions > 0)
        .sort((a, b) => {
          const topicsA = parseInt(a.reasoning.match(/\d+/)?.[0] || '0');
          const topicsB = parseInt(b.reasoning.match(/\d+/)?.[0] || '0');
          return topicsA - topicsB; // Menor pro maior
        });
      
      let remaining = difference;
      for (const disc of sorted) {
        if (remaining === 0) break;
        const original = result.disciplines.find(d => d.id === disc.id)!;
        if (original.questions > 1) {
          original.questions--;
          original.reasoning = `[AUTO-REDUCED] ${original.reasoning}`;
          remaining--;
        }
      }
      
    } else if (difference < 0) {
      // Falta ≤ 10%: adicionar nas disciplinas com MAIS tópicos
      logger.info('[QUESTION-FIXER] ➕ Adding to disciplines with more topics');
      
      const sorted = [...result.disciplines].sort((a, b) => {
        const topicsA = parseInt(a.reasoning.match(/\d+/)?.[0] || '0');
        const topicsB = parseInt(b.reasoning.match(/\d+/)?.[0] || '0');
        return topicsB - topicsA; // Maior pro menor
      });
      
      let remaining = Math.abs(difference);
      for (const disc of sorted) {
        if (remaining === 0) break;
        const original = result.disciplines.find(d => d.id === disc.id)!;
        original.questions++;
        original.reasoning = `[AUTO-INCREASED] ${original.reasoning}`;
        remaining--;
      }
    }
  }

  /**
   * Atualizar banco de dados
   */
  private async updateDatabase(studyPlanId: string, result: ClaudeResponse): Promise<void> {
    if (!supabase) return;

    try {
      // 1. Atualizar exam se necessário
      if (!result.exam_validation.is_correct) {
        logger.info('[QUESTION-FIXER] 📝 Updating exam total', {
          from: result.exam_validation.declared_total,
          to: result.exam_validation.correct_total,
        });

        const { error: examError } = await (supabase
          .from('exams') as any)
          .update({ total_questions: result.exam_validation.correct_total })
          .eq('plan_id', studyPlanId)
          .eq('exam_type', result.exam_validation.type);

        if (examError) {
          logger.error('[QUESTION-FIXER] ⚠️  Failed to update exam', { error: examError });
        } else {
          logger.info('[QUESTION-FIXER] ✅ Exam total updated');
        }
      }

      // 2. Atualizar disciplines em batch
      logger.info('[QUESTION-FIXER] 📝 Updating disciplines', {
        count: result.disciplines.length,
      });

      for (const disc of result.disciplines) {
        const { error: discError } = await (supabase
          .from('disciplines') as any)
          .update({ number_of_questions: disc.questions })
          .eq('id', disc.id);

        if (discError) {
          logger.error('[QUESTION-FIXER] ⚠️  Failed to update discipline', {
            id: disc.id,
            name: disc.name,
            error: discError,
          });
        }
      }

      logger.info('[QUESTION-FIXER] ✅ All disciplines updated', {
        count: result.disciplines.length,
        examUpdated: !result.exam_validation.is_correct,
      });
    } catch (error) {
      logger.error('[QUESTION-FIXER] ❌ Failed to update database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        studyPlanId,
      });
      throw error;
    }
  }
}

export const questionCounterFixerService = new QuestionCounterFixerService();
