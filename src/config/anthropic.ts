export const anthropicConfig = {
  apiKey: process.env.CLAUDE_AI_API_KEY || '',
  model: 'claude-sonnet-4-5-20250929',
  maxTokens: 64000, // Increased to handle very detailed editals with extensive content (like Juiz SC with 2500+ lines JSON)
};