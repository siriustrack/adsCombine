import { callOpenAIWithFallback, DEFAULT_CONFIG } from '../services/openai-client';
import type { StudyPlanData, AgentResponse } from '../types/types';

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
   - exams: Array de provas com examType ('objetiva', 'discursiva', 'prática', 'oral'), examDate (YYYY-MM-DD ou "a divulgar"), examTurn ('manha', 'tarde', 'noite'), totalQuestions (número).
   - disciplines: Array de disciplinas, cada uma com name (exato do texto), color (opcional, inferir se possível), numberOfQuestions (opcional), e topics como array de {name: exato do texto, weight: 1.0, 1.5 ou 2.0 baseado em complexidade ou padrão 1.0}.

3. Regras de Precisão:
   - Não invente dados; se algo não estiver no texto, omita ou use padrão seguro.
   - Para pesos: 1.0 básico, 1.5 intermediário, 2.0 avançado. Use 1.0 se incerto.
   - Datas: Converter para YYYY-MM-DD (ex.: 30/04/2023 → 2023-04-30).
   - Se múltiplos planos, liste em array separado.

4. Formato de Saída: Apenas JSON válido, sem texto adicional.

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

  // Limite de tokens: prompt + content < 4000
  const estimatedTokens = (PROMPT_TEMPLATE.length + sanitizedContent.length) / 4; // Rough estimate
  if (estimatedTokens > 3500) {
    return { success: false, error: 'Conteúdo excede limite de tokens (3500)' };
  }

  try {
    const prompt = PROMPT_TEMPLATE.replace('{content}', sanitizedContent);

    const response = await callOpenAIWithFallback(DEFAULT_CONFIG, [{ role: 'user', content: prompt }], 'identifier-agent', 'unknown');

    const result = response.choices[0]?.message?.content;
    if (!result) {
      return { success: false, error: 'Resposta vazia do OpenAI' };
    }

    const parsed = JSON.parse(result);
    if (!parsed.plans || !Array.isArray(parsed.plans)) {
      return { success: false, error: 'Formato de resposta inválido: esperado {plans: []}' };
    }

    // Validações de Output
    for (const plan of parsed.plans) {
      if (!plan.metadata?.examName || !plan.exams || !plan.disciplines) {
        return { success: false, error: 'Dados incompletos no plano identificado' };
      }
      // Validar tipos básicos
      if (typeof plan.metadata.examName !== 'string' || !Array.isArray(plan.exams)) {
        return { success: false, error: 'Tipos inválidos na resposta' };
      }
    }

    return { success: true, data: parsed.plans };
  } catch (error) {
    return { success: false, error: `Erro na identificação: ${(error as Error).message}` };
  }
}