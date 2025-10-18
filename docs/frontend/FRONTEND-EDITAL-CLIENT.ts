/**
 * @fileoverview Client SDK para API de Processamento de Editais
 * @author Paulo Chaves
 * @date 2025-10-14
 * 
 * Este arquivo contém tipos e funções prontas para integração com a API de processamento de editais.
 * Pode ser copiado diretamente para o projeto frontend.
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Request para processar um edital
 */
export interface EditalProcessRequest {
  /** UUID do usuário */
  user_id: string;
  /** UUID do plano de estudos */
  schedule_plan_id: string;
  /** URL do arquivo de texto transcrito */
  url: string;
}

/**
 * Response inicial do processamento
 */
export interface EditalProcessResponse {
  /** Caminho relativo do arquivo JSON (ex: /files/user-id/plan-id/file.json) */
  filePath: string;
  /** Status inicial (sempre 'processing') */
  status: 'processing';
  /** ID do job para tracking */
  jobId: string;
}

/**
 * Status durante o processamento
 */
export interface ProcessingStatus {
  status: 'processing';
  jobId: string;
  startedAt: string;
}

/**
 * Status em caso de erro
 */
export interface ErrorStatus {
  status: 'error';
  jobId: string;
  error: string;
  startedAt: string;
  failedAt: string;
}

/**
 * Estrutura do edital processado
 */
export interface EditalProcessado {
  concursos: Concurso[];
}

/**
 * Informações de um concurso
 */
export interface Concurso {
  id: string;
  titulo: string;
  orgao: string;
  cargo: string;
  dataProva: string;
  turno: 'manha' | 'tarde' | 'noite';
  tipoProva: 'objetiva' | 'discursiva' | 'prática' | 'oral';
  disciplinas: Disciplina[];
}

/**
 * Disciplina do concurso
 */
export interface Disciplina {
  id: string;
  titulo: string;
  topicos: Topico[];
}

/**
 * Tópico de uma disciplina
 */
export interface Topico {
  id: string;
  titulo: string;
  subtopicos: string[];
}

/**
 * Erro de validação retornado pela API
 */
export interface ValidationError {
  error: string;
  details: Array<{
    code: string;
    expected: string;
    received: string;
    path: string[];
    message: string;
  }>;
}

/**
 * Configuração do cliente
 */
export interface EditalClientConfig {
  /** Base URL da API (ex: http://localhost:3000) */
  baseUrl: string;
  /** Token de autenticação */
  authToken?: string;
  /** Timeout para requisições (ms) */
  timeout?: number;
  /** Configuração de polling */
  polling?: {
    /** Intervalo entre polls (ms) */
    intervalMs?: number;
    /** Máximo de tentativas */
    maxAttempts?: number;
  };
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Erro customizado para problemas na API de editais
 */
export class EditalApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'EditalApiError';
  }
}

/**
 * Erro de timeout no processamento
 */
export class EditalTimeoutError extends EditalApiError {
  constructor(message = 'Processing timeout') {
    super(message, 408);
    this.name = 'EditalTimeoutError';
  }
}

/**
 * Erro de validação dos dados
 */
export class EditalValidationError extends EditalApiError {
  constructor(message: string, public validationDetails: ValidationError['details']) {
    super(message, 400, validationDetails);
    this.name = 'EditalValidationError';
  }
}

// ============================================================================
// CLIENT
// ============================================================================

/**
 * Cliente para interagir com a API de processamento de editais
 */
export class EditalProcessClient {
  private baseUrl: string;
  private authToken?: string;
  private timeout: number;
  private pollingConfig: {
    intervalMs: number;
    maxAttempts: number;
  };

  constructor(config: EditalClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authToken = config.authToken;
    this.timeout = config.timeout || 30000; // 30s default
    this.pollingConfig = {
      intervalMs: config.polling?.intervalMs || 5000, // 5s default
      maxAttempts: config.polling?.maxAttempts || 60, // 5 minutos default
    };
  }

  /**
   * Inicia o processamento de um edital
   * 
   * @param request - Dados da requisição
   * @returns Response com filePath e jobId
   * @throws {EditalValidationError} Se os dados forem inválidos
   * @throws {EditalApiError} Se houver erro na API
   */
  async startProcessing(request: EditalProcessRequest): Promise<EditalProcessResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/edital-process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (response.status === 400) {
          throw new EditalValidationError(
            errorData.error || 'Validation error',
            errorData.details || []
          );
        }

