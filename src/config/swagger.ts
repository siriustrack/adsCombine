import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
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
  },
  apis: ['./src/api/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
