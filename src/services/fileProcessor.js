const axios = require('axios');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { OpenAI } = require('openai');
const logger = require('../lib/logger');
const redis = require('../lib/redis');
const { sanitize } = require('../utils/sanitize');
const { openaiConfig } = require('../config/openai');

const openai = new OpenAI({ apiKey: openaiConfig.apiKey });

async function processTxt(file, conversationId) {
  const { fileId, url } = file;
  logger.info('Processing TXT file', { conversationId, fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const textContent = Buffer.from(response.data).toString('utf-8');
    const sanitizedText = sanitize(textContent);
    await redis.lpush(conversationId, sanitizedText);
    logger.info('Successfully processed TXT file', { conversationId, fileId });
    return { status: 'success', fileId };
  } catch (error) {
    logger.error('Error processing TXT file', { conversationId, fileId, error: error.message });
    return { status: 'error', fileId, error: error.message };
  }
}

async function processImage(file, conversationId) {
  const { fileId, url } = file;
  logger.info('Processing image file', { conversationId, fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(response.data).toString('base64');

    const aiResponse = await openai.chat.completions.create({
      model: openaiConfig.models.image,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image in detail.' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${file.mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
    });

    const description = aiResponse.choices[0].message.content;
    const sanitizedDescription = sanitize(description);
    await redis.lpush(conversationId, sanitizedDescription);
    logger.info('Successfully processed image file', { conversationId, fileId });
    return { status: 'success', fileId };
  } catch (error) {
    logger.error('Error processing image file', { conversationId, fileId, error: error.message });
    return { status: 'error', fileId, error: error.message };
  }
}

async function processPdf(file, conversationId) {
  const { fileId, url } = file;
  logger.info('Processing PDF file', { conversationId, fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const data = await pdf(buffer);

    if (data.text && data.text.trim().length > 50) {
      const sanitizedText = sanitize(data.text);
      await redis.lpush(conversationId, sanitizedText);
      logger.info('Successfully processed PDF with text extraction', { conversationId, fileId });
    } else {
      logger.warn('PDF text content is too short or empty. Fallback to OCR is not yet implemented.', { conversationId, fileId });
    }
    return { status: 'success', fileId };
  } catch (error) {
    logger.error('Error processing PDF file', { conversationId, fileId, error: error.message });
    return { status: 'error', fileId, error: error.message };
  }
}

async function processDocx(file, conversationId) {
  const { fileId, url } = file;
  logger.info('Processing DOCX file', { conversationId, fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const result = await mammoth.extractRawText({ buffer });
    const textContent = result.value;

    if (textContent && textContent.trim()) {
      const sanitizedText = sanitize(textContent);
      await redis.lpush(conversationId, sanitizedText);
      logger.info('Successfully processed DOCX file', { conversationId, fileId });
    } else {
      logger.warn('DOCX content is empty or could not be extracted.', { conversationId, fileId });
    }
    return { status: 'success', fileId };
  } catch (error) {
    logger.error('Error processing DOCX file', { conversationId, fileId, error: error.message });
    return { status: 'error', fileId, error: error.message };
  }
}

module.exports = {
  processTxt,
  processImage,
  processPdf,
  processDocx,
};