        throw new EditalApiError(
          errorData.error || `HTTP ${response.status}`,
          response.status,
          errorData
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof EditalApiError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new EditalTimeoutError('Request timeout');
        }
        throw new EditalApiError(error.message);
      }

      throw new EditalApiError('Unknown error');
    }
  }

  /**
   * Verifica o status do processamento
   * 
   * @param filePath - Caminho do arquivo retornado por startProcessing
   * @returns Status atual ou dados processados
   */
  async checkStatus(
    filePath: string
  ): Promise<ProcessingStatus | ErrorStatus | EditalProcessado> {
    try {
      const response = await fetch(`${this.baseUrl}${filePath}`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new EditalApiError(
          `Failed to check status: HTTP ${response.status}`,
          response.status
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof EditalApiError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new EditalTimeoutError('Status check timeout');
        }
        throw new EditalApiError(error.message);
      }

      throw new EditalApiError('Unknown error');
    }
  }

  /**
   * Aguarda o processamento ser concluído (com polling)
   * 
   * @param filePath - Caminho do arquivo retornado por startProcessing
   * @param onProgress - Callback chamado a cada poll (opcional)
   * @returns Dados do edital processado
   * @throws {EditalTimeoutError} Se atingir o máximo de tentativas
   * @throws {EditalApiError} Se houver erro no processamento
   */
  async waitForCompletion(
    filePath: string,
    onProgress?: (attempt: number, maxAttempts: number) => void
  ): Promise<EditalProcessado> {
    let attempts = 0;

    while (attempts < this.pollingConfig.maxAttempts) {
      attempts++;

      if (onProgress) {
        onProgress(attempts, this.pollingConfig.maxAttempts);
      }

      const status = await this.checkStatus(filePath);

      // Ainda processando
      if ('status' in status && status.status === 'processing') {
        await this.sleep(this.pollingConfig.intervalMs);
        continue;
      }

      // Erro no processamento
      if ('status' in status && status.status === 'error') {
        throw new EditalApiError(
          status.error || 'Processing failed',
          500,
          status
        );
      }

      // Sucesso! Retorna os dados
      return status as EditalProcessado;
    }

    throw new EditalTimeoutError(
      `Processing timeout: exceeded ${this.pollingConfig.maxAttempts} attempts`
    );
  }

  /**
   * Processa um edital de forma completa (start + wait)
   * 
   * @param request - Dados da requisição
   * @param onProgress - Callback de progresso (opcional)
   * @returns Dados do edital processado
   */
  async processEdital(
    request: EditalProcessRequest,
    onProgress?: (stage: 'starting' | 'polling', data?: unknown) => void
  ): Promise<EditalProcessado> {
    if (onProgress) {
      onProgress('starting');
    }

    const response = await this.startProcessing(request);

    if (onProgress) {
      onProgress('polling', { jobId: response.jobId, filePath: response.filePath });
    }

    return await this.waitForCompletion(
      response.filePath,
      (attempt, maxAttempts) => {
        if (onProgress) {
          onProgress('polling', { attempt, maxAttempts });
        }
      }
    );
  }

  /**
   * Helper para sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Cria uma instância do cliente com configuração padrão
 * 
 * @param baseUrl - Base URL da API
 * @param authToken - Token de autenticação (opcional)
 * @returns Instância configurada do cliente
 */
export function createEditalClient(
  baseUrl: string,
  authToken?: string
): EditalProcessClient {
  return new EditalProcessClient({
    baseUrl,
    authToken,
    timeout: 30000,
    polling: {
      intervalMs: 5000,
      maxAttempts: 60,
    },
  });
}

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

/**
 * EXEMPLO 1: Uso básico
 */
export async function example1() {
  const client = createEditalClient('http://localhost:3000', 'your-auth-token');

  try {
    const result = await client.processEdital({
      user_id: '98d8b11a-8a32-4f6b-9dae-6e42efa23116',
      schedule_plan_id: 'bca596cc-d484-4df1-8cf2-e9a5ca637eac',
      url: 'http://example.com/edital.txt',
    });

    console.log('✅ Edital processado:', result);
    console.log(`Total de concursos: ${result.concursos.length}`);
  } catch (error) {
    if (error instanceof EditalValidationError) {
      console.error('❌ Erro de validação:', error.validationDetails);
    } else if (error instanceof EditalTimeoutError) {
      console.error('⏱️ Timeout:', error.message);
    } else if (error instanceof EditalApiError) {
      console.error('❌ Erro na API:', error.message, error.statusCode);
    } else {
      console.error('❌ Erro desconhecido:', error);
    }
  }
}

/**
 * EXEMPLO 2: Com callbacks de progresso
 */
export async function example2() {
  const client = createEditalClient('http://localhost:3000');

  const result = await client.processEdital(
    {
      user_id: '98d8b11a-8a32-4f6b-9dae-6e42efa23116',
      schedule_plan_id: 'bca596cc-d484-4df1-8cf2-e9a5ca637eac',
      url: 'http://example.com/edital.txt',
    },
    (stage, data) => {
      if (stage === 'starting') {
        console.log('🚀 Iniciando processamento...');
      } else if (stage === 'polling') {
        const { attempt, maxAttempts } = data as { attempt: number; maxAttempts: number };
        const progress = (attempt / maxAttempts) * 100;
        console.log(`⏳ Processando... ${progress.toFixed(0)}% (${attempt}/${maxAttempts})`);
      }
    }
  );

  console.log('✅ Concluído!', result);
}

/**
 * EXEMPLO 3: Processamento manual (start + wait separados)
 */
export async function example3() {
  const client = createEditalClient('http://localhost:3000');

  // Inicia o processamento
  const response = await client.startProcessing({
    user_id: '98d8b11a-8a32-4f6b-9dae-6e42efa23116',
    schedule_plan_id: 'bca596cc-d484-4df1-8cf2-e9a5ca637eac',
    url: 'http://example.com/edital.txt',
  });

  console.log('Job ID:', response.jobId);
  console.log('File Path:', response.filePath);

  // Aguarda conclusão
  const result = await client.waitForCompletion(response.filePath, (attempt, max) => {
    console.log(`Poll ${attempt}/${max}`);
  });

  console.log('✅ Resultado:', result);
}
