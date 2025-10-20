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
  type Concurso,
  EditalStructureSchema,
  type EditalStructure,
} from './edital-schema';
import { EditalChunker, type ContentChunk } from './edital-chunker';
import { createClient } from '@supabase/supabase-js';

// Cliente Supabase para atualizar edital_file após processamento
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

export interface EditalProcessRequest {
  user_id: string;
  edital_file_id: string; // ID do registro edital_file (renomeado de schedule_plan_id)
  url: string;
  edital_bucket_path?: string; // Opcional
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  options?: {
    maxRetries?: number;
    chunkingEnabled?: boolean;
    validateSchema?: boolean;
    saveJson?: boolean;
    outputDir?: string;
  };
}

export interface EditalProcessResponse {
  filePath: string;
  status: 'processing';
  jobId: string;
  user_id: string;
  estimation: {
    totalCharacters: number;
    totalCharactersKB: number;
    estimatedTimeMs: number;
    estimatedTimeSeconds: number;
    estimatedTimeMinutes: number;
    estimatedCompletionAt: string;
  };
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
    const { user_id, edital_file_id, url, options } = request;
    const jobId = randomUUID();

    logger.info('[EDITAL-SERVICE] 🎯 Starting edital processing', { 
      jobId, 
      user_id, 
      edital_file_id, 
      url,
      urlDomain: new URL(url).hostname,
    });

    // Generate output path
    const outputDir = options?.outputDir || path.join(PUBLIC_DIR, 'texts', edital_file_id);
    const fileName = `${jobId}.json`;
    const filePath = path.join(outputDir, fileName);

    logger.info('[EDITAL-SERVICE] 📁 Creating directory', { 
      jobId,
      outputDir,
      fileName,
    });

    // Ensure directory exists
    fs.mkdirSync(outputDir, { recursive: true });

    // Fetch content to calculate estimation
    logger.info('[EDITAL-SERVICE] 📊 Pre-fetching content for estimation', { jobId, url });
    let estimatedChars = 0;
    let estimatedTimeMs = 0;
    
    try {
      const contentSample = await this.fetchContentWithRetry(url, 1);
      estimatedChars = contentSample.length;
      
      // Calculate estimated processing time
      const MS_PER_CHAR = 2.55;
      const OVERHEAD_MS = 5000;
      estimatedTimeMs = Math.floor((estimatedChars * MS_PER_CHAR) + OVERHEAD_MS);
      
      logger.info('[EDITAL-SERVICE] 📊 Estimation calculated', {
        jobId,
        estimatedChars,
        estimatedCharsKB: Math.floor(estimatedChars / 1024),
        estimatedTimeMs,
        estimatedTimeSeconds: Math.floor(estimatedTimeMs / 1000),
        estimatedTimeMinutes: Math.floor(estimatedTimeMs / 60000),
      });
      
      // Create processing status file
      const processingStatus = {
        status: 'processing',
        jobId,
        user_id,
        edital_file_id,
        startedAt: new Date().toISOString(),
        estimation: {
          totalCharacters: estimatedChars,
          totalCharactersKB: Math.floor(estimatedChars / 1024),
          estimatedTimeMs,
          estimatedTimeSeconds: Math.floor(estimatedTimeMs / 1000),
          estimatedCompletionAt: new Date(Date.now() + estimatedTimeMs).toISOString(),
        },
      };
      fs.writeFileSync(filePath, JSON.stringify(processingStatus, null, 2), 'utf8');
      
      logger.info('[EDITAL-SERVICE] 📝 Created processing status file', { jobId, filePath });

      // Process in background
      this.processInBackground(url, filePath, jobId, edital_file_id, user_id, options, contentSample);

    } catch (estimationError) {
      logger.warn('[EDITAL-SERVICE] ⚠️  Failed to calculate estimation, using defaults', {
        jobId,
        error: estimationError instanceof Error ? estimationError.message : 'Unknown',
      });
      
      // Default estimation
      estimatedChars = 150000;
      estimatedTimeMs = 390000;
      
      const processingStatus = {
        status: 'processing',
        jobId,
        user_id,
        edital_file_id,
        startedAt: new Date().toISOString(),
        estimation: {
          totalCharacters: estimatedChars,
          totalCharactersKB: 150,
          estimatedTimeMs,
          estimatedTimeSeconds: 390,
          estimatedCompletionAt: new Date(Date.now() + estimatedTimeMs).toISOString(),
          note: 'Default estimation used',
        },
      };
      fs.writeFileSync(filePath, JSON.stringify(processingStatus, null, 2), 'utf8');
      
      this.processInBackground(url, filePath, jobId, edital_file_id, user_id, options);
    }

    // Return response immediately
    const publicPath = path.relative(PUBLIC_DIR, filePath);

    logger.info('[EDITAL-SERVICE] ⚡ Returning immediate response with estimation', { 
      jobId, 
      publicPath,
      status: 'processing',
      estimatedTimeMs,
      estimatedTimeMinutes: Math.floor(estimatedTimeMs / 60000),
    });

