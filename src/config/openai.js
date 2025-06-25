
module.exports.openaiConfig = {
  apiKey: process.env.OPENAI_API_KEY,
  models: {
    text: process.env.OPENAI_MODEL_TEXT || 'gpt-4o-mini',
    image: process.env.OPENAI_MODEL_IMAGE || 'gpt-4o-mini',
  },
};
