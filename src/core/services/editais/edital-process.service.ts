import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from 'config/dirs';
import { anthropicConfig } from 'config/anthropic';
import logger from 'lib/logger';

export interface EditalProcessRequest {
  user_id: string;
  schedule_plan_id: string;
  url: string;
}

export interface EditalProcessResponse {
  filePath: string;
  status: 'processing';
}

export class EditalProcessService {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: anthropicConfig.apiKey,
    });
  }

  async execute(request: EditalProcessRequest): Promise<EditalProcessResponse> {
    const { user_id, schedule_plan_id, url } = request;

    // Generate random filename
    const randomName = randomUUID();
    const fileName = `${randomName}.txt`;

    // Create directory path: /userid/schedule_plan_id/
    const userDir = path.join(PUBLIC_DIR, user_id);
    const scheduleDir = path.join(userDir, schedule_plan_id);
    const filePath = path.join(scheduleDir, fileName);

    // Ensure directories exist
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    if (!fs.existsSync(scheduleDir)) {
      fs.mkdirSync(scheduleDir, { recursive: true });
    }

    // Create empty file
    fs.writeFileSync(filePath, '', 'utf8');

    // Return response immediately
    const publicPath = `/${user_id}/${schedule_plan_id}/${fileName}`;

    // Process in background
    this.processInBackground(url, filePath);

    return {
      filePath: publicPath,
      status: 'processing',
    };
  }

  private async processInBackground(url: string, outputPath: string) {
    try {
      logger.info('Starting edital processing in background', { url, outputPath });

      // Fetch content from URL
      const response = await axios.get(url, {
        timeout: 30000, // 30 seconds timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EditalProcessor/1.0)',
        },
      });

      const content = response.data;
      logger.info('Content fetched successfully', { contentLength: content.length });

      // Process with Claude
      const processedContent = await this.processWithClaude(content);

      // Write result to file
      fs.writeFileSync(outputPath, processedContent, 'utf8');

      logger.info('Edital processing completed successfully', { outputPath });

    } catch (error) {
      logger.error('Error processing edital in background', {
        error: error instanceof Error ? error.message : 'Unknown error',
        url,
        outputPath,
      });

      // Write error to file
      const errorMessage = `Error processing edital: ${error instanceof Error ? error.message : 'Unknown error'}`;
      fs.writeFileSync(outputPath, errorMessage, 'utf8');
    }
  }

  private async processWithClaude(content: string): Promise<string> {
    // TODO: Add system prompt when provided by user
    const systemPrompt = `You are an expert at extracting and structuring information from public tender documents (editais).

Your task is to analyze the provided document and extract all relevant information in a structured, clear format.

Please provide a comprehensive analysis including:
- Basic information (title, organization, dates)
- Requirements and qualifications
- Selection process details
- Important deadlines
- Contact information
- Any other relevant details

Format your response in a clear, structured manner.`;

    const message = await this.anthropic.messages.create({
      model: anthropicConfig.model,
      max_tokens: anthropicConfig.maxTokens,
      temperature: anthropicConfig.temperature,
      top_p: anthropicConfig.topP,
      top_k: anthropicConfig.topK,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: content,
        },
      ],
    });

    return message.content[0].type === 'text' ? message.content[0].text : 'Error: Unexpected response format';
  }
}

export const editalProcessService = new EditalProcessService();