    return {
      filePath: publicPath,
      status: 'processing',
      jobId,
      user_id,
      estimation: {
        totalCharacters: estimatedChars,
        totalCharactersKB: Math.floor(estimatedChars / 1024),
        estimatedTimeMs,
        estimatedTimeSeconds: Math.floor(estimatedTimeMs / 1000),
        estimatedTimeMinutes: Math.floor(estimatedTimeMs / 60000),
        estimatedCompletionAt: new Date(Date.now() + estimatedTimeMs).toISOString(),
      },
    };
  }

  private async processInBackground(
    url: string, 
    outputPath: string,
    jobId: string,
    editalFileId: string, // schedule_plan_id na verdade é edital_file_id
    userId: string,
    options?: EditalProcessRequest['options'],
    preloadedContent?: string
  ) {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      logger.info('[EDITAL-BG] ⏱️  Processing time elapsed', { elapsed, jobId });
    }, 10000);

    try {
      logger.info('[EDITAL-BG] 🔄 Starting background processing', { url, jobId });

      // Step 1: Fetch content (or use preloaded)
      let content: string;
      
      if (preloadedContent) {
        logger.info('[EDITAL-BG] ✅ Step 1/7: Using preloaded content', { 
          contentLength: preloadedContent.length,
          jobId,
        });
        content = preloadedContent;
      } else {
        logger.info('[EDITAL-BG] 📥 Step 1/7: Fetching content from URL', { url, jobId });
        content = await this.fetchContentWithRetry(url, options?.maxRetries || this.MAX_RETRIES);
      }
      
      logger.info('[EDITAL-BG] ✅ Step 2/7: Content ready for processing', { 
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

      // Step 4: Process with Claude (adaptive strategy)
      logger.info('[EDITAL-BG] 🤖 Step 4/7: Starting AI processing with Claude (adaptive strategy)', { 
        model: anthropicConfig.model,
        jobId,
      });

      const processedData = await this.processEditalAdaptive(content);

      logger.info('[EDITAL-BG] ✅ Step 5/7: AI processing completed', { 
        concursos: processedData.concursos.length,
        totalDisciplinas: processedData.validacao.totalDisciplinas,
        totalQuestoes: processedData.validacao.totalQuestoes,
        strategy: processedData.metadataProcessamento.strategy || 'unknown',
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

      // Atualizar edital_file no Supabase com resultado
      if (supabase) {
        // ✅ Upload do JSON para o bucket do Supabase
        const jsonFileName = `${userId}/${path.basename(outputPath)}`;
        const jsonBuffer = Buffer.from(JSON.stringify(finalOutput, null, 2), 'utf8');
        
        logger.info('[EDITAL-BG] ☁️  Uploading JSON to Supabase storage', {
          bucket: 'editals',
          path: jsonFileName,
          size: jsonBuffer.length,
          jobId
        });

        const { error: uploadError } = await supabase.storage
          .from('editals')
          .upload(jsonFileName, jsonBuffer, {
            contentType: 'application/json',
            upsert: true, // Sobrescrever se já existir
          });

        if (uploadError) {
          logger.error('[EDITAL-BG] ⚠️  Failed to upload JSON to Supabase storage', {
            error: uploadError,
            path: jsonFileName,
            jobId
          });
        } else {
          logger.info('[EDITAL-BG] ✅ JSON uploaded to Supabase storage', {
            path: jsonFileName,
            jobId
          });
        }

        const jsonPublicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/editals/${jsonFileName}`;
        
        const { error: updateError } = await supabase
          .from('edital_file')
          .update({ 
            processing_result: finalOutput,
            json_url: jsonPublicUrl,
            edital_status: 'ready'
          })
          .eq('id', editalFileId);

        if (updateError) {
          logger.error('[EDITAL-BG] ⚠️  Failed to update edital_file in database', {
            error: updateError,
            editalFileId,
            jobId
          });
        } else {
          logger.info('[EDITAL-BG] ✅ Database updated successfully', {
            editalFileId,
            jsonUrl: jsonPublicUrl,
            jobId
          });
        }

        // Disparar orquestrador para criar study_plans
        await this.triggerOrchestrator(userId, finalOutput, editalFileId);
      } else {
        logger.warn('[EDITAL-BG] ⚠️  Supabase client not configured - skipping database update and orchestrator');
      }

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

  /**
   * 🎯 ADAPTIVE STRATEGY: Try full extraction first, fallback to chunking if needed
   * 
   * This method implements the optimal extraction strategy:
   * 1. Always tries single-call extraction first (cheap, works for most editais)
   * 2. Automatically falls back to hierarchical chunking if truncation occurs
   * 3. No arbitrary heuristics - let the AI decide based on actual output size
   */
  private async processEditalAdaptive(content: string): Promise<EditalProcessado> {
    try {
      logger.info('[ADAPTIVE] 🎯 Strategy 1: Attempting full extraction (single call)');
      logger.info('[ADAPTIVE] 📊 Content stats', {
        contentLength: content.length,
        contentSizeKB: Math.floor(content.length / 1024),
        estimatedTokens: Math.floor(content.length / 4),
      });

      // Try full extraction with high max_tokens (only pay for what we use)
      const result = await this.processWithClaude(content);
      
      logger.info('[ADAPTIVE] ✅ Full extraction successful!', {
        concursos: result.concursos.length,
        disciplinas: result.validacao.totalDisciplinas,
        materias: result.validacao.totalMaterias,
      });

      // Add strategy metadata
      return {
        ...result,
        metadataProcessamento: {
          ...result.metadataProcessamento,
          strategy: 'full-extraction-single-call',
        },
      };

    } catch (error) {
      if (this.isTruncationError(error)) {
        logger.warn('[ADAPTIVE] ⚠️  Full extraction truncated - switching to Strategy 2');
        logger.info('[ADAPTIVE] 🔄 Strategy 2: Hierarchical chunking (structure + disciplines)');
        
        return await this.processWithHierarchicalChunking(content);
      }
      
      // If it's not a truncation error, propagate it
      logger.error('[ADAPTIVE] ❌ Unexpected error during processing', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }

  /**
   * 🔀 HIERARCHICAL CHUNKING STRATEGY
   * 
   * Pass 1: Extract structure only (metadata + discipline list) → ~4-8K tokens output
   * Pass 2: Extract details for each discipline in parallel → 14×8K tokens output
   * Pass 3: Merge results programmatically (JavaScript, not AI)
   * 
   * CRITICAL: Input is ALWAYS complete text (no input chunking to preserve context)
   */
  private async processWithHierarchicalChunking(content: string): Promise<EditalProcessado> {
    const startTime = Date.now();

    // Pass 1: Extract structure
    logger.info('[CHUNKING] 📋 Pass 1/3: Extracting structure (metadata + disciplines)');
    const structure = await this.extractStructureOnly(content);
    
    logger.info('[CHUNKING] ✅ Structure extracted', {
      disciplinas: structure.disciplinas.length,
      fases: structure.fases.length,
    });

    // Pass 2: Extract discipline details in parallel
    const totalDisciplinas = structure.disciplinas.length;
    logger.info('[CHUNKING] 📚 Pass 2/3: Extracting details for disciplines', {
      total: totalDisciplinas,
      mode: 'parallel-with-fallback',
    });

    // 🔧 CORREÇÃO CRÍTICA 1: Promise.allSettled (não falha tudo se 1 falhar)
    const results = await Promise.allSettled(
      structure.disciplinas.map((disc, idx) => 
        this.extractDisciplineDetails(content, disc, idx + 1, totalDisciplinas)
      )
    );

    // Separar sucessos e falhas
    const disciplinasDetalhadas = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value);

    const failures = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    if (failures.length > 0) {
      logger.warn('[CHUNKING] ⚠️  Some disciplines failed to extract', {
        totalFailed: failures.length,
        totalSuccess: disciplinasDetalhadas.length,
        failures: failures.map((f, idx) => ({
          index: idx,
          reason: f.reason instanceof Error ? f.reason.message : String(f.reason),
        })),
      });
    }

    logger.info('[CHUNKING] ✅ Discipline extraction completed', {
      totalDisciplinas,
      successCount: disciplinasDetalhadas.length,
      failureCount: failures.length,
      totalMaterias: disciplinasDetalhadas.reduce((acc, d) => acc + d.materias.length, 0),
    });

    // Pass 3: Merge programmatically (no AI)
    logger.info('[CHUNKING] 🔗 Pass 3/3: Merging results programmatically');
    const merged = this.mergeStructureAndDetails(structure, disciplinasDetalhadas);

    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    logger.info('[CHUNKING] 🎉 Hierarchical chunking completed', {
      totalTime,
      totalTimeFormatted: `${Math.floor(totalTime / 60)}m ${totalTime % 60}s`,
      concursos: merged.concursos.length,
      disciplinas: merged.validacao.totalDisciplinas,
      materias: merged.validacao.totalMaterias,
    });

    return {
      ...merged,
      metadataProcessamento: {
        ...merged.metadataProcessamento,
        strategy: 'hierarchical-chunking',
        chunking: {
          totalPasses: 2 + totalDisciplinas, // structure + N disciplines
          disciplinasExtracted: totalDisciplinas,
          processingTime: totalTime,
        },
      },
    };
  }

  /**
   * 📋 PASS 1: Extract ONLY structure (metadata + discipline names)
   * Output: ~4-8K tokens (very small, no truncation risk)
   */
  private async extractStructureOnly(content: string): Promise<EditalStructure> {
    const systemPrompt = `You are extracting the STRUCTURE of a Brazilian public exam edital.

Extract ONLY:
1. Metadata (exam name, institution, date, etc.)
2. Phases (if multiple phases exist)
3. Disciplines list (names only, basic info)

⚠️ CRITICAL: Do NOT extract "materias" (subjects) details. Just discipline names.

Return minimal JSON:
\`\`\`json
{
  "metadata": {
    "examName": "string",
    "examOrg": "string",
    "cargo": "string (optional)",
    "area": "string (optional)",
    "startDate": "YYYY-MM-DD or null",
    "examTurn": "manha|tarde|noite|integral|nao_especificado",
    "totalQuestions": number,
    "notes": "string (optional)"
  },
  "fases": [
    {
      "tipo": "objetiva|discursiva|prática|oral|titulos|aptidao_fisica",
      "data": "YYYY-MM-DD or null",
      "turno": "manha|tarde|noite|integral|nao_especificado",
      "totalQuestoes": number (optional),
      "caraterEliminatorio": boolean,
      "peso": number
    }
  ],
  "disciplinas": [
    {
      "nome": "Direito Civil",
      "numeroQuestoes": 10,
      "peso": 1.0,
      "observacoes": "Block I (optional)"
    }
  ]
}
\`\`\`

⚠️ REMEMBER: Extract SUBJECTS, not BLOCKS/GROUPS.
Example: Extract "Direito Civil", "Direito Penal" (subjects)
NOT "Bloco I", "Bloco II" (blocks)

Return ONLY the JSON, no additional text.`;

    let responseText = '';
    
    try {
      const stream = this.anthropic.messages.stream({
        model: anthropicConfig.model,
        max_tokens: 64000, // High limit but will only use ~4-8K
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Extract structure from this Brazilian exam edital:\n\n${content}`,
          },
        ],
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          responseText += chunk.delta.text;
        }
      }

      if (!responseText) {
        throw new Error('Empty response from Claude streaming');
      }

      // 🔧 CORREÇÃO CRÍTICA 3: Melhor parsing e validação de JSON
      let cleaned = responseText.trim();
      
      // Estratégia 1: Code block com ```json
      let codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
      } else {
        // Estratégia 2: Encontrar primeiro { e último }
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          cleaned = cleaned.substring(firstBrace, lastBrace + 1);
          logger.info('[STRUCTURE] Extracted JSON by finding braces');
        }
      }

      const parsed = JSON.parse(cleaned);
      
      // 🔧 CORREÇÃO CRÍTICA 3: Validar com schema Zod
      const validated = EditalStructureSchema.parse(parsed);
      
      logger.info('[STRUCTURE] ✅ Structure parsed and validated successfully', {
        disciplinas: validated.disciplinas.length,
        fases: validated.fases.length,
        totalQuestions: validated.metadata.totalQuestions,
      });

      return validated;

    } catch (error) {
      logger.error('[STRUCTURE] ❌ Failed to extract structure', {
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * 📖 PASS 2: Extract details for ONE discipline (materias + subtopicos)
   * Input: FULL edital text (preserves context)
   * Output: Array of materias (~8K tokens per discipline)
   */
  private async extractDisciplineDetails(
    fullContent: string,
    disciplina: { nome: string; numeroQuestoes?: number; observacoes?: string | null },
    currentIndex: number,
    totalCount: number
  ): Promise<{ nome: string; materias: any[]; numeroQuestoes: number; peso: number; observacoes?: string | null }> {
    
    logger.info(`[DISCIPLINE] 📖 [${currentIndex}/${totalCount}] Extracting: ${disciplina.nome}`);

    const systemPrompt = `You are extracting detailed content for a SPECIFIC discipline from a Brazilian exam edital.

**Target Discipline:** "${disciplina.nome}"

Extract ONLY the "materias" (subjects/topics) for this discipline, including:
1. Materia name (exact as in edital)
2. Order (sequential 1, 2, 3...)
3. Sub-topics (if any)
4. Legislation references (if any)
5. Bibliography (if any)

Return JSON array:
\`\`\`json
[
  {
    "nome": "Materia name",
    "ordem": 1,
    "subtopicos": ["topic 1", "topic 2"],
    "legislacoes": [
      {
        "tipo": "lei",
        "numero": "8112",
        "ano": "1990",
        "nome": "Regime Jurídico dos Servidores Públicos"
      }
    ],
    "bibliografia": "Book references",
    "observacoes": "Additional notes"
  }
]
\`\`\`

⚠️ IMPORTANT: Extract ONLY for "${disciplina.nome}". Ignore other disciplines.

If you cannot find detailed materias, create at least 1 generic materia:
\`\`\`json
[
  {
    "nome": "${disciplina.nome} - Conteúdo Geral",
    "ordem": 1,
    "subtopicos": [],
    "legislacoes": []
  }
]
\`\`\`

Return ONLY the JSON array, no additional text.`;

    let responseText = '';

    try {
      const stream = this.anthropic.messages.stream({
        model: anthropicConfig.model,
        max_tokens: 64000, // High limit, typically uses ~8K per discipline
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: fullContent, // ✅ FULL content, not chunked
          },
        ],
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          responseText += chunk.delta.text;
        }
      }

      if (!responseText) {
        throw new Error('Empty response from Claude streaming');
      }

      // Clean and parse JSON
      let cleaned = responseText.trim();
      const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
      }

      const materias = JSON.parse(cleaned);
      
      logger.info(`[DISCIPLINE] ✅ [${currentIndex}/${totalCount}] ${disciplina.nome}: ${materias.length} matérias extracted`);

      return {
        nome: disciplina.nome,
        materias,
        numeroQuestoes: disciplina.numeroQuestoes || 0,
        peso: 1.0,
        observacoes: disciplina.observacoes,
      };

    } catch (error) {
      logger.error(`[DISCIPLINE] ❌ [${currentIndex}/${totalCount}] Failed to extract ${disciplina.nome}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      
      // Return minimal structure on error
      return {
        nome: disciplina.nome,
        materias: [
          {
            nome: `${disciplina.nome} - Conteúdo não extraído`,
            ordem: 1,
            subtopicos: [],
            legislacoes: [],
          },
        ],
        numeroQuestoes: disciplina.numeroQuestoes || 0,
        peso: 1.0,
        observacoes: `Erro na extração: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  /**
   * 🔗 PASS 3: Merge structure and details programmatically (NOT using AI)
   * 🔧 CORREÇÃO CRÍTICA 2: Merge por nome, não por index
   */
  private mergeStructureAndDetails(structure: EditalStructure, disciplinasDetalhadas: any[]): EditalProcessado {
    // Criar mapa de disciplinas detalhadas por nome
    const disciplinasMap = new Map(
      disciplinasDetalhadas.map(d => [d.nome, d])
    );

    logger.info('[MERGE] 🔗 Merging structure with details', {
      totalStructure: structure.disciplinas.length,
      totalDetails: disciplinasDetalhadas.length,
    });

    // Merge disciplinas da estrutura com detalhes (por nome, não index)
    const disciplinas = structure.disciplinas.map(structDisc => {
      const details = disciplinasMap.get(structDisc.nome);
      
      if (!details) {
        logger.warn(`[MERGE] ⚠️  Disciplina sem detalhes: ${structDisc.nome}`);
        return {
          nome: structDisc.nome,
          materias: [
            {
              nome: `${structDisc.nome} - Conteúdo Geral`,
              ordem: 1,
              subtopicos: [],
              legislacoes: [],
            },
          ],
          numeroQuestoes: structDisc.numeroQuestoes || 0,
          peso: structDisc.peso || 1.0,
          observacoes: structDisc.observacoes || 'Detalhes não extraídos',
        };
      }
      
      return {
        nome: details.nome,
        materias: details.materias,
        numeroQuestoes: details.numeroQuestoes || structDisc.numeroQuestoes || 0,
        peso: details.peso || structDisc.peso || 1.0,
        observacoes: details.observacoes || structDisc.observacoes,
      };
    });

    const totalQuestoes = disciplinas.reduce((acc, d) => acc + (d.numeroQuestoes || 0), 0);
    const totalMaterias = disciplinas.reduce((acc, d) => acc + d.materias.length, 0);

    // Validation
    const avisos: string[] = [];
    const erros: string[] = [];

    // Verificar se todas disciplinas da estrutura têm detalhes
    const missingDetails = structure.disciplinas.filter(
      structDisc => !disciplinasMap.has(structDisc.nome)
    );
    if (missingDetails.length > 0) {
      avisos.push(
        `${missingDetails.length} disciplines missing details: ${missingDetails.map(d => d.nome).join(', ')}`
      );
    }

    // Verificar detalhes órfãos (disciplinas em details mas não em structure)
    const orphanDetails = disciplinasDetalhadas.filter(
      det => !structure.disciplinas.some(s => s.nome === det.nome)
    );
    if (orphanDetails.length > 0) {
      avisos.push(
        `${orphanDetails.length} orphan details found (not in structure): ${orphanDetails.map(d => d.nome).join(', ')}`
      );
    }

    if (structure.metadata.totalQuestions && totalQuestoes !== structure.metadata.totalQuestions) {
      avisos.push(
        `Sum of questions (${totalQuestoes}) differs from declared total (${structure.metadata.totalQuestions})`
      );
    }

    if (disciplinas.length === 0) {
      erros.push('No disciplines extracted');
    }

    if (totalMaterias === 0) {
      avisos.push('No materias extracted for any discipline');
    }

    return {
      concursos: [
        {
          metadata: structure.metadata,
          fases: structure.fases || [],
          disciplinas,
        },
      ],
      validacao: {
        totalDisciplinas: disciplinas.length,
        totalQuestoes,
        totalMaterias,
        integridadeOK: erros.length === 0,
        avisos,
        erros,
      },
      metadataProcessamento: {
        dataProcessamento: new Date().toISOString(),
        versaoSchema: '1.0',
        modeloIA: anthropicConfig.model,
      },
    };
  }

  /**
   * 🔧 CORREÇÃO CRÍTICA 4: Melhor detecção de truncamento
   * Check if error is related to truncation/timeout/incomplete response
   */
  private isTruncationError(error: any): boolean {
    // Check error message
    const msg = error?.message?.toLowerCase() || '';
    const hasErrorMsg = 
      msg.includes('socket') ||
      msg.includes('truncat') ||
      msg.includes('incomplete') ||
      msg.includes('connection closed') ||
      msg.includes('timeout') ||
      msg.includes('max_tokens') ||
      msg.includes('timed out') ||
      msg.includes('aborted');
    
    if (hasErrorMsg) {
      logger.info('[TRUNCATION] Detected via error message', { message: error.message });
      return true;
    }
    
    // Check if result is valid but suspiciously small
    if (error?.result) {
      const result = error.result;
      if (result.validacao) {
        const isDisciplinasLow = result.validacao.totalDisciplinas < 5;
        const isMateriasLow = result.validacao.totalMaterias < 10;
        
        if (isDisciplinasLow || isMateriasLow) {
          logger.info('[TRUNCATION] Detected via low counts', {
            disciplinas: result.validacao.totalDisciplinas,
            materias: result.validacao.totalMaterias,
          });
          return true;
        }
      }
    }
    
    // Check if response text is incomplete JSON
    const responseText = error?.responseText || '';
    if (responseText.length > 0) {
      const isIncompleteJSON = !responseText.trim().endsWith('}');
      if (isIncompleteJSON) {
        logger.info('[TRUNCATION] Detected via incomplete JSON', {
          lastChars: responseText.slice(-50),
        });
        return true;
      }
    }
    
    return false;
  }

  public async processWithClaude(
    content: string,
    context?: { isChunk?: boolean; chunkId?: number; totalChunks?: number }
  ): Promise<EditalProcessado> {
    const chunkInfo = context?.isChunk 
      ? `\n\n**IMPORTANTE**: Este é o CHUNK ${(context.chunkId || 0) + 1} de ${context.totalChunks}. Extraia APENAS os dados presentes neste segmento.`
      : '';

    const systemPrompt = `# BRAZILIAN PUBLIC EXAM EDITAL EXTRACTION AGENT - STRUCTURED JSON MODE

You are an expert in analyzing and extracting data from Brazilian public examination edicts (editais de concursos públicos).

## CRITICAL OBJECTIVE

Extract with **100% precision** ALL information about subjects (disciplinas), topics (matérias), and question distribution for objective exams.

## ⚠️ CRITICAL DISTINCTION: BLOCKS/GROUPS vs ACTUAL SUBJECTS

**MANY Brazilian editais organize subjects into hierarchical BLOCKS/GROUPS.**

Common patterns you WILL encounter:
- "Bloco I", "Bloco II", "Bloco III" (Block I, II, III)
- "Grupo 1: Conhecimentos Gerais", "Grupo 2: Conhecimentos Específicos" (Group 1: General Knowledge, Group 2: Specific Knowledge)
- "Parte A", "Parte B" (Part A, Part B)
- "Conhecimentos Básicos", "Conhecimentos Específicos" (Basic Knowledge, Specific Knowledge)

### 🚫 WHAT YOU MUST NOT DO:

**NEVER extract BLOCKS/GROUPS as if they were subjects!**

❌ **WRONG EXAMPLE:**
\`\`\`json
{
  "disciplinas": [
    { "nome": "Bloco I", "numeroQuestoes": 40 },
    { "nome": "Bloco II", "numeroQuestoes": 60 }
  ]
}
\`\`\`

### ✅ WHAT YOU MUST DO:

**ALWAYS extract the ACTUAL SUBJECTS within each block/group!**

✅ **CORRECT EXAMPLE:**
\`\`\`json
{
  "disciplinas": [
    { "nome": "Direito Civil", "numeroQuestoes": 10, "observacoes": "Block I" },
    { "nome": "Direito Processual Civil", "numeroQuestoes": 10, "observacoes": "Block I" },
    { "nome": "Direito do Consumidor", "numeroQuestoes": 10, "observacoes": "Block I" },
    { "nome": "Direito da Criança e do Adolescente", "numeroQuestoes": 10, "observacoes": "Block I" },
    { "nome": "Direito Penal", "numeroQuestoes": 15, "observacoes": "Block II" },
    { "nome": "Direito Processual Penal", "numeroQuestoes": 15, "observacoes": "Block II" },
    { "nome": "Direito Constitucional", "numeroQuestoes": 15, "observacoes": "Block II" },
    { "nome": "Direito Administrativo", "numeroQuestoes": 15, "observacoes": "Block II" }
  ]
}
\`\`\`

### 📋 DETAILED EXTRACTION RULES FOR HIERARCHICAL STRUCTURES:

1. **Identify the hierarchy level:** Look for structural markers like:
   - "BLOCO I (40 questões):" followed by subject names
   - "Grupo 1 - Conhecimentos Gerais:" followed by subject list
   - Indented or bulleted lists under group headers

2. **Extract subjects, not containers:**
   - Container: "Bloco I", "Grupo 1", "Parte A" → Do NOT extract as subject
   - Subject: "Português", "Matemática", "Direito Civil" → DO extract

3. **Handle question distribution:**
   - If block has 40 questions and 4 subjects → Distribute proportionally or search for explicit distribution
   - If explicit distribution exists → Use exact numbers
   - If no distribution → Use 0 and document in "observacoes"

4. **Use 'observacoes' field to preserve block information:**
   - Add "Block I", "Group 1: General Knowledge", etc. in the "observacoes" field
   - This preserves hierarchy without corrupting subject extraction

5. **Validation check:**
   - If you extract < 5 subjects for a 100-question exam → YOU PROBABLY EXTRACTED BLOCKS, NOT SUBJECTS
   - Brazilian public exams typically have 8-15+ subjects
   - Re-examine and extract the actual subjects within the blocks

### 🔍 REAL-WORLD EXAMPLE FROM ACTUAL EDITAL:

**Text in edital:**
\`\`\`
DISCIPLINAS                    QUESTÕES
Bloco I:                       40
  Direito Civil
  Direito Processual Civil
  Direito do Consumidor
  Direito da Criança e do Adolescente

Bloco II:                      30
  Direito Penal
  Direito Processual Penal
  Direito Constitucional
  Direito Eleitoral

Bloco III:                     30
  Direito Empresarial
  Direito Tributário
  Direito Ambiental
  Direito Administrativo
  Noções Gerais de Direito
  Direitos Humanos
\`\`\`

**CORRECT extraction (14 subjects):**
\`\`\`json
{
  "disciplinas": [
    { "nome": "Direito Civil", "numeroQuestoes": 0, "observacoes": "Bloco I - 40 questões total" },
    { "nome": "Direito Processual Civil", "numeroQuestoes": 0, "observacoes": "Bloco I" },
    { "nome": "Direito do Consumidor", "numeroQuestoes": 0, "observacoes": "Bloco I" },
    { "nome": "Direito da Criança e do Adolescente", "numeroQuestoes": 0, "observacoes": "Bloco I" },
    { "nome": "Direito Penal", "numeroQuestoes": 0, "observacoes": "Bloco II - 30 questões total" },
    { "nome": "Direito Processual Penal", "numeroQuestoes": 0, "observacoes": "Bloco II" },
    { "nome": "Direito Constitucional", "numeroQuestoes": 0, "observacoes": "Bloco II" },
    { "nome": "Direito Eleitoral", "numeroQuestoes": 0, "observacoes": "Bloco II" },
    { "nome": "Direito Empresarial", "numeroQuestoes": 0, "observacoes": "Bloco III - 30 questões total" },
    { "nome": "Direito Tributário", "numeroQuestoes": 0, "observacoes": "Bloco III" },
    { "nome": "Direito Ambiental", "numeroQuestoes": 0, "observacoes": "Bloco III" },
    { "nome": "Direito Administrativo", "numeroQuestoes": 0, "observacoes": "Bloco III" },
    { "nome": "Noções Gerais de Direito", "numeroQuestoes": 0, "observacoes": "Bloco III" },
    { "nome": "Direitos Humanos", "numeroQuestoes": 0, "observacoes": "Bloco III" }
  ]
}
\`\`\`

**WRONG extraction (3 subjects) - DO NOT DO THIS:**
\`\`\`json
{
  "disciplinas": [
    { "nome": "Bloco I", "numeroQuestoes": 40 },
    { "nome": "Bloco II", "numeroQuestoes": 30 },
    { "nome": "Bloco III", "numeroQuestoes": 30 }
  ]
}
\`\`\`

### 🎯 FINAL VALIDATION:

Before returning your JSON, ask yourself:
1. **Did I extract BLOCKS or SUBJECTS?** If answer is "blocks" → WRONG, go back
2. **Is the number of subjects realistic?** (8-15+ for typical Brazilian exams)
3. **Are all subjects actual knowledge areas?** (not "Part A", "Group 1", etc.)
4. **Did I preserve hierarchy in 'observacoes'?** (so information isn't lost)

## MANDATORY OUTPUT FORMAT

Your response MUST be EXCLUSIVELY a valid JSON following EXACTLY this schema:

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
          "tipo": "objetiva|discursiva|prática|oral|titulos|aptidao_fisica",
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

## CRITICAL EXTRACTION RULES

### 1. ABSOLUTE PRECISION
- ✅ Copy names LITERALLY as they appear in the edital
- ✅ Do NOT paraphrase, interpret, or summarize
- ✅ Preserve exact punctuation, accents, and capitalization
- ❌ NEVER invent data that is not explicitly stated

### 2. DATES
- Convert DD/MM/YYYY to YYYY-MM-DD format
- Example: "30/04/2023" → "2023-04-30"
- If date is not specified or is "to be announced": use null
- MANDATORY: startDate must be valid YYYY-MM-DD OR null (without quotes in JSON)

### 3. MANDATORY VALUES
- examTurn: If not specified, use "nao_especificado"
- totalQuestions: MUST be >= 1 (sum all questions from all subjects)
- fases: MUST have at least 1 phase (minimum: objective exam)
- disciplinas: MUST have at least 1 subject

### 4. SUBJECTS AND TOPICS
- Extract ALL subjects from the objective exam
- For each subject, capture the EXACT number of questions
- If number of questions is NOT specified for a subject: use 0
- List ALL topics in the order they appear
- If you DON'T find detailed topics for a subject: create generic topic with subject name
- IMPORTANT: ALWAYS create at least 1 topic, even if generic
- EXAMPLE of subject without details: create generic topic "Subject Name - General Content"
- Use sequential "ordem" field (1, 2, 3, ...)

### 5. LEGISLATION
- Capture complete number: "Lei nº 8.112/1990" → {"tipo": "lei", "numero": "8112", "ano": "1990"}
- Include name: "nome": "Legal Regime of Public Servants"
- Valid types: lei, lei_complementar, decreto, decreto_lei, resolucao, portaria, instrucao_normativa, sumula

### 6. SUBTOPICS
- If topic has numbered items (1.1, 1.2, etc), add to "subtopicos"
- Maintain hierarchy and order
- Example: "1. Constitutional Law" with "1.1 Principles" → subtopicos: ["1.1 Princípios"]

### 7. VALIDATION
- Sum questions from all subjects
- Verify if sum == totalQuestions from metadata
- If divergent, add to "avisos" in validacao object
- Mark "integridadeOK": true only if everything is correct

### 8. MULTIPLE EXAMS
- If edital has multiple positions/exams, create separate entry in "concursos" array
- Each exam is a complete object with its own metadata, phases, and subjects

${chunkInfo}

## OUTPUT EXAMPLE

\`\`\`json
{
  "concursos": [
    {
      "metadata": {
        "examName": "Judicial Analyst - Judicial Area",
        "examOrg": "TRF3",
        "cargo": "Judicial Analyst",
        "area": "Judicial",
        "startDate": "2025-03-15",
        "examTurn": "manha",
        "totalQuestions": 120,
        "notaMinimaEliminatoria": 40,
        "criteriosEliminatorios": ["Score below 40 points on objective exam"],
        "notes": "Eliminatory and classificatory nature"
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
    "avisos": ["Sum of questions (35) differs from declared total (120). Possible partial extraction."],
    "erros": []
  },
  "metadataProcessamento": {
    "dataProcessamento": "${new Date().toISOString()}",
    "versaoSchema": "1.0",
    "modeloIA": "claude-3-5-sonnet-20241022"
  }
}
\`\`\`

## FINAL INSTRUCTIONS

1. Return ONLY the JSON, without additional text, without markdown, without explanations
2. Ensure the JSON is valid and parseable
3. Follow the schema EXACTLY
4. When in doubt, prefer to omit optional field rather than invent data
5. Validate question sum and report discrepancies in "avisos"
6. **REMEMBER: Extract SUBJECTS, not BLOCKS/GROUPS**

**Proceed with extraction now.**`;

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
            content: `Extract all data from this Brazilian public exam edital following the specified JSON schema. Pay special attention to distinguish between organizational blocks/groups and actual subjects:\n\n${content}`,
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

  /**
   * Dispara o orquestrador para criar study_plans a partir do edital processado
   * IMPORTANTE: Recebe JSON já processado (não reprocessa o texto)
   */
  private async triggerOrchestrator(
    userId: string, 
    editalData: EditalProcessado,
    editalFileId: string
  ): Promise<void> {
    try {
      // Importar o orquestrador dinamicamente
      const { createStudyPlan } = await import('../../../agents/index');
      
      if (!supabase) {
        logger.error('[EDITAL-BG] ⚠️  Supabase client not configured, cannot trigger orchestrator');
        return;
      }

      logger.info('[EDITAL-BG] 🚀 Triggering orchestrator with processed JSON', {
        userId,
        editalFileId,
        concursosCount: editalData.concursos.length,
        disciplinasCount: editalData.validacao.totalDisciplinas
      });

      // ✅ Passar JSON estruturado (NÃO reprocessar o texto!)
      const result = await createStudyPlan({
        userId,
        content: editalData as any, // JSON já processado
      });

      if (result.success && result.data) {
        logger.info('[EDITAL-BG] ✅ Orchestrator completed successfully', {
          userId,
          editalFileId,
          studyPlanId: result.data
        });

        // Vincular study_plans.edital_id ao edital_file_id
        const { error: linkError } = await supabase
          .from('study_plans')
          .update({ edital_id: editalFileId })
          .eq('id', result.data);

        if (linkError) {
          logger.error('[EDITAL-BG] ⚠️  Failed to link study_plan to edital_file', {
            error: linkError,
            studyPlanId: result.data,
            editalFileId
          });
        } else {
          logger.info('[EDITAL-BG] 🔗 Study plan linked to edital_file', {
            studyPlanId: result.data,
            editalFileId
          });
        }

        // Fase opcional: Corrigir contagem de questões
        if (process.env.ENABLE_QUESTION_FIXER === 'true') {
          try {
            const { questionCounterFixerService } = await import('./question-counter-fixer.service');
            logger.info('[EDITAL-BG] 🔧 Triggering question counter fixer', {
              studyPlanId: result.data,
              userId
            });

            const fixed = await questionCounterFixerService.fix(result.data, userId);

            if (fixed) {
              logger.info('[EDITAL-BG] ✅ Question counts fixed successfully', {
                studyPlanId: result.data,
                disciplinesFixed: fixed.disciplinesUpdated,
                examCorrected: fixed.examCorrected
              });
            } else {
              logger.warn('[EDITAL-BG] ⚠️  Question fixer returned no result', {
                studyPlanId: result.data
              });
            }
          } catch (fixerError) {
            logger.error('[EDITAL-BG] ⚠️  Question fixer failed (non-critical)', {
              error: fixerError instanceof Error ? fixerError.message : 'Unknown error',
              studyPlanId: result.data
            });
            // Não propagar erro - feature opcional
          }
        }
      } else {
        logger.error('[EDITAL-BG] ❌ Orchestrator failed', {
          error: result.error,
          userId,
          editalFileId
        });
      }
    } catch (error) {
      logger.error('[EDITAL-BG] ❌ Orchestrator execution failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        editalFileId
      });
      // Não propagar erro - processamento do edital já foi concluído
    }
  }
}

export const editalProcessService = new EditalProcessService();