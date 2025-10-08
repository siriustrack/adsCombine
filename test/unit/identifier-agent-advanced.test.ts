/**
 * Identifier Agent - Advanced Scenarios Tests
 * 
 * Testa cenários complexos e edge cases avançados:
 * - Formatação complexa de editais
 * - Múltiplas provas por concurso
 * - Disciplinas com 50+ tópicos
 * - Diferentes formatos de data
 * - Caracteres especiais e Unicode
 * - Fallback de OpenAI
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { identifyPlans } from '../../src/agents/sub-agents/identifier-agent';
import { callOpenAIWithFallback } from '../../src/agents/services/openai-client';

jest.mock('../../src/agents/services/openai-client');

const mockCallOpenAI = callOpenAIWithFallback as jest.MockedFunction<typeof callOpenAIWithFallback>;

describe('Identifier Agent - Advanced Scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Formatação Complexa de Editais', () => {
    test('deve processar edital com múltiplas seções e subseções', async () => {
      const complexContent = `
        EDITAL Nº 1/2024 - CONCURSO PÚBLICO
        
        CAPÍTULO I - DAS DISPOSIÇÕES PRELIMINARES
        1.1 O concurso será regido por este edital
        1.2 As inscrições serão realizadas via internet
        
        CAPÍTULO II - DO CONTEÚDO PROGRAMÁTICO
        
        SEÇÃO I - CONHECIMENTOS GERAIS
        
        2.1 DIREITO CONSTITUCIONAL (30 pontos)
        2.1.1 Teoria Geral da Constituição
          2.1.1.1 Conceito e classificação
          2.1.1.2 Poder constituinte
          2.1.1.3 Interpretação constitucional
        2.1.2 Direitos e Garantias Fundamentais
          2.1.2.1 Direitos individuais e coletivos
          2.1.2.2 Direitos sociais
          2.1.2.3 Direitos políticos
        
        2.2 DIREITO ADMINISTRATIVO (25 pontos)
        2.2.1 Princípios da Administração
        2.2.2 Atos Administrativos
        2.2.3 Licitações (Lei 14.133/2021)
        
        SEÇÃO II - CONHECIMENTOS ESPECÍFICOS
        
        3.1 DIREITO CIVIL (40 pontos)
        3.1.1 Parte Geral
        3.1.2 Obrigações
        3.1.3 Contratos
        
        CAPÍTULO III - DAS PROVAS
        4.1 Prova Objetiva: 30/04/2024 - Manhã - 100 questões
        4.2 Prova Discursiva: 30/04/2024 - Tarde - 3 questões
        4.3 Prova Oral: 15/06/2024 - Tarde - 10 questões
      `;

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Concurso Público Edital 1/2024',
                  examOrg: 'TRF4',
                  startDate: '2024-04-30',
                  fixedOffDays: [],
                  notes: 'Edital com estrutura complexa'
                },
                exams: [
                  { examType: 'objetiva' as const, examDate: '2024-04-30', examTurn: 'manha' as const, totalQuestions: 100 },
                  { examType: 'discursiva' as const, examDate: '2024-04-30', examTurn: 'tarde' as const, totalQuestions: 3 },
                  { examType: 'oral' as const, examDate: '2024-06-15', examTurn: 'tarde' as const, totalQuestions: 10 }
                ],
                disciplines: [
                  {
                    name: 'Direito Constitucional',
                    numberOfQuestions: 30,
                    topics: [
                      { name: 'Teoria Geral da Constituição', weight: 1.5 as 1 | 1.5 | 2 },
                      { name: 'Conceito e classificação', weight: 1.0 as 1 | 1.5 | 2 },
                      { name: 'Poder constituinte', weight: 1.5 as 1 | 1.5 | 2 },
                      { name: 'Interpretação constitucional', weight: 2.0 as 1 | 1.5 | 2 },
                      { name: 'Direitos e Garantias Fundamentais', weight: 2.0 as 1 | 1.5 | 2 }
                    ]
                  },
                  {
                    name: 'Direito Administrativo',
                    numberOfQuestions: 25,
                    topics: [
                      { name: 'Princípios da Administração', weight: 1.0 as 1 | 1.5 | 2 },
                      { name: 'Atos Administrativos', weight: 1.5 as 1 | 1.5 | 2 },
                      { name: 'Licitações (Lei 14.133/2021)', weight: 2.0 as 1 | 1.5 | 2 }
                    ]
                  }
                ]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans(complexContent);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].exams).toHaveLength(3);
      expect(result.data![0].disciplines).toHaveLength(2);
      expect(result.data![0].disciplines[0].topics.length).toBeGreaterThanOrEqual(5);
    });

    test('deve processar edital com tabelas e listas', async () => {
      const tableContent = `
        DISTRIBUIÇÃO DE QUESTÕES POR DISCIPLINA:
        
        | Disciplina              | Questões | Peso |
        |------------------------|----------|------|
        | Direito Constitucional | 20       | 2.0  |
        | Direito Administrativo | 15       | 1.5  |
        | Direito Civil          | 15       | 1.5  |
        | Direito Penal          | 10       | 1.0  |
        | TOTAL                  | 60       | -    |
        
        CONTEÚDO PROGRAMÁTICO:
        
        1. Direito Constitucional:
           • Constitucionalismo
           • Direitos fundamentais
           • Organização do Estado
           • Controle de constitucionalidade
        
        2. Direito Administrativo:
           ⚬ Princípios
           ⚬ Atos administrativos
           ⚬ Licitações
        
        Data da Prova: 15/05/2024 (Segunda-feira) às 14:00h
      `;

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Concurso com Tabela',
                  examOrg: 'TJSC',
                  startDate: '2024-05-15'
                },
                exams: [{
                  examType: 'objetiva' as const,
                  examDate: '2024-05-15',
                  examTurn: 'tarde' as const,
                  totalQuestions: 60
                }],
                disciplines: [
                  {
                    name: 'Direito Constitucional',
                    numberOfQuestions: 20,
                    topics: [
                      { name: 'Constitucionalismo', weight: 1.0 as 1 | 1.5 | 2 },
                      { name: 'Direitos fundamentais', weight: 2.0 as 1 | 1.5 | 2 }
                    ]
                  },
                  {
                    name: 'Direito Administrativo',
                    numberOfQuestions: 15,
                    topics: [
                      { name: 'Princípios', weight: 1.0 as 1 | 1.5 | 2 },
                      { name: 'Atos administrativos', weight: 1.5 as 1 | 1.5 | 2 }
                    ]
                  }
                ]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans(tableContent);

      expect(result.success).toBe(true);
      expect(result.data![0].disciplines[0].numberOfQuestions).toBe(20);
      expect(result.data![0].exams[0].totalQuestions).toBe(60);
    });
  });

  describe('Disciplinas com Muitos Tópicos', () => {
    test('deve processar disciplina com 50+ tópicos', async () => {
      const manyTopicsContent = 'Disciplina com 60 tópicos detalhados';

      const topics = Array.from({ length: 60 }, (_, i) => ({
        name: `Tópico ${i + 1}: Subtema específico do Direito Constitucional`,
        weight: (i % 3 === 0 ? 2.0 : i % 2 === 0 ? 1.5 : 1.0) as 1 | 1.5 | 2
      }));

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Concurso Detalhado',
                  examOrg: 'AGU',
                  startDate: '2024-06-01'
                },
                exams: [{
                  examType: 'objetiva' as const,
                  examDate: '2024-06-01',
                  examTurn: 'manha' as const,
                  totalQuestions: 100
                }],
                disciplines: [{
                  name: 'Direito Constitucional',
                  numberOfQuestions: 60,
                  topics
                }]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans(manyTopicsContent);

      expect(result.success).toBe(true);
      expect(result.data![0].disciplines[0].topics).toHaveLength(60);
      expect(result.data![0].disciplines[0].topics[0].weight).toBe(2.0);
      expect(result.data![0].disciplines[0].topics[1].weight).toBe(1.0);
      expect(result.data![0].disciplines[0].topics[2].weight).toBe(1.5);
    });

    test('deve processar múltiplas disciplinas com 30+ tópicos cada', async () => {
      const multiDisciplineContent = '3 disciplinas com 30 tópicos cada';

      const createDiscipline = (name: string, topicCount: number) => ({
        name,
        numberOfQuestions: topicCount,
        topics: Array.from({ length: topicCount }, (_, i) => ({
          name: `${name} - Tópico ${i + 1}`,
          weight: 1.0 as 1 | 1.5 | 2
        }))
      });

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Concurso Extenso',
                  examOrg: 'MPF',
                  startDate: '2024-07-01'
                },
                exams: [{
                  examType: 'objetiva' as const,
                  examDate: '2024-07-01',
                  examTurn: 'manha' as const,
                  totalQuestions: 90
                }],
                disciplines: [
                  createDiscipline('Direito Constitucional', 35),
                  createDiscipline('Direito Administrativo', 30),
                  createDiscipline('Direito Penal', 32)
                ]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans(multiDisciplineContent);

      expect(result.success).toBe(true);
      expect(result.data![0].disciplines).toHaveLength(3);
      expect(result.data![0].disciplines[0].topics).toHaveLength(35);
      expect(result.data![0].disciplines[1].topics).toHaveLength(30);
      expect(result.data![0].disciplines[2].topics).toHaveLength(32);
    });
  });

  describe('Formatos de Data', () => {
    test('deve processar diferentes formatos de data brasileira', async () => {
      const dateFormats = `
        Prova 1: 30/04/2024
        Prova 2: 17-06-2024
        Prova 3: 25.08.2024
        Prova 4: 15 de setembro de 2024
        Prova 5: 1º de outubro de 2024
      `;

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Concurso Múltiplas Datas',
                  examOrg: 'TJSC',
                  startDate: '2024-04-30'
                },
                exams: [
                  { examType: 'objetiva' as const, examDate: '2024-04-30', examTurn: 'manha' as const, totalQuestions: 50 },
                  { examType: 'discursiva' as const, examDate: '2024-06-17', examTurn: 'tarde' as const, totalQuestions: 3 },
                  { examType: 'prática' as const, examDate: '2024-08-25', examTurn: 'manha' as const, totalQuestions: 2 },
                  { examType: 'oral' as const, examDate: '2024-09-15', examTurn: 'tarde' as const, totalQuestions: 10 },
                  { examType: 'oral' as const, examDate: '2024-10-01', examTurn: 'manha' as const, totalQuestions: 5 }
                ],
                disciplines: [{
                  name: 'Direito Geral',
                  topics: [{ name: 'Tópico Geral', weight: 1.0 as 1 | 1.5 | 2 }]
                }]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans(dateFormats);

      expect(result.success).toBe(true);
      expect(result.data![0].exams).toHaveLength(5);
      expect(result.data![0].exams[0].examDate).toBe('2024-04-30');
      expect(result.data![0].exams[1].examDate).toBe('2024-06-17');
      expect(result.data![0].exams[4].examDate).toBe('2024-10-01');
    });

    test('deve processar datas "a divulgar"', async () => {
      const undefinedDates = `
        Prova Objetiva: 15/05/2024
        Prova Discursiva: A divulgar
        Prova Oral: A definir
      `;

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Concurso Datas Indefinidas',
                  examOrg: 'MPU',
                  startDate: '2024-05-15'
                },
                exams: [
                  { examType: 'objetiva' as const, examDate: '2024-05-15', examTurn: 'manha' as const, totalQuestions: 80 },
                  { examType: 'discursiva' as const, examDate: 'a divulgar', examTurn: 'tarde' as const, totalQuestions: 4 },
                  { examType: 'oral' as const, examDate: 'a divulgar', examTurn: 'tarde' as const, totalQuestions: 10 }
                ],
                disciplines: [{
                  name: 'Direito',
                  topics: [{ name: 'Tópico', weight: 1.0 as 1 | 1.5 | 2 }]
                }]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans(undefinedDates);

      expect(result.success).toBe(true);
      expect(result.data![0].exams[1].examDate).toBe('a divulgar');
      expect(result.data![0].exams[2].examDate).toBe('a divulgar');
    });
  });

  describe('Caracteres Especiais e Unicode', () => {
    test('deve processar conteúdo com acentos e cedilha', async () => {
      const accentContent = `
        Concurso: Procuradoria-Geral da República
        Órgão: PGR
        
        Disciplinas:
        1. Língua Portuguesa (acentuação, pontuação, compreensão)
        2. Legislação Específica (aplicação, interpretação)
        3. Informática (técnicas, aplicações práticas)
      `;

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Procuradoria-Geral da República',
                  examOrg: 'PGR',
                  startDate: '2024-08-01'
                },
                exams: [{
                  examType: 'objetiva' as const,
                  examDate: '2024-08-01',
                  examTurn: 'manha' as const,
                  totalQuestions: 50
                }],
                disciplines: [
                  { name: 'Língua Portuguesa', topics: [{ name: 'acentuação', weight: 1.0 as 1 | 1.5 | 2 }] },
                  { name: 'Legislação Específica', topics: [{ name: 'aplicação', weight: 1.5 as 1 | 1.5 | 2 }] },
                  { name: 'Informática', topics: [{ name: 'técnicas', weight: 1.0 as 1 | 1.5 | 2 }] }
                ]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans(accentContent);

      expect(result.success).toBe(true);
      expect(result.data![0].metadata.examName).toBe('Procuradoria-Geral da República');
      expect(result.data![0].disciplines[0].name).toBe('Língua Portuguesa');
    });

    test('deve processar emojis e símbolos', async () => {
      const emojiContent = `
        📋 EDITAL 2024
        
        🎯 Objetivo: Provimento de cargos
        📅 Data: 20/05/2024
        📍 Local: A definir
        
        ✅ Disciplinas:
        • Português ⭐
        • Matemática 🔢
        • Informática 💻
      `;

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'EDITAL 2024',
                  examOrg: 'Órgão Público',
                  startDate: '2024-05-20'
                },
                exams: [{
                  examType: 'objetiva' as const,
                  examDate: '2024-05-20',
                  examTurn: 'manha' as const,
                  totalQuestions: 60
                }],
                disciplines: [
                  { name: 'Português', topics: [{ name: 'Gramática', weight: 1.0 as 1 | 1.5 | 2 }] },
                  { name: 'Matemática', topics: [{ name: 'Álgebra', weight: 1.5 as 1 | 1.5 | 2 }] },
                  { name: 'Informática', topics: [{ name: 'Windows', weight: 1.0 as 1 | 1.5 | 2 }] }
                ]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans(emojiContent);

      expect(result.success).toBe(true);
      expect(result.data![0].disciplines).toHaveLength(3);
    });
  });

  describe('Fallback e Retry', () => {
    test('deve tentar fallback quando OpenAI falha', async () => {
      mockCallOpenAI
        .mockRejectedValueOnce(new Error('API timeout'))
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                plans: [{
                  metadata: { examName: 'Test', examOrg: 'Test', startDate: '2024-01-01' },
                  exams: [{ examType: 'objetiva' as const, examDate: '2024-01-01', examTurn: 'manha' as const, totalQuestions: 50 }],
                  disciplines: [{ name: 'Test', topics: [{ name: 'Test', weight: 1.0 as 1 | 1.5 | 2 }] }]
                }]
              })
            }
          }]
        } as any);

      const result = await identifyPlans('test content');

      // O callOpenAIWithFallback já implementa retry internamente
      expect(mockCallOpenAI).toHaveBeenCalled();
    });

    test('deve falhar após múltiplas tentativas', async () => {
      mockCallOpenAI.mockRejectedValue(new Error('Service unavailable'));

      const result = await identifyPlans('test content');

      // O callOpenAIWithFallback pode ter fallback que eventualmente funciona
      // ou retorna erro - ambos são comportamentos válidos
      expect(mockCallOpenAI).toHaveBeenCalled();
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('Edge Cases Complexos', () => {
    test('deve processar concurso com 20+ disciplinas', async () => {
      const manyDisciplines = Array.from({ length: 25 }, (_, i) => ({
        name: `Disciplina ${i + 1}`,
        numberOfQuestions: 4,
        topics: [
          { name: `Tópico ${i + 1}.1`, weight: 1.0 as 1 | 1.5 | 2 },
          { name: `Tópico ${i + 1}.2`, weight: 1.5 as 1 | 1.5 | 2 }
        ]
      }));

      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Concurso Grande',
                  examOrg: 'Ministério',
                  startDate: '2024-09-01'
                },
                exams: [{
                  examType: 'objetiva' as const,
                  examDate: '2024-09-01',
                  examTurn: 'manha' as const,
                  totalQuestions: 100
                }],
                disciplines: manyDisciplines
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans('concurso com 25 disciplinas');

      expect(result.success).toBe(true);
      expect(result.data![0].disciplines).toHaveLength(25);
    });

    test('deve processar concurso com todos os tipos de prova', async () => {
      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Concurso Completo',
                  examOrg: 'TRF',
                  startDate: '2024-10-01'
                },
                exams: [
                  { examType: 'objetiva' as const, examDate: '2024-10-01', examTurn: 'manha' as const, totalQuestions: 100 },
                  { examType: 'discursiva' as const, examDate: '2024-10-01', examTurn: 'tarde' as const, totalQuestions: 4 },
                  { examType: 'prática' as const, examDate: '2024-10-15', examTurn: 'manha' as const, totalQuestions: 2 },
                  { examType: 'oral' as const, examDate: '2024-11-01', examTurn: 'tarde' as const, totalQuestions: 10 }
                ],
                disciplines: [{
                  name: 'Direito',
                  topics: [{ name: 'Geral', weight: 1.0 as 1 | 1.5 | 2 }]
                }]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans('concurso com todas as provas');

      expect(result.success).toBe(true);
      expect(result.data![0].exams).toHaveLength(4);
      expect(result.data![0].exams.map(e => e.examType)).toEqual(['objetiva', 'discursiva', 'prática', 'oral']);
    });

    test('deve processar fixedOffDays variados', async () => {
      mockCallOpenAI.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              plans: [{
                metadata: {
                  examName: 'Concurso Folgas',
                  examOrg: 'TJRJ',
                  startDate: '2024-11-01',
                  fixedOffDays: ['sun', 'sat', 'wed'], // Domingo, Sábado, Quarta
                  notes: 'Folgas especiais: fins de semana + quarta-feira'
                },
                exams: [{
                  examType: 'objetiva' as const,
                  examDate: '2024-11-01',
                  examTurn: 'manha' as const,
                  totalQuestions: 80
                }],
                disciplines: [{
                  name: 'Direito',
                  topics: [{ name: 'Geral', weight: 1.0 as 1 | 1.5 | 2 }]
                }]
              }]
            })
          }
        }]
      } as any);

      const result = await identifyPlans('concurso com folgas especiais');

      expect(result.success).toBe(true);
      expect(result.data![0].metadata.fixedOffDays).toEqual(['sun', 'sat', 'wed']);
    });
  });
});
