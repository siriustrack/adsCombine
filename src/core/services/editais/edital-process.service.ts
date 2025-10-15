import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from 'config/dirs';
import { anthropicConfig } from 'config/anthropic';
import logger from 'lib/logger';
import { 
  EditalProcessado, 
  EditalProcessadoSchema, 
  validateEditalIntegrity,
  type Concurso 
} from './edital-schema';
import { EditalChunker, type ContentChunk } from './edital-chunker';

export interface EditalProcessRequest {
  user_id: string;
  schedule_plan_id: string;
  url: string;
  options?: {
    maxRetries?: number;
    chunkingEnabled?: boolean;
    validateSchema?: boolean;
  };
}

export interface EditalProcessResponse {
  filePath: string;
  status: 'processing';
  jobId: string;
}

export class EditalProcessService {
  private anthropic: Anthropic;
  private chunker: EditalChunker;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000; // ms

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: anthropicConfig.apiKey,
    });
    this.chunker = new EditalChunker({
      maxChunkSize: 80000, // ~20k tokens
      overlapSize: 2000,
      splitOn: 'section',
    });
  }

  async execute(request: EditalProcessRequest): Promise<EditalProcessResponse> {
    const { user_id, schedule_plan_id, url, options } = request;
    const jobId = randomUUID();

    logger.info('[EDITAL-SERVICE] 🎯 Starting edital processing', { 
      jobId, 
      user_id, 
      schedule_plan_id, 
      url,
      urlDomain: new URL(url).hostname,
    });

    // Generate random filename
    const randomName = randomUUID();
    const fileName = `${randomName}.json`; // Mudado para .json

    // Create directory path: /userid/schedule_plan_id/
    const userDir = path.join(PUBLIC_DIR, user_id);
    const scheduleDir = path.join(userDir, schedule_plan_id);
    const filePath = path.join(scheduleDir, fileName);

    logger.info('[EDITAL-SERVICE] 📁 Creating directories', { 
      jobId,
      userDir, 
      scheduleDir,
      fileName,
    });

    // Ensure directories exist
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
      logger.info('[EDITAL-SERVICE] ✅ Created user directory', { jobId, userDir });
    }
    if (!fs.existsSync(scheduleDir)) {
      fs.mkdirSync(scheduleDir, { recursive: true });
      logger.info('[EDITAL-SERVICE] ✅ Created schedule directory', { jobId, scheduleDir });
    }

    // Create empty file with processing status
    const processingStatus = {
      status: 'processing',
      jobId,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(processingStatus, null, 2), 'utf8');
    
    logger.info('[EDITAL-SERVICE] 📝 Created processing status file', { 
      jobId, 
      filePath,
    });

    // Return response immediately
    const publicPath = `/files/${user_id}/${schedule_plan_id}/${fileName}`;

    logger.info('[EDITAL-SERVICE] ⚡ Returning immediate response, processing will continue in background', { 
      jobId, 
      publicPath,
      status: 'processing',
    });

    // Process in background
    this.processInBackground(url, filePath, jobId, options);

    return {
      filePath: publicPath,
      status: 'processing',
      jobId,
    };
  }

  private async processInBackground(
    url: string, 
    outputPath: string,
    jobId: string,
    options?: EditalProcessRequest['options']
  ) {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      logger.info('[EDITAL-BG] ⏱️  Processing time elapsed', { elapsed, jobId });
    }, 10000);

    try {
      logger.info('[EDITAL-BG] 🔄 Starting background processing', { url, jobId });

      // Step 1: Fetch content from URL with retry
      logger.info('[EDITAL-BG] 📥 Step 1/7: Fetching content from URL', { url, jobId });
      const content = await this.fetchContentWithRetry(url, options?.maxRetries || this.MAX_RETRIES);
      logger.info('[EDITAL-BG] ✅ Step 2/7: Content fetched successfully', { 
        contentLength: content.length,
        contentSizeKB: Math.floor(content.length / 1024),
        estimatedTokens: Math.floor(content.length / 4),
        url,
        jobId,
      });

      // Step 3: Claude Sonnet 4.5 has 200K token context window (800K chars)
      // Our editals are typically ~180K chars = ~45K tokens
      // No need for chunking! Process entire document at once
      logger.info('[EDITAL-BG] 🔍 Step 3/7: Analyzing content size', { 
        contentLength: content.length,
        estimatedTokens: Math.floor(content.length / 4),
        contextWindowTokens: 200000,
        chunkingDisabled: 'Claude Sonnet 4.5 has 200K context - no chunking needed',
        jobId,
      });

      // Step 4: Process with Claude (entire document at once)
      logger.info('[EDITAL-BG] 🤖 Step 4/7: Starting AI processing with Claude', { 
        model: anthropicConfig.model,
        processingMode: 'full-document',
        jobId,
      });

      const processedData = await this.processWithClaude(content);

      logger.info('[EDITAL-BG] ✅ Step 5/7: AI processing completed', { 
        concursos: processedData.concursos.length,
        totalDisciplinas: processedData.validacao.totalDisciplinas,
        totalQuestoes: processedData.validacao.totalQuestoes,
        jobId,
      });

      // Step 6: Validate schema
      if (options?.validateSchema ?? true) {
        logger.info('[EDITAL-BG] ✔️  Step 6/7: Validating schema and integrity', { jobId });
        const validation = validateEditalIntegrity(processedData);
        
        if (!validation.isValid) {
          logger.error('[EDITAL-BG] ❌ Schema validation failed', { 
            errors: validation.errors,
            warnings: validation.warnings,
            jobId,
          });
          // Adiciona erros na validação do próprio dado
          processedData.validacao.erros.push(...validation.errors);
          processedData.validacao.avisos.push(...validation.warnings);
          processedData.validacao.integridadeOK = false;
        } else if (validation.warnings.length > 0) {
          logger.warn('[EDITAL-BG] ⚠️  Schema validation warnings', { 
            warnings: validation.warnings,
            jobId,
          });
          processedData.validacao.avisos.push(...validation.warnings);
        } else {
          logger.info('[EDITAL-BG] ✅ Schema validation passed', { jobId });
        }
      }

      // Step 7: Write result to file
      logger.info('[EDITAL-BG] 💾 Step 7/7: Writing processed content to file', { 
        outputPath,
        jobId,
      });
      const finalOutput = {
        ...processedData,
        metadataProcessamento: {
          ...processedData.metadataProcessamento,
          tempoProcessamento: Math.floor((Date.now() - startTime) / 1000),
          jobId,
          url,
          processadoEm: new Date().toISOString(),
        }
      };

      fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2), 'utf8');

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      logger.info('[EDITAL-BG] 🎉 Edital processing completed successfully', { 
        outputPath, 
        totalTime,
        totalTimeFormatted: `${Math.floor(totalTime / 60)}m ${totalTime % 60}s`,
        jobId,
        concursos: processedData.concursos.length,
        totalDisciplinas: processedData.validacao.totalDisciplinas,
        totalQuestoes: processedData.validacao.totalQuestoes,
        integridadeOK: processedData.validacao.integridadeOK,
      });

    } catch (error) {
      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      logger.error('[EDITAL-BG] ❌ Critical error during processing', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        url,
        outputPath,
        jobId,
        totalTime,
        totalTimeFormatted: `${Math.floor(totalTime / 60)}m ${totalTime % 60}s`,
      });

      // Write error to file in JSON format
      const errorOutput = {
        status: 'error',
        jobId,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          url,
        },
        concursos: [],
        validacao: {
          totalDisciplinas: 0,
          totalQuestoes: 0,
          totalMaterias: 0,
          integridadeOK: false,
          avisos: [],
          erros: [error instanceof Error ? error.message : 'Unknown error'],
        },
        metadataProcessamento: {
          dataProcessamento: new Date().toISOString(),
          versaoSchema: '1.0',
          tempoProcessamento: Math.floor((Date.now() - startTime) / 1000),
          modeloIA: anthropicConfig.model,
          jobId,
        }
      };

      fs.writeFileSync(outputPath, JSON.stringify(errorOutput, null, 2), 'utf8');
    } finally {
      clearInterval(timer);
    }
  }

  /**
   * Fetch content with retry logic
   */
  private async fetchContentWithRetry(url: string, maxRetries: number): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info('[EDITAL-FETCH] 📡 Attempting to fetch content', { 
          url, 
          attempt, 
          maxRetries,
          urlDomain: new URL(url).hostname,
        });
        
        const response = await axios.get(url, {
          timeout: 30000, // 30 seconds timeout
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; EditalProcessor/1.0)',
          },
          maxContentLength: 50 * 1024 * 1024, // 50MB max
        });

        logger.info('[EDITAL-FETCH] ✅ Content fetched successfully', {
          url,
          attempt,
          statusCode: response.status,
          contentType: response.headers['content-type'],
          contentLength: response.data?.length || 0,
        });

        return response.data;
      } catch (error) {
        lastError = error as Error;
        logger.warn('[EDITAL-FETCH] ⚠️  Failed to fetch content', { 
          url, 
          attempt, 
          maxRetries, 
          error: error instanceof Error ? error.message : 'Unknown' 
        });

        if (attempt < maxRetries) {
          const delay = this.RETRY_DELAY * attempt; // Exponential backoff
          logger.info('[EDITAL-FETCH] 🔄 Retrying after delay', { 
            delay, 
            delaySeconds: delay / 1000,
            attempt,
            nextAttempt: attempt + 1,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logger.error('[EDITAL-FETCH] ❌ All fetch attempts failed', { 
      url, 
      maxRetries,
      lastError: lastError?.message,
    });
    throw new Error(`Failed to fetch content after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Process content with chunking for large editals
   */
  private async processWithChunking(content: string): Promise<EditalProcessado> {
    logger.info('Processing large content with chunking strategy');
    
    const chunks = this.chunker.chunkContent(content);
    const sharedContext = this.chunker.extractSharedContext(chunks);

    logger.info('Content chunked', { 
      totalChunks: chunks.length,
      sharedContextLength: sharedContext.length 
    });

    const allConcursos: Concurso[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    // Process each chunk
    for (const chunk of chunks) {
      try {
        logger.info('Processing chunk', { 
          chunkId: chunk.id, 
          chunkSize: chunk.content.length,
          totalChunks: chunks.length 
        });

        // Prepend shared context to each chunk
        const contentWithContext = sharedContext 
          ? `${sharedContext}\n\n--- CONTINUAÇÃO DO EDITAL (CHUNK ${chunk.id + 1}/${chunks.length}) ---\n\n${chunk.content}`
          : chunk.content;

        const chunkResult = await this.processWithClaude(contentWithContext, {
          isChunk: true,
          chunkId: chunk.id,
          totalChunks: chunks.length,
        });

        // Merge results
        allConcursos.push(...chunkResult.concursos);
        warnings.push(...chunkResult.validacao.avisos);
        errors.push(...chunkResult.validacao.erros);

      } catch (error) {
        const errorMsg = `Error processing chunk ${chunk.id}: ${error instanceof Error ? error.message : 'Unknown'}`;
        logger.error('Chunk processing failed', { chunkId: chunk.id, error: errorMsg });
        errors.push(errorMsg);
      }
    }

    // Merge and deduplicate concursos (may have duplicates across chunks)
    const uniqueConcursos = this.deduplicateConcursos(allConcursos);

    logger.info('Chunking processing completed', { 
      totalConcursos: uniqueConcursos.length,
      totalErrors: errors.length,
      totalWarnings: warnings.length 
    });

    return {
      concursos: uniqueConcursos,
      validacao: {
        totalDisciplinas: uniqueConcursos.reduce((acc, c) => acc + c.disciplinas.length, 0),
        totalQuestoes: uniqueConcursos.reduce((acc, c) => acc + c.metadata.totalQuestions, 0),
        totalMaterias: uniqueConcursos.reduce((acc, c) => 
          acc + c.disciplinas.reduce((acc2, d) => acc2 + d.materias.length, 0), 0
        ),
        integridadeOK: errors.length === 0,
        avisos: warnings,
        erros: errors,
      },
      metadataProcessamento: {
        dataProcessamento: new Date().toISOString(),
        versaoSchema: '1.0',
        modeloIA: anthropicConfig.model,
      },
    };
  }

  /**
   * Deduplicate concursos that may appear in multiple chunks
   */
  private deduplicateConcursos(concursos: Concurso[]): Concurso[] {
    const seen = new Map<string, Concurso>();

    for (const concurso of concursos) {
      const key = `${concurso.metadata.examName}|${concurso.metadata.examOrg}|${concurso.metadata.startDate}`;
      
      if (!seen.has(key)) {
        seen.set(key, concurso);
      } else {
        // Merge disciplinas if same concurso appears in multiple chunks
        const existing = seen.get(key)!;
        const existingDisciplineNames = new Set(existing.disciplinas.map(d => d.nome));
        
        for (const disciplina of concurso.disciplinas) {
          if (!existingDisciplineNames.has(disciplina.nome)) {
            existing.disciplinas.push(disciplina);
          }
        }
      }
    }

    return Array.from(seen.values());
  }

  private async processWithClaude(
    content: string,
    context?: { isChunk?: boolean; chunkId?: number; totalChunks?: number }
  ): Promise<EditalProcessado> {
    const chunkInfo = context?.isChunk 
      ? `\n\n**IMPORTANTE**: Este é o CHUNK ${(context.chunkId || 0) + 1} de ${context.totalChunks}. Extraia APENAS os dados presentes neste segmento.`
      : '';

    const systemPrompt = `# AGENTE EXTRATOR DE EDITAIS - MODO JSON ESTRUTURADO

Você é um especialista em análise e extração de dados de editais de concursos públicos brasileiros.

## OBJETIVO CRÍTICO

Extrair com **100% de precisão** TODAS as informações sobre disciplinas, matérias e distribuição de questões das provas objetivas.

## FORMATO DE SAÍDA OBRIGATÓRIO

Sua resposta DEVE ser EXCLUSIVAMENTE um JSON válido seguindo EXATAMENTE este schema:

\`\`\`json
{
  "concursos": [
    {
      "metadata": {
        "examName": "string (nome COMPLETO e EXATO do concurso)",
        "examOrg": "string (órgão responsável)",
        "cargo": "string (opcional - nome do cargo)",
        "area": "string (opcional - área)",
        "startDate": "YYYY-MM-DD (data da prova objetiva)",
        "examTurn": "manha|tarde|noite|integral|nao_especificado (use 'nao_especificado' se não estiver claro)",
        "totalQuestions": number (total de questões da prova objetiva, mínimo 1),
        "notaMinimaAprovacao": number (opcional),
        "notaMinimaEliminatoria": number (opcional),
        "criteriosEliminatorios": ["string", "string"],
        "notes": "string (observações importantes)"
      },
      "fases": [
        {
          "tipo": "objetiva|discursiva|pratica|oral|titulos|aptidao_fisica",
          "data": "YYYY-MM-DD ou 'a_divulgar'",
          "turno": "manha|tarde|noite|integral|nao_especificado",
          "totalQuestoes": number (opcional),
          "caraterEliminatorio": boolean,
          "notaMinima": number (opcional),
          "peso": number (default 1.0)
        }
      ],
      "disciplinas": [
        {
          "nome": "string (nome EXATO da disciplina conforme edital)",
          "numeroQuestoes": number,
          "peso": number (default 1.0),
          "materias": [
            {
              "nome": "string (nome COMPLETO e LITERAL da matéria)",
              "ordem": number (sequencial 1, 2, 3...),
              "subtopicos": ["string", "string"],
              "legislacoes": [
                {
                  "tipo": "lei|decreto|decreto_lei|resolucao|portaria|instrucao_normativa|sumula",
                  "numero": "string (ex: '8112')",
                  "ano": "string (ex: '1990')",
                  "nome": "string (nome da legislação)",
                  "complemento": "string (opcional)"
                }
              ],
              "bibliografia": "string (opcional)",
              "observacoes": "string (opcional)"
            }
          ],
          "observacoes": "string (opcional)"
        }
      ]
    }
  ],
  "validacao": {
    "totalDisciplinas": number,
    "totalQuestoes": number,
    "totalMaterias": number,
    "integridadeOK": boolean,
    "avisos": ["string"],
    "erros": ["string"]
  },
  "metadataProcessamento": {
    "dataProcessamento": "ISO 8601 timestamp",
    "versaoSchema": "1.0",
    "modeloIA": "claude-3-5-sonnet-20241022"
  }
}
\`\`\`

## REGRAS CRÍTICAS DE EXTRAÇÃO

### 1. PRECISÃO ABSOLUTA
- ✅ Copie nomes LITERALMENTE como aparecem no edital
- ✅ Não parafrasie, interprete ou resuma
- ✅ Preserve pontuação, acentos e maiúsculas exatas
- ❌ NUNCA invente dados que não estejam explícitos

### 2. DATAS
- Converta DD/MM/AAAA para YYYY-MM-DD
- Ex: "30/04/2023" → "2023-04-30"
- Se data não estiver especificada ou for "a divulgar": use null
- OBRIGATÓRIO: startDate deve ser YYYY-MM-DD válido OU null (sem aspas no JSON)

### 3. VALORES OBRIGATÓRIOS
- examTurn: Se não especificado, use "nao_especificado"
- totalQuestions: DEVE ser >= 1 (some todas as questões das disciplinas)
- fases: DEVE ter ao menos 1 fase (mínimo: prova objetiva)
- disciplinas: DEVE ter ao menos 1 disciplina

### 4. DISCIPLINAS E MATÉRIAS
- Extraia TODAS as disciplinas da prova objetiva
- Para cada disciplina, capture o número EXATO de questões
- Se o número de questões NÃO estiver especificado para uma disciplina: use 0
- Liste TODAS as matérias na ordem que aparecem
- Se NÃO encontrar matérias detalhadas para uma disciplina: crie matéria genérica com nome da disciplina
- IMPORTANTE: SEMPRE crie pelo menos 1 matéria, mesmo que seja genérica
- EXEMPLO de disciplina sem detalhes: crie matéria genérica "Nome da Disciplina - Conteúdo Geral"
- Use campo "ordem" sequencial (1, 2, 3, ...)

### 4. LEGISLAÇÕES
- Capture número completo: "Lei nº 8.112/1990" → {"tipo": "lei", "numero": "8112", "ano": "1990"}
- Inclua nome: "nome": "Regime Jurídico dos Servidores Públicos"
- Tipos válidos: lei, decreto, decreto_lei, resolucao, portaria, instrucao_normativa, sumula

### 5. SUBTÓPICOS
- Se matéria tem itens numerados (1.1, 1.2, etc), adicione em "subtopicos"
- Mantenha hierarquia e ordem
- Ex: "1. Direito Constitucional" com "1.1 Princípios" → subtopicos: ["1.1 Princípios"]

### 6. VALIDAÇÃO
- Some questões de todas as disciplinas
- Verifique se soma == totalQuestions do metadata
- Se divergir, adicione em "avisos" do objeto validacao
- Marque "integridadeOK": true apenas se tudo estiver correto

### 7. MÚLTIPLOS CONCURSOS
- Se edital tem vários cargos/concursos, crie entrada separada no array "concursos"
- Cada concurso é um objeto completo com metadata, fases e disciplinas próprias

${chunkInfo}

## EXEMPLO DE SAÍDA

\`\`\`json
{
  "concursos": [
    {
      "metadata": {
        "examName": "Analista Judiciário - Área Judiciária",
        "examOrg": "TRF3",
        "cargo": "Analista Judiciário",
        "area": "Judiciária",
        "startDate": "2025-03-15",
        "examTurn": "manha",
        "totalQuestions": 120,
        "notaMinimaEliminatoria": 40,
        "criteriosEliminatorios": ["Nota inferior a 40 pontos na prova objetiva"],
        "notes": "Caráter eliminatório e classificatório"
      },
      "fases": [
        {
          "tipo": "objetiva",
          "data": "2025-03-15",
          "turno": "manha",
          "totalQuestoes": 120,
          "caraterEliminatorio": true,
          "notaMinima": 40,
          "peso": 1.0
        },
        {
          "tipo": "discursiva",
          "data": "2025-03-15",
          "turno": "tarde",
          "totalQuestoes": 2,
          "caraterEliminatorio": true,
          "peso": 2.0
        }
      ],
      "disciplinas": [
        {
          "nome": "Língua Portuguesa",
          "numeroQuestoes": 15,
          "peso": 1.0,
          "materias": [
            {
              "nome": "Compreensão e interpretação de textos",
              "ordem": 1,
              "subtopicos": [],
              "legislacoes": []
            },
            {
              "nome": "Ortografia oficial",
              "ordem": 2,
              "subtopicos": ["Acordo Ortográfico vigente", "Acentuação gráfica"],
              "legislacoes": []
            }
          ]
        },
        {
          "nome": "Direito Constitucional",
          "numeroQuestoes": 20,
          "peso": 1.0,
          "materias": [
            {
              "nome": "Constituição Federal de 1988",
              "ordem": 1,
              "subtopicos": ["Princípios fundamentais", "Direitos e garantias fundamentais"],
              "legislacoes": []
            },
            {
              "nome": "Regime Jurídico dos Servidores Públicos",
              "ordem": 2,
              "subtopicos": [],
              "legislacoes": [
                {
                  "tipo": "lei",
                  "numero": "8112",
                  "ano": "1990",
                  "nome": "Regime Jurídico dos Servidores Públicos Civis da União"
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "validacao": {
    "totalDisciplinas": 2,
    "totalQuestoes": 35,
    "totalMaterias": 4,
    "integridadeOK": false,
    "avisos": ["Soma das questões (35) difere do total declarado (120). Possível extração parcial."],
    "erros": []
  },
  "metadataProcessamento": {
    "dataProcessamento": "${new Date().toISOString()}",
    "versaoSchema": "1.0",
    "modeloIA": "claude-3-5-sonnet-20241022"
  }
}
\`\`\`

## INSTRUÇÕES FINAIS

1. Retorne APENAS o JSON, sem texto adicional, sem markdown, sem explicações
2. Garanta que o JSON seja válido e parseável
3. Siga o schema EXATAMENTE
4. Em caso de dúvida, prefira omitir campo opcional a inventar dados
5. Valide soma de questões e reporte divergências em "avisos"

**Proceda com a extração agora.**`;

    let responseText = '';

    try {
      logger.info('Calling Claude API with streaming', { 
        model: anthropicConfig.model,
        contentLength: content.length,
        isChunk: context?.isChunk 
      });

      // Use streaming para evitar timeout de 10 minutos
      const stream = this.anthropic.messages.stream({
        model: anthropicConfig.model,
        max_tokens: anthropicConfig.maxTokens,
        temperature: 0, // Zero para máxima precisão estrutural
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Extraia os dados deste edital seguindo o schema JSON especificado:\n\n${content}`,
          },
        ],
      });

      // Acumular resposta do streaming
      responseText = '';
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          responseText += chunk.delta.text;
        }
      }
      
      if (!responseText) {
        throw new Error('Empty response from Claude streaming');
      }

      logger.info('Claude streaming response received', { responseLength: responseText.length });

      // Save raw response for debugging (optional, can be removed in production)
      if (process.env.DEBUG_SAVE_RAW_RESPONSE) {
        const debugPath = `/tmp/claude-raw-response-${Date.now()}.txt`;
        require('node:fs').writeFileSync(debugPath, responseText, 'utf-8');
        logger.debug('Saved raw Claude response', { debugPath });
      }

      // Parse and validate JSON
      const parsed = JSON.parse(responseText);
      
      // Validate with Zod schema
      const validated = EditalProcessadoSchema.parse(parsed);

      logger.info('JSON parsed and validated successfully', {
        concursos: validated.concursos.length,
        totalDisciplinas: validated.validacao.totalDisciplinas,
      });

      return validated;

    } catch (error) {
      if (error instanceof Error) {
        logger.error('Error processing with Claude', {
          error: error.message,
          stack: error.stack,
          isChunk: context?.isChunk,
        });

        // If JSON parsing failed, try to extract JSON from response
        if (error.name === 'SyntaxError' && responseText) {
          logger.warn('Attempting to extract JSON from malformed response');
          
          // Remove markdown code blocks (```json ... ``` or ``` ... ```)
          let cleanedResponse = responseText.trim();
          
          // Try multiple extraction strategies
          // 1. Try to find JSON between backticks
          let codeBlockMatch = cleanedResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
          if (codeBlockMatch) {
            cleanedResponse = codeBlockMatch[1].trim();
            logger.info('Extracted JSON from markdown code block (strategy 1)');
          } else {
            // 2. Try to find just the opening { and closing }
            const firstBrace = cleanedResponse.indexOf('{');
            const lastBrace = cleanedResponse.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
              logger.info('Extracted JSON by finding braces (strategy 2)');
            }
          }
          
          // Try to parse the cleaned response
          try {
            const parsed = JSON.parse(cleanedResponse);
            const validated = EditalProcessadoSchema.parse(parsed);
            
            logger.info('Successfully recovered JSON from malformed response', {
              concursos: validated.concursos.length,
              totalDisciplinas: validated.validacao.totalDisciplinas,
            });
            
            return validated;
          } catch (retryError) {
            // Save cleaned response for debugging
            const debugPath = `/tmp/claude-cleaned-json-${Date.now()}.json`;
            require('node:fs').writeFileSync(debugPath, cleanedResponse, 'utf-8');
            logger.error('Failed to extract JSON even after cleanup - saved to file', {
              error: retryError instanceof Error ? retryError.message : 'Unknown error',
              debugPath,
            });
            
            // Log the parsed JSON for debugging (before validation)
            try {
              const parsed = JSON.parse(cleanedResponse);
              logger.warn('Parsed JSON but validation failed - returning raw structure', {
                concursos: parsed.concursos?.length || 0,
              });
              // Return the raw parsed structure even if validation fails
              return parsed;
            } catch (finalError) {
              const finalDebugPath = `/tmp/claude-failed-json-${Date.now()}.txt`;
              require('node:fs').writeFileSync(finalDebugPath, cleanedResponse, 'utf-8');
              logger.error('Complete JSON parsing failure - saved to file', {
                error: finalError instanceof Error ? finalError.message : 'Unknown error',
                finalDebugPath,
              });
              // If even parsing fails after cleanup, fall through to error return
            }
          }
        }
      }

      // Return error structure
      return {
        concursos: [],
        validacao: {
          totalDisciplinas: 0,
          totalQuestoes: 0,
          totalMaterias: 0,
          integridadeOK: false,
          avisos: [],
          erros: [error instanceof Error ? error.message : 'Unknown processing error'],
        },
        metadataProcessamento: {
          dataProcessamento: new Date().toISOString(),
          versaoSchema: '1.0',
          modeloIA: anthropicConfig.model,
        },
      };
    }
  }
}

export const editalProcessService = new EditalProcessService();