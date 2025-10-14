import OpenAI from 'openai';
import { withRetry } from '../utils/retry';
import { logError } from '../utils/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Modelo principal: GPT-4.1-mini (1M context window, 16K max output, econômico)
// Fonte: https://openai.com/index/gpt-4-1/
export const MODEL = 'gpt-4.1-mini';
export const FALLBACK_MODEL = 'gpt-3.5-turbo'; // Fallback para casos extremos (16K context, 4K output)

export interface OpenAIConfig {
  model: string;
  temperature: number; // Baixo para precisão
  maxTokens: number;
  responseFormat?: { type: 'json_object' }; // Para structured output
}

export const DEFAULT_CONFIG: OpenAIConfig = {
  model: MODEL,
  temperature: 0.1, // Baixo para consistência
  maxTokens: 16000, // Limite máximo do GPT-4.1-mini (16K tokens de output)
  responseFormat: { type: 'json_object' }, // Força JSON para precisão
};

export const FALLBACK_CONFIG: OpenAIConfig = {
  model: FALLBACK_MODEL,
  temperature: 0.1,
  maxTokens: 4000, // Limite do GPT-3.5-turbo (4K tokens de output)
  responseFormat: { type: 'json_object' },
};

// Função para tentar com modelo principal, fallback se falhar
export async function callOpenAIWithFallback(
  config: OpenAIConfig,
  messages: any[],
  agentId: string,
  userId: string
): Promise<any> {
  // Converter camelCase para snake_case que a API OpenAI espera
  const apiConfig = {
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens, // API usa snake_case
    response_format: config.responseFormat, // API usa snake_case
    messages,
  };

  try {
    return await withRetry(
      () => openai.chat.completions.create(apiConfig),
      { maxAttempts: 3, baseDelay: 1000, agentId, userId }
    );
  } catch (error: any) {
    if (error.code === 'rate_limit_exceeded' || error.code === 'model_not_found') {
      logError(agentId, userId, error, { fallback: true });
      
      // Converter fallback config também
      const fallbackApiConfig = {
        model: FALLBACK_CONFIG.model,
        temperature: FALLBACK_CONFIG.temperature,
        max_tokens: FALLBACK_CONFIG.maxTokens,
        response_format: FALLBACK_CONFIG.responseFormat,
        messages,
      };
      
      // Tentar fallback
      return await withRetry(
        () => openai.chat.completions.create(fallbackApiConfig),
        { maxAttempts: 2, baseDelay: 2000, agentId, userId }
      );
    }
    throw error;
  }
}

export default openai;