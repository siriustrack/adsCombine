/**
 * Jest configuration for E2E tests
 * 
 * Diferenças dos testes unitários:
 * - NÃO mocka OpenAI, Supabase, ou Winston
 * - Usa APIs reais
 * - Timeout maior (60s)
 * - Setup específico para E2E
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/e2e-setup.ts'],
  testTimeout: 60000, // 60s para E2E tests (chamadas de API reais)
  maxWorkers: 1, // Rodar testes E2E sequencialmente para evitar conflitos no banco
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage/e2e',
  coverageReporters: ['text', 'lcov', 'html'],
  // NÃO usar o setup.ts padrão que mocka tudo!
};
