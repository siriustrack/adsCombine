import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { 
  EditalProcessService,
  EditalProcessadoSchema,
  validateEditalIntegrity,
} from '../../src/core/services/editais';

/**
 * Unit tests for Edital Processing Service
 * Tests core JSON processing and validation without PDF extraction
 */
describe('Edital Processing Service - Unit Tests', () => {
  let service: EditalProcessService;

  beforeEach(() => {
    service = new EditalProcessService();
  });

  describe('JSON Schema Validation', () => {
    it('should validate a complete edital structure', () => {
      const validEdital = {
        concursos: [
          {
            metadata: {
              examName: 'Concurso Público para Analista',
              examOrg: 'TRF3',
              startDate: '2025-03-15',
              examTurn: 'manha' as const,
              totalQuestions: 100,
              criteriosEliminatorios: [],
            },
            fases: [
              {
                tipo: 'objetiva' as const,
                data: '2025-03-15',
                turno: 'manha' as const,
                totalQuestoes: 100,
                caraterEliminatorio: true,
                peso: 1.0,
              },
            ],
            disciplinas: [
              {
                nome: 'Língua Portuguesa',
                numeroQuestoes: 20,
                peso: 1.0,
                materias: [
                  {
                    nome: 'Compreensão e interpretação de textos',
                    ordem: 1,
                    subtopicos: [],
                    legislacoes: [],
                  },
                ],
              },
            ],
          },
        ],
        validacao: {
          totalDisciplinas: 1,
          totalQuestoes: 20,
          totalMaterias: 1,
          integridadeOK: true,
          avisos: [],
          erros: [],
        },
        metadataProcessamento: {
          dataProcessamento: new Date().toISOString(),
          versaoSchema: '1.0',
          modeloIA: 'claude-3-5-sonnet-20241022',
        },
      };

      const result = EditalProcessadoSchema.safeParse(validEdital);
      expect(result.success).toBe(true);
    });

    it('should reject invalid date format', () => {
      const invalidEdital = {
        concursos: [
          {
            metadata: {
              examName: 'Test',
              examOrg: 'Test Org',
              startDate: '25/12/2025', // Wrong format
              examTurn: 'manha',
              totalQuestions: 100,
              criteriosEliminatorios: [],
            },
            fases: [],
            disciplinas: [],
          },
        ],
        validacao: {
          totalDisciplinas: 0,
          totalQuestoes: 0,
          totalMaterias: 0,
          integridadeOK: false,
          avisos: [],
          erros: [],
        },
        metadataProcessamento: {
          dataProcessamento: new Date().toISOString(),
          versaoSchema: '1.0',
          modeloIA: 'claude',
        },
      };

      const result = EditalProcessadoSchema.safeParse(invalidEdital);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const invalidEdital = {
        concursos: [
          {
            metadata: {
              examName: 'Test',
              // Missing examOrg
              startDate: '2025-03-15',
              examTurn: 'manha',
              totalQuestions: 100,
            },
            fases: [],
            disciplinas: [],
          },
        ],
        validacao: {
          totalDisciplinas: 0,
          totalQuestoes: 0,
          totalMaterias: 0,
          integridadeOK: false,
          avisos: [],
          erros: [],
        },
        metadataProcessamento: {
          dataProcessamento: new Date().toISOString(),
          versaoSchema: '1.0',
          modeloIA: 'claude',
        },
      };

      const result = EditalProcessadoSchema.safeParse(invalidEdital);
      expect(result.success).toBe(false);
    });
  });

  describe('Integrity Validation', () => {
    it('should detect question count mismatch', () => {
      const edital = {
        concursos: [
          {
            metadata: {
              examName: 'Test Exam',
              examOrg: 'Test Org',
              startDate: '2025-03-15',
              examTurn: 'manha' as const,
              totalQuestions: 100, // Says 100
              criteriosEliminatorios: [],
            },
            fases: [
              {
                tipo: 'objetiva' as const,
                data: '2025-03-15',
                turno: 'manha' as const,
                totalQuestoes: 100,
                caraterEliminatorio: true,
                peso: 1.0,
              },
            ],
            disciplinas: [
              {
                nome: 'Test Discipline',
                numeroQuestoes: 20, // But only 20 in disciplines
                peso: 1.0,
                materias: [
                  {
                    nome: 'Test Subject',
                    ordem: 1,
                    subtopicos: [],
                    legislacoes: [],
                  },
                ],
              },
            ],
          },
        ],
        validacao: {
          totalDisciplinas: 1,
          totalQuestoes: 20,
          totalMaterias: 1,
          integridadeOK: true,
          avisos: [],
          erros: [],
        },
        metadataProcessamento: {
          dataProcessamento: new Date().toISOString(),
          versaoSchema: '1.0',
          modeloIA: 'claude',
        },
      };

      const validation = validateEditalIntegrity(edital);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0]).toContain('difere');
    });

    it('should detect discipline without subjects', () => {
      const edital = {
        concursos: [
          {
            metadata: {
              examName: 'Test Exam',
              examOrg: 'Test Org',
              startDate: '2025-03-15',
              examTurn: 'manha' as const,
              totalQuestions: 20,
              criteriosEliminatorios: [],
            },
            fases: [
              {
                tipo: 'objetiva' as const,
                data: '2025-03-15',
                turno: 'manha' as const,
                totalQuestoes: 20,
                caraterEliminatorio: true,
                peso: 1.0,
              },
            ],
            disciplinas: [
              {
                nome: 'Empty Discipline',
                numeroQuestoes: 20,
                peso: 1.0,
                materias: [], // No subjects!
              },
            ],
          },
        ],
        validacao: {
          totalDisciplinas: 1,
          totalQuestoes: 20,
          totalMaterias: 0,
          integridadeOK: true,
          avisos: [],
          erros: [],
        },
        metadataProcessamento: {
          dataProcessamento: new Date().toISOString(),
          versaoSchema: '1.0',
          modeloIA: 'claude',
        },
      };

      const validation = validateEditalIntegrity(edital);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('não possui matérias'))).toBe(true);
    });

    it('should accept valid edital', () => {
      const edital = {
        concursos: [
          {
            metadata: {
              examName: 'Valid Exam',
              examOrg: 'Valid Org',
              startDate: '2025-03-15',
              examTurn: 'manha' as const,
              totalQuestions: 20,
              criteriosEliminatorios: [],
            },
            fases: [
              {
                tipo: 'objetiva' as const,
                data: '2025-03-15',
                turno: 'manha' as const,
                totalQuestoes: 20,
                caraterEliminatorio: true,
                peso: 1.0,
              },
            ],
            disciplinas: [
              {
                nome: 'Valid Discipline',
                numeroQuestoes: 20,
                peso: 1.0,
                materias: [
                  {
                    nome: 'Valid Subject 1',
                    ordem: 1,
                    subtopicos: [],
                    legislacoes: [],
                  },
                  {
                    nome: 'Valid Subject 2',
                    ordem: 2,
                    subtopicos: ['Subtopic A', 'Subtopic B'],
                    legislacoes: [
                      {
                        tipo: 'lei' as const,
                        numero: '8112',
                        ano: '1990',
                        nome: 'Regime Jurídico dos Servidores',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        validacao: {
          totalDisciplinas: 1,
          totalQuestoes: 20,
          totalMaterias: 2,
          integridadeOK: true,
          avisos: [],
          erros: [],
        },
        metadataProcessamento: {
          dataProcessamento: new Date().toISOString(),
          versaoSchema: '1.0',
          modeloIA: 'claude',
        },
      };

      const validation = validateEditalIntegrity(edital);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });
  });

  describe('Legislation Extraction', () => {
    it('should validate legislation format', () => {
      const legislacao = {
        tipo: 'lei' as const,
        numero: '8112',
        ano: '1990',
        nome: 'Regime Jurídico dos Servidores Públicos Civis da União',
      };

      const edital = {
        concursos: [
          {
            metadata: {
              examName: 'Test',
              examOrg: 'Test',
              startDate: '2025-03-15',
              examTurn: 'manha' as const,
              totalQuestions: 10,
              criteriosEliminatorios: [],
            },
            fases: [
              {
                tipo: 'objetiva' as const,
                data: '2025-03-15',
                turno: 'manha' as const,
                totalQuestoes: 10,
                caraterEliminatorio: true,
                peso: 1.0,
              },
            ],
            disciplinas: [
              {
                nome: 'Direito Administrativo',
                numeroQuestoes: 10,
                peso: 1.0,
                materias: [
                  {
                    nome: 'Regime Jurídico',
                    ordem: 1,
                    subtopicos: [],
                    legislacoes: [legislacao],
                  },
                ],
              },
            ],
          },
        ],
        validacao: {
          totalDisciplinas: 1,
          totalQuestoes: 10,
          totalMaterias: 1,
          integridadeOK: true,
          avisos: [],
          erros: [],
        },
        metadataProcessamento: {
          dataProcessamento: new Date().toISOString(),
          versaoSchema: '1.0',
          modeloIA: 'claude',
        },
      };

      const result = EditalProcessadoSchema.safeParse(edital);
      expect(result.success).toBe(true);
      
      if (result.success) {
        const extracted = result.data.concursos[0].disciplinas[0].materias[0].legislacoes[0];
        expect(extracted.tipo).toBe('lei');
        expect(extracted.numero).toBe('8112');
        expect(extracted.ano).toBe('1990');
      }
    });
  });

  describe('Sample Content Processing', () => {
    it('should process a small edital sample', async () => {
      const sampleContent = `
EDITAL Nº 001/2025
CONCURSO PÚBLICO PARA ANALISTA JUDICIÁRIO

ÓRGÃO: Tribunal Regional Federal da 3ª Região
DATA DA PROVA: 15 de março de 2025
TURNO: Manhã
TOTAL DE QUESTÕES: 100

CONTEÚDO PROGRAMÁTICO - PROVA OBJETIVA

LÍNGUA PORTUGUESA (15 questões)
1. Compreensão e interpretação de textos
2. Tipologia textual
3. Ortografia oficial
4. Acentuação gráfica
5. Emprego das classes de palavras

DIREITO CONSTITUCIONAL (20 questões)
1. Constituição Federal de 1988: princípios fundamentais
2. Direitos e garantias fundamentais
3. Organização do Estado
4. Lei nº 8.112/1990 - Regime Jurídico dos Servidores Públicos Civis da União
5. Súmula Vinculante nº 13 do STF

DIREITO ADMINISTRATIVO (25 questões)
1. Princípios da Administração Pública
2. Organização administrativa
3. Atos administrativos
4. Contratos administrativos: Lei nº 8.666/1993 e Lei nº 14.133/2021
5. Servidores públicos
      `.trim();

      const result = await service['processWithClaude'](sampleContent);

      expect(result).toBeDefined();
      expect(result.concursos).toBeDefined();
      expect(result.concursos.length).toBeGreaterThan(0);
      
      const concurso = result.concursos[0];
      expect(concurso.metadata.examName).toBeTruthy();
      expect(concurso.metadata.examOrg).toBeTruthy();
      expect(concurso.disciplinas.length).toBeGreaterThan(0);
      
      // Validate JSON structure
      const validation = EditalProcessadoSchema.safeParse(result);
      expect(validation.success).toBe(true);
    }, 60000); // 1 minute timeout
  });
});
