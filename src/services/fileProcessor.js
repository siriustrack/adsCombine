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
            { type: 'text', text: 'Describe this image in detail. Return in PT_BR.' },
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
    // 1. Download PDF into a buffer
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // 2. Try direct text extraction first
    const data = await pdf(buffer);
    if (data.text && data.text.trim().length > 100) {
      logger.info('Successfully processed PDF with direct text extraction', { fileId });
      return sanitize(data.text);
    }

    // 3. Fallback to OCR using OpenAI vision model directly on PDF
    logger.info('Direct text extraction failed or insufficient. Falling back to OCR.', { fileId });
    
    // Convert buffer to base64 and try OCR directly on the PDF
    const base64Pdf = buffer.toString('base64');
    
    const aiResponse = await openai.chat.completions.create({
      model: openaiConfig.models.image,
      messages: [
        {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: 'Extract all text from this PDF document. Return only the text content in PT-BR. If you cannot read the PDF directly, please let me know.' 
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:application/pdf;base64,${base64Pdf}`,
              },
            },
          ],
        },
      ],
    });

    const extractedText = aiResponse.choices[0].message.content || '';
    
    if (extractedText && extractedText.trim().length > 50) {
      logger.info('Successfully processed PDF with direct PDF OCR', { fileId });
      return sanitize(extractedText);
    } else {
      logger.warn('PDF OCR extraction yielded insufficient text', { fileId });
      return sanitize('Conteúdo do PDF não pôde ser extraído adequadamente.');
    }

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
      logger.warn('DOCX content is empty or could not be extracted.', { fileId });
    }
    return extractedText;
  } catch (error) {
    logger.error('Error processing DOCX file', { fileId, error: error.message });
    throw error;
  }
}

module.exports = {
  processTxt,
  processImage,
  processPdf,
  processDocx,
};
