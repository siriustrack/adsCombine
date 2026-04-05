import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const definition = {
  openapi: '3.0.0',
  info: {
    title: 'AdsCombine API',
    version: '1.0.0',
    description:
      'OCR e serviço de extração de texto para PDFs, documentos, imagens e áudio. Processa mensagens com anexos de arquivos, transcreve áudio e gerencia textos extraídos.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Servidor de desenvolvimento' }],
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
        properties: { error: { type: 'string', example: 'Unauthorized' } },
      },
      Error403: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Forbidden' } },
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
};

const spec = swaggerJsdoc({
  definition,
  apis: [resolve(rootDir, 'src/api/routes/*.ts')],
});

const distDir = resolve(rootDir, 'dist');
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const outputPath = resolve(distDir, 'openapi.json');
writeFileSync(outputPath, JSON.stringify(spec, null, 2));

const paths = Object.keys(spec.paths || {});
console.log(`✓ OpenAPI spec generated → ${outputPath}`);
console.log(`  Routes: ${paths.length > 0 ? paths.join(', ') : 'none'}`);
