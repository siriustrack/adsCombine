import {
  callAnthropicWithRetry,
  DEFAULT_CONFIG,
} from '../services/anthropic-client';
import type { StudyPlanData, AgentResponse } from '../types/types';
import logger from '../../lib/logger';

const PROMPT_TEMPLATE = `
Você é um especialista em análise de editais de concursos públicos com precisão absoluta. Sua tarefa é identificar e extrair com 100% de precisão todos os planos de estudo presentes no conteúdo fornecido, sem inventar ou omitir informações.

Conteúdo do edital:
{content}

Instruções Detalhadas:
1. Identifique se há um ou mais planos de estudo (concursos distintos). Cada plano é definido por um concurso único (ex.: nome, órgão, datas).

2. Para cada plano, extraia exatamente do texto:
   - examName: Nome completo e exato do concurso.
   - examOrg: Órgão responsável (ex.: AGU, TJSC).
   - startDate: Data de início no formato YYYY-MM-DD. Se não explícita, inferir da primeira prova (ex.: 2023-04-30).
   - fixedOffDays: Dias de folga fixos como array de strings (ex.: ['sun', 'sat']). Opcional, deixe vazio se não mencionado.
   - notes: Observações gerais sobre o concurso.
   - exams: Array de provas (veja regras de normalização abaixo).
   - disciplines: Array de disciplinas (veja regras de estrutura abaixo).

3. REGRAS DE NORMALIZAÇÃO DE EXAMES:
   - examType: SEMPRE normalize para APENAS: 'objetiva', 'discursiva', 'prática', 'oral'
     * Variações aceitas: "pratica" → "prática", "escrita_pratica" → "prática", "pratico" → "prática"
     * REMOVA completamente fases de tipo: 'titulos', 'títulos', 'avaliacao_titulos' (não são exames avaliativos)
   - examDate: YYYY-MM-DD ou "a divulgar"
   - examTurn: SEMPRE normalize para APENAS: 'manha', 'tarde', 'noite'
     * Use 'tarde' como padrão se não especificado ou "nao_especificado"
   - totalQuestions: número exato ou null
   - **CRÍTICO: Crie um exam SEPARADO para cada fase do JSON, mesmo que tenham mesma data/turno. NÃO consolidar exams.**

4. REGRAS DE ESTRUTURA DE DISCIPLINAS (Detecção Semântica):
   **CASO 1 - Edital com Agrupadores:**
   Se o JSON contém agrupadores (nomes genéricos ou áreas amplas contendo sub-disciplinas):
   - Exemplos de agrupadores: "Grupo I", "Grupo A", "Bloco 1", "Conhecimento Jurídico", "Conhecimentos Gerais"
   - **IGNORE** o nível do agrupador (não extraia como discipline)
   - **EXTRAIA** as sub-disciplinas dentro do agrupador como disciplines
   - **EXTRAIA** os sub-tópicos das sub-disciplinas como topics
   - Exemplo: 
     * JSON: "Conhecimento Jurídico" → [materias: "Direito Constitucional", "Direito Administrativo"]
     * Output: disciplines = ["Direito Constitucional", "Direito Administrativo"]

   **CASO 2 - Edital Simples (sem agrupadores):**
   Se o JSON contém disciplinas diretas (específicas, não genéricas):
   - **USE** as disciplinas diretas como disciplines
   - **USE** as matérias/subtópicos dessas disciplinas como topics
   - Exemplo:
     * JSON: disciplinas = ["Direito Constitucional", "Direito Administrativo"]
     * Output: disciplines = ["Direito Constitucional", "Direito Administrativo"]

   **Como identificar agrupadores vs disciplinas:**
   - Agrupador: Nome genérico/abrangente + contém múltiplas sub-disciplinas específicas
   - Disciplina: Nome específico de uma área de conhecimento (ex: Direito Constitucional, Matemática)

5. Regras de Precisão:
   - Não invente dados; se algo não estiver no texto, omita ou use padrão seguro.
   - Para pesos de topics: 1.0 básico, 1.5 intermediário, 2.0 avançado. Use 1.0 se incerto.
   - Datas: Converter para YYYY-MM-DD (ex.: 30/04/2023 → 2023-04-30).
   - Se múltiplos planos, liste em array separado.

6. Formato de Saída: Apenas JSON válido, sem texto adicional.

Exemplo de Saída Precisa:
{
  "plans": [
    {
      "metadata": {
        "examName": "Concurso Público para o Provimento de Vagas... Advogado da União",
        "examOrg": "AGU",
        "startDate": "2023-04-30",
        "fixedOffDays": [],
        "notes": "Será eliminado o candidato que não obtiver a pontuação mínima..."
      },
      "exams": [
        {
          "examType": "objetiva",
          "examDate": "2023-04-30",
          "examTurn": "manha",
          "totalQuestions": 100
        },
        {
          "examType": "discursiva",
          "examDate": "2023-06-17",
          "examTurn": "tarde",
          "totalQuestions": 4
        }
      ],
      "disciplines": [
        {
          "name": "Direito Constitucional",
          "topics": [
            {"name": "História Constitucional do Brasil", "weight": 1.0},
            {"name": "Constitucionalismo", "weight": 1.5}
          ]
        }
      ]
    }
  ]
}
`;

