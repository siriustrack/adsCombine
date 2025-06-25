const axios = require('axios');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { OpenAI } = require('openai');
const logger = require('../lib/logger');
const { sanitize } = require('../utils/sanitize');
const { openaiConfig } = require('../config/openai');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');

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

    // 2. Try direct text extraction
    const data = await pdf(buffer);
    if (data.text && data.text.trim().length > 100) { // Increased threshold
      logger.info('Successfully processed PDF with direct text extraction', { fileId });
      return sanitize(data.text);
    }

    // 3. Fallback to OCR using pdfjs-dist and canvas
    logger.info('Direct text extraction failed or insufficient. Falling back to OCR.', { fileId });

    const pdfDocument = await pdfjs.getDocument({ data: buffer }).promise;
    const numPages = pdfDocument.numPages;
    let fullText = '';

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDocument.getPage(i);
      // Increase scale for better quality and OCR accuracy
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      await page.render(renderContext).promise;
      // Clean up page resources to free up memory
      page.cleanup();

      // Get image as Base64
      const base64Image = canvas.toDataURL('image/png').split(',')[1];

      logger.info(`Processing PDF page ${i}/${numPages} via OCR`, { fileId });

      const aiResponse = await openai.chat.completions.create({
        model: openaiConfig.models.image, // Using the vision model
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all text from this document page. Return only the text content in PT-BR.' },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
      });

      const pageText = aiResponse.choices[0].message.content || '';
      fullText += pageText + '\n\n'; // Add space between pages
    }

    logger.info('Successfully processed PDF with OCR', { fileId, pages: numPages });
    return sanitize(fullText);

  } catch (error) {
    logger.error('Error processing PDF file', { fileId, error: error.message });
    throw error; // Re-throw to be caught by the route handler
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
