export const anthropicConfig = {
  apiKey: process.env.CLAUDE_AI_API_KEY || '',
  model: 'claude-sonnet-4-5-20250929',
  maxTokens: 32000, // Aumentado para suportar JSONs maiores
};