import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import swaggerJsdoc from 'swagger-jsdoc'

const definition = {
  openapi: '3.0.0',
  info: {
    title: 'AdsCombine API',
    version: '1.0.0',
    description:
      'OCR e serviço de extração de texto para PDFs, documentos, imagens e áudio. Processa mensagens com anexos de arquivos, transcreve áudio e gerencia textos extraídos.',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Servidor de desenvolvimento',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token de autenticação (env var TOKEN)',
      },
      JobsBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'token',
        description: 'Token interno dos jobs assíncronos (env var JOBS_TOKEN)',
      },
    },
    schemas: {
      Error400: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Invalid request body' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                path: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      Error401: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Unauthorized' },
        },
      },
      Error403: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Forbidden' },
        },
      },
      Error413: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Arquivo muito grande' },
          code: { type: 'string', example: 'FILE_TOO_LARGE' },
          details: {
            type: 'object',
            properties: { maxSize: { type: 'string', example: '50MB' } },
          },
        },
      },
      Error500: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Erro interno do servidor' },
          code: { type: 'string', example: 'INTERNAL_ERROR' },
          details: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
        },
      },
    },
  },
} as const

const staticSpecPath = resolve(__dirname, '../../openapi.json')

function loadSwaggerSpec(): object {
  if (existsSync(staticSpecPath)) {
    return JSON.parse(readFileSync(staticSpecPath, 'utf-8'))
  }

  return swaggerJsdoc({
    definition,
    apis: ['./src/api/routes/*.ts'],
  })
}

export const swaggerSpec = loadSwaggerSpec()
