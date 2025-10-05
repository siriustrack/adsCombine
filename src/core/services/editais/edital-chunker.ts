import logger from 'lib/logger';

export interface ChunkStrategy {
  maxChunkSize: number; // Em caracteres
  overlapSize: number; // Overlap entre chunks para manter contexto
  splitOn: 'sentence' | 'paragraph' | 'section';
}

export interface ContentChunk {
  id: number;
  content: string;
  startIndex: number;
  endIndex: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export class EditalChunker {
  private strategy: ChunkStrategy;

  constructor(strategy?: Partial<ChunkStrategy>) {
    this.strategy = {
      maxChunkSize: strategy?.maxChunkSize || 80000, // ~20k tokens para Claude
      overlapSize: strategy?.overlapSize || 2000,
      splitOn: strategy?.splitOn || 'section',
    };
  }

  /**
   * Divide um edital grande em chunks inteligentes
   */
  public chunkContent(content: string): ContentChunk[] {
    const contentLength = content.length;

    // Se conteúdo é pequeno, retorna como único chunk
    if (contentLength <= this.strategy.maxChunkSize) {
      logger.info('Content fits in single chunk', { contentLength });
      return [{
        id: 0,
        content,
        startIndex: 0,
        endIndex: contentLength,
        hasNext: false,
        hasPrevious: false,
      }];
    }

    logger.info('Content requires chunking', { 
      contentLength, 
      estimatedChunks: Math.ceil(contentLength / this.strategy.maxChunkSize) 
    });

    return this.createSmartChunks(content);
  }

  /**
   * Cria chunks inteligentes respeitando limites de seção
   */
  private createSmartChunks(content: string): ContentChunk[] {
    const chunks: ContentChunk[] = [];
    let currentIndex = 0;
    let chunkId = 0;

    while (currentIndex < content.length) {
      const remainingContent = content.length - currentIndex;
      const chunkSize = Math.min(this.strategy.maxChunkSize, remainingContent);

      let endIndex = currentIndex + chunkSize;

      // Se não é o último chunk, tenta encontrar um ponto de quebra natural
      if (endIndex < content.length) {
        endIndex = this.findNaturalBreakpoint(content, currentIndex, endIndex);
      }

      const chunkContent = content.substring(currentIndex, endIndex);

      chunks.push({
        id: chunkId,
        content: chunkContent,
        startIndex: currentIndex,
        endIndex,
        hasNext: endIndex < content.length,
        hasPrevious: currentIndex > 0,
      });

      // Avançar com overlap para manter contexto
      currentIndex = endIndex - (endIndex < content.length ? this.strategy.overlapSize : 0);
      chunkId++;
    }

    logger.info('Chunking completed', { 
      totalChunks: chunks.length,
      averageChunkSize: Math.round(chunks.reduce((acc, c) => acc + c.content.length, 0) / chunks.length)
    });

    return chunks;
  }

  /**
   * Encontra um ponto de quebra natural (fim de seção, parágrafo, sentença)
   */
  private findNaturalBreakpoint(content: string, start: number, idealEnd: number): number {
    const searchWindow = content.substring(start, Math.min(idealEnd + 500, content.length));

    // Procurar por marcadores de seção (em ordem de preferência)
    const sectionMarkers = [
      /\n#{1,3}\s+[A-ZÁÉÍÓÚÂÊÔÃÕ]/g, // Headers markdown
      /\n\d+\.\s+[A-ZÁÉÍÓÚÂÊÔÃÕ]/g, // Itens numerados principais
      /\n\n[A-ZÁÉÍÓÚÂÊÔÃÕ]/g, // Início de parágrafo
      /\.\s+\n/g, // Fim de sentença com quebra de linha
      /\n/g, // Qualquer quebra de linha
    ];

    for (const marker of sectionMarkers) {
      const matches = Array.from(searchWindow.matchAll(marker));
      if (matches.length > 0) {
        // Pega a última ocorrência dentro da janela ideal
        const lastMatch = matches[matches.length - 1];
        if (lastMatch.index) {
          const breakpoint = start + lastMatch.index + lastMatch[0].length;
          if (breakpoint > start + this.strategy.maxChunkSize * 0.7) {
            // Só aceita se for pelo menos 70% do tamanho ideal
            return breakpoint;
          }
        }
      }
    }

    // Fallback: quebra no tamanho ideal
    return idealEnd;
  }

  /**
   * Reconstrói contexto compartilhado entre chunks
   */
  public extractSharedContext(chunks: ContentChunk[]): string {
    if (chunks.length === 0) return '';

    // Extrai informações que aparecem no início (geralmente metadata do edital)
    const firstChunk = chunks[0].content;
    const lines = firstChunk.split('\n').slice(0, 50); // Primeiras 50 linhas

    const contextLines: string[] = [];
    
    for (const line of lines) {
      // Captura linhas que parecem metadata
      if (
        /^(órgão|concurso|cargo|data|edital|banca)/i.test(line) ||
        /^\*\*/.test(line) ||
        line.includes(':')
      ) {
        contextLines.push(line);
      }

      // Para quando chegar ao conteúdo programático
      if (/conteúdo programático|disciplinas|matérias/i.test(line)) {
        break;
      }
    }

    return contextLines.join('\n');
  }
}
