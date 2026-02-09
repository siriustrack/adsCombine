export const openaiConfig = {
  apiKey: process.env.OPENAI_API_KEY,
  models: {
    text: process.env.OPENAI_MODEL_TEXT || 'gpt-4o-mini',
    image: process.env.OPENAI_MODEL_IMAGE || 'gpt-4o-mini',
    audio: process.env.OPENAI_MODEL_AUDIO || 'whisper-1'
  }
};
