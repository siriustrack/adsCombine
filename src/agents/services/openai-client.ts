import OpenAI from 'openai';
import { withRetry } from '../utils/retry';
import { logError } from '../utils/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Modelo focado em precisão: GPT-4o para tarefas estruturadas
export const MODEL = 'gpt-4o'; // Ou 'gpt-4-turbo' se necessário
export const FALLBACK_MODEL = 'gpt-3.5-turbo'; // Fallback para economia/capacidade

export interface OpenAIConfig {
  model: string;
  temperature: number; // Baixo para precisão
  maxTokens: number;
  responseFormat?: { type: 'json_object' }; // Para structured output
}

export const DEFAULT_CONFIG: OpenAIConfig = {
  model: MODEL,
  temperature: 0.1, // Baixo para consistência
  maxTokens: 2000, // Limite para evitar truncamento
  responseFormat: { type: 'json_object' }, // Força JSON para precisão
};

export const FALLBACK_CONFIG: OpenAIConfig = {
  model: FALLBACK_MODEL,
  temperature: 0.1,
  maxTokens: 2000,
  responseFormat: { type: 'json_object' },
};

// Função para tentar com modelo principal, fallback se falhar
export async function callOpenAIWithFallback(
  config: OpenAIConfig,
  messages: any[],
  agentId: string,
  userId: string
): Promise<any> {
  try {
    return await withRetry(
      () => openai.chat.completions.create({ ...config, messages }),
      { maxAttempts: 3, baseDelay: 1000, agentId, userId }
    );
  } catch (error: any) {
    if (error.code === 'rate_limit_exceeded' || error.code === 'model_not_found') {
      logError(agentId, userId, error, { fallback: true });
      // Tentar fallback
      return await withRetry(
        () => openai.chat.completions.create({ ...FALLBACK_CONFIG, messages }),
        { maxAttempts: 2, baseDelay: 2000, agentId, userId }
      );
    }
    throw error;
  }
}

export default openai;