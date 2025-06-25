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

    // 3. Fallback to OCR using page-by-page image conversion
    logger.info('Direct text extraction failed or insufficient. Falling back to per-page OCR.', { fileId });
    const fs = require('fs');
    const path = require('path');
    const tmp = require('tmp');
    const { execSync } = require('child_process');

    // Write PDF buffer to temp file
    const tempPdf = tmp.fileSync({ postfix: '.pdf' });
    fs.writeFileSync(tempPdf.name, buffer);
    // Create temp dir for images
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    // Convert PDF to PNG pages via pdftoppm
    execSync(`pdftoppm -png "${tempPdf.name}" "${path.join(tempDir.name, 'page')}"`);
    // Read generated PNGs
    const pages = fs.readdirSync(tempDir.name)
      .filter(f => f.endsWith('.png'))
      .sort();
    let ocrResult = '';
    // OCR each page
    for (const pageFile of pages) {
      const imgPath = path.join(tempDir.name, pageFile);
      const imgBase64 = fs.readFileSync(imgPath).toString('base64');
      const aiResp = await openai.chat.completions.create({
        model: openaiConfig.models.image,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extraia o texto desta imagem de forma precisa e retorne somente o texto em PT-BR.' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${imgBase64}` } }
            ]
          }
        ]
      });
      ocrResult += aiResp.choices[0].message.content + '\n\n';
    }
    // Cleanup tmp files
    tempPdf.removeCallback();
    tempDir.removeCallback();
    const finalText = sanitize(ocrResult);
    logger.info('Successfully processed PDF with per-page OCR', { fileId });
    return finalText;

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
