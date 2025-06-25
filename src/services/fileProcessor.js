const axios = require('axios');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { OpenAI } = require('openai');
const logger = require('../lib/logger');
const { sanitize } = require('../utils/sanitize');
const { openaiConfig } = require('../config/openai');

const openai = new OpenAI({ apiKey: openaiConfig.apiKey });

async function processTxt(file) {
  const { fileId, url } = file;
  logger.info('Processing TXT file', { fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const textContent = Buffer.from(response.data).toString('utf-8');
    const sanitizedText = sanitize(textContent);
    logger.info('Successfully processed TXT file', { fileId });
    return sanitizedText;
  } catch (error) {
    logger.error('Error processing TXT file', { fileId, error: error.message });
    throw error;
  }
}

async function processImage(file) {
  const { fileId, url } = file;
  logger.info('Processing image file', { fileId, url });
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
    logger.info('Successfully processed image file', { fileId });
    return sanitizedDescription;
  } catch (error) {
    logger.error('Error processing image file', { fileId, error: error.message });
    throw error;
  }
}

async function processPdf(file) {
  const { fileId, url } = file;
  logger.info('Processing PDF file', { fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const data = await pdf(buffer);

    let extractedText = '';
    if (data.text && data.text.trim().length > 50) {
      extractedText = sanitize(data.text);
      logger.info('Successfully processed PDF with text extraction', { fileId });
    } else {
      logger.warn('PDF text content is too short or empty. Fallback to OCR is not yet implemented.', { fileId });
    }
    return extractedText;
  } catch (error) {
    logger.error('Error processing PDF file', { fileId, error: error.message });
    throw error;
  }
}

async function processDocx(file) {
  const { fileId, url } = file;
  logger.info('Processing DOCX file', { fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const result = await mammoth.extractRawText({ buffer });
    const textContent = result.value;

    let extractedText = '';
    if (textContent && textContent.trim()) {
      extractedText = sanitize(textContent);
      logger.info('Successfully processed DOCX file', { fileId });
    } else {
      logger.warn('DOCX content is empty or could n