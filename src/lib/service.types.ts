import type { Result } from './result.types';

/**
 * Padroniza a resposta de sucesso dos serviços
 */
export interface ServiceSuccess<TData = unknown> {
  status: number;
  data: TData;
}

/**
 * Padroniza a resposta de erro dos serviços
 */
export interface ServiceError {
  status: number;
  message: string;
  code?: string;
  details?: unknown;
}

/**
 * Interface base para todos os serviços da aplicação
 * 
 * @template TInput - Tipo dos dados de entrada
 * @template TOutput - Tipo dos dados de saída (apenas a propriedade `data`)
 * 
 * @example
 * ```typescript
 * class MyService implements Service<{ id: string }, { name: string }> {
 *   async execute(input: { id: string }): Promise<Result<ServiceSuccess<{ name: string }>, ServiceError>> {
 *     return okResult({ status: 200, data: { name: "John" } });
 *   }
 * }
 * ```
 */
export interface Service<TInput = unknown, TOutput = unknown> {
  execute(data: TInput): Promise<Result<ServiceSuccess<TOutput>, ServiceError>>;
}

/**
 * Utility type para extrair o tipo de input de um serviço
 */
export type ServiceInput<T> = T extends Service<infer TInput, unknown> ? TInput : never;

/**
 * Utility type para extrair o tipo de output de um serviço
 */
export type ServiceOutput<T> = T extends Service<unknown, infer TOutput> ? TOutput : never;

/**
 * Response type para Express
 */
type ExpressResponse = {
  status: (code: number) => { json: (data: unknown) => unknown };
};

/**
 * Envia resposta de sucesso para o cliente
 */
function sendSuccessResponse<T>(res: ExpressResponse, result: ServiceSuccess<T>) {
  return res.status(result.status).json({
    success: true,
    data: result.data,
  });
}

/**
 * Envia resposta de erro para o cliente
 */
function sendErrorResponse(res: ExpressResponse, error: ServiceError) {
  return res.status(error.status).json({
    success: false,
    error: {
      message: error.message,
      code: error.code,
      details: error.details,
    },
  });
}

/**
 * Processa resultado de um serviço e envia resposta HTTP apropriada
 */
export async function handleServiceResult<T>(
  res: ExpressResponse,
  servicePromise: Promise<Result<ServiceSuccess<T>, ServiceError>>
) {
  const result = await servicePromise;
  
  if (result.error) {
    return sendErrorResponse(res, result.error);
  }
  
  return sendSuccessResponse(res, result.value!);
}