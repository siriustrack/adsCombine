import { jest } from '@jest/globals';

// Mock do OpenAI
jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));

  return MockOpenAI;
});

// Mock do Supabase
jest.mock('@supabase/supabase-js', () => {
  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(),
  };

  return {
    createClient: jest.fn(() => ({
      from: jest.fn(() => mockQueryBuilder),
    })),
  };
});

// Mock do Winston logger
jest.mock('winston', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  return {
    createLogger: jest.fn(() => mockLogger),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      errors: jest.fn(),
      json: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn(),
    },
    transports: {
      Console: jest.fn(),
      File: jest.fn(),
    },
    default: {
      createLogger: jest.fn(() => mockLogger),
      format: {
        combine: jest.fn(),
        timestamp: jest.fn(),
        errors: jest.fn(),
        json: jest.fn(),
        colorize: jest.fn(),
        simple: jest.fn(),
      },
      transports: {
        Console: jest.fn(),
        File: jest.fn(),
      },
    },
  };
});

// Mock do Moment
jest.mock('moment', () => jest.fn((dateStr, format, strict) => ({
  isValid: () => {
    if (dateStr === '2023-12-25') return true;
    if (dateStr === '25/12/2023') return true;
    if (dateStr === '2023-12-25') return true;
    if (dateStr === '2023-13-45') return false;
    if (dateStr === 'not-a-date') return false;
    if (dateStr === '99/99/9999') return false;
    return false;
  },
  format: () => '2023-12-25',
})));

// Configurar variáveis de ambiente para testes
process.env.OPENAI_API_KEY = 'test-key';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';