export async function identifyPlans(content: string): Promise<AgentResponse<StudyPlanData[]>> {
  // Validações de Input
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { success: false, error: 'Conteúdo inválido: deve ser string não vazia' };
  }
  if (content.length > 100000) { // Limite para evitar overload
    return { success: false, error: 'Conteúdo muito longo: máximo 100k caracteres' };
  }

  // Sanitização básica: remover scripts/HTML se presente
  const sanitizedContent = content.replace(/<script[^>]*>.*?<\/script>/gis, '').replace(/<[^>]+>/g, '');

  // Limite de tokens: Claude Sonnet 4.5 tem 200K context window (1M em beta), 64K max output
  // Usando estimativa conservadora: 1 token ~= 4 caracteres
  // Input limit: 800K tokens (~3.2M chars) para deixar espaço para output + prompt
  // Porém, vamos usar limite conservador de 500K tokens (~2M chars) para performance
  const estimatedTokens = (PROMPT_TEMPLATE.length + sanitizedContent.length) / 4;
  if (estimatedTokens > 500000) {
    return { success: false, error: 'Conteúdo excede limite de tokens (500000). Claude Sonnet 4.5 suporta até 200K context (1M em beta).' };
  }

  try {
    const prompt = PROMPT_TEMPLATE.replace('{content}', sanitizedContent);

    // Chamar Claude Sonnet 4.5 com retry automático
    const result = await callAnthropicWithRetry(
      {
        ...DEFAULT_CONFIG,
        systemPrompt: 'Você é um especialista em análise de editais de concursos públicos com precisão absoluta.',
        cacheControl: true, // Ativar cache para economia (90% desconto em prompts repetidos)
      },
      [{ role: 'user', content: prompt }],
    );

    if (!result) {
      return { success: false, error: 'Resposta vazia do Claude Sonnet 4.5' };
    }

    // Limpar resultado (remover markdown fence e headers se presentes)
    let cleanedResult = result.trim();
    
    // Remover headers markdown (# Análise, ## Resultado, etc)
    cleanedResult = cleanedResult.replace(/^#+\s+.*$/gm, '');
    
    // Remover todos os markdown fences (```json, ```, etc)
    cleanedResult = cleanedResult.replace(/```[a-z]*\n?/gi, '');
    
    // Extrair o primeiro objeto JSON válido (ignora texto antes/depois)
    const jsonMatch = cleanedResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanedResult = jsonMatch[0].trim();
    } else {
      cleanedResult = cleanedResult.trim();
    }

    const parsed = JSON.parse(cleanedResult);
    if (!parsed.plans || !Array.isArray(parsed.plans)) {
      return { success: false, error: 'Formato de resposta inválida: esperado {plans: []}' };
    }

    // Sanitizar e validar dados
    for (const plan of parsed.plans) {
      if (!plan.metadata?.examName || !plan.exams || !plan.disciplines) {
        return { success: false, error: 'Dados incompletos no plano identificado' };
      }
      // Validar tipos básicos
      if (typeof plan.metadata.examName !== 'string' || !Array.isArray(plan.exams)) {
        return { success: false, error: 'Tipos inválidos na resposta' };
      }

      // Sanitizar e validar exams
      if (plan.exams && Array.isArray(plan.exams)) {
        plan.exams = plan.exams.filter((exam: any) => {
          // Validar que examType está nos valores permitidos
          const validTypes = ['objetiva', 'discursiva', 'prática', 'oral'];
          if (!exam.examType || !validTypes.includes(exam.examType)) {
            logger.warn('Exam com tipo inválido ou não normalizado pela IA', { 
              examType: exam.examType,
              examDate: exam.examDate 
            });
            return false; // Remove do array
          }

          // Validar que examTurn está nos valores permitidos
          const validTurns = ['manha', 'tarde', 'noite'];
          if (!exam.examTurn || !validTurns.includes(exam.examTurn)) {
            logger.warn('Exam com turno inválido, aplicando default', { 
              examTurn: exam.examTurn 
            });
            exam.examTurn = 'tarde'; // Default seguro
          }

          return true; // Mantém no array
        });
      }
    }

    return { success: true, data: parsed.plans };
  } catch (error) {
    return { success: false, error: `Erro na identificação: ${(error as Error).message}` };
  }
}