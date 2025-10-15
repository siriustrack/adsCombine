import Anthropic from '@anthropic-ai/sdk';
import logger from '../../lib/logger';

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_AI_API_KEY,
});

// Modelo principal: Claude Sonnet 4.5 (melhor para agentes e coding)
// Fonte: https://docs.anthropic.com/en/docs/about-claude/models
// Context: 200K tokens (1M em beta), Output: 64K tokens
export const MODEL = 'claude-sonnet-4-5-20250929';

export interface AnthropicConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  cacheControl?: boolean; // Habilita prompt caching (90% desconto)
}

export const DEFAULT_CONFIG: AnthropicConfig = {
  model: MODEL,
  temperature: 0.3,
  maxTokens: 64000, // 4x maior que GPT-4.1-mini (16K)
  cacheControl: true, // Ativar cache para economia
};

export const FALLBACK_CONFIG: AnthropicConfig = {
  model: MODEL,
  temperature: 0.5, // Mais criativo em retry
  maxTokens: 32000, // Reduzir pela metade
  cacheControl: false,
};

/**
 * Chama Claude Sonnet 4.5 com retry automático
 * 
 * @param config - Configuração do modelo (temperatura, max tokens, etc)
 * @param messages - Array de mensagens (user/assistant)
 * @param retries - Número de tentativas (padrão: 3)
 * @returns Resposta do Claude como string
 * 
 * @example
 * const response = await callAnthropicWithRetry(
 *   { ...DEFAULT_CONFIG, systemPrompt: 'Você é um especialista' },
 *   [{ role: 'user', content: 'Extraia dados do JSON' }]
 * );
 */
export async function callAnthropicWithRetry(
  config: AnthropicConfig,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  retries = 3,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Tentativa ${attempt}/${retries} Claude Sonnet 4.5`, {
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });

      // Preparar mensagens no formato Anthropic
      const anthropicMessages = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Adicionar cache control no system prompt (se habilitado)
      const requestParams: Anthropic.MessageCreateParams = {
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: anthropicMessages,
        stream: false, // Sem streaming (requests < 10 min)
      };

      // System prompt com cache (economia de 90% em chamadas repetidas)
      if (config.systemPrompt) {
        requestParams.system = config.cacheControl
          ? [
              {
                type: 'text',
                text: config.systemPrompt,
                cache_control: { type: 'ephemeral' } as any, // Cache por 5 minutos
              } as any,
            ]
          : config.systemPrompt;
      }

      // Usar streaming para evitar timeout em operações longas (> 10 min)
      const stream = await anthropic.messages.stream(requestParams);
      
      let fullText = '';
      for await (const chunk of stream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          fullText += chunk.delta.text;
        }
      }

      const finalMessage = await stream.finalMessage();

      logger.info('✅ Claude Sonnet 4.5 respondeu com sucesso', {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        stopReason: finalMessage.stop_reason,
      });

      return fullText;
    } catch (error) {
      lastError = error as Error;
      logger.error(`❌ Erro na tentativa ${attempt}/${retries}`, {
        error: lastError.message,
        attempt,
      });

      // Se não for a última tentativa, aguardar antes de retry
      if (attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        logger.info(`⏳ Aguardando ${waitTime}ms antes de retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  // Se chegou aqui, todas as tentativas falharam
  logger.error('❌ Todas as tentativas falharam', {
    retries,
    lastError: lastError?.message,
  });

  // Tentar com configuração de fallback (temperatura maior, menos tokens)
  if (config.temperature !== FALLBACK_CONFIG.temperature) {
    logger.info('🔄 Tentando com configuração de fallback...', {
      originalTemp: config.temperature,
      fallbackTemp: FALLBACK_CONFIG.temperature,
    });

    try {
      const fallbackMessages = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const fallbackParams: Anthropic.MessageCreateParams = {
        model: FALLBACK_CONFIG.model,
        max_tokens: FALLBACK_CONFIG.maxTokens,
        temperature: FALLBACK_CONFIG.temperature,
        messages: fallbackMessages,
        stream: false,
      };

      if (config.systemPrompt) {
        fallbackParams.system = config.systemPrompt; // Sem cache no fallback
      }

      // Usar streaming também no fallback
      const fallbackStream = await anthropic.messages.stream(fallbackParams);
      
      let fallbackText = '';
      for await (const chunk of fallbackStream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          fallbackText += chunk.delta.text;
        }
      }

      const fallbackFinal = await fallbackStream.finalMessage();

      logger.info('✅ Fallback bem-sucedido', {
        inputTokens: fallbackFinal.usage.input_tokens,
        outputTokens: fallbackFinal.usage.output_tokens,
      });

      return fallbackText;
    } catch (fallbackError) {
      logger.error('❌ Fallback também falhou', {
        error: (fallbackError as Error).message,
      });
      throw fallbackError;
    }
  }

  throw lastError;
}

export default anthropic;
