import { z } from 'zod';

// Schema de Legislação
export const LegislacaoSchema = z.object({
  tipo: z.enum(['lei', 'decreto', 'decreto_lei', 'resolucao', 'portaria', 'instrucao_normativa', 'sumula']),
  numero: z.string(),
  ano: z.string().regex(/^\d{4}$/),
  nome: z.string(),
  complemento: z.string().optional(),
});

export type Legislacao = z.infer<typeof LegislacaoSchema>;

// Schema de Matéria
export const MateriaSchema = z.object({
  nome: z.string().min(1, 'Nome da matéria é obrigatório'),
  ordem: z.number().int().positive(),
  subtopicos: z.array(z.string()).default([]),
  legislacoes: z.array(LegislacaoSchema).default([]),
  bibliografia: z.string().optional(),
  observacoes: z.string().optional(),
});

export type Materia = z.infer<typeof MateriaSchema>;

// Schema de Disciplina
export const DisciplinaSchema = z.object({
  nome: z.string().min(1, 'Nome da disciplina é obrigatório'),
  numeroQuestoes: z.number().int().nonnegative(),
  peso: z.number().positive().default(1.0),
  materias: z.array(MateriaSchema).min(1, 'Disciplina deve ter ao menos uma matéria'),
  observacoes: z.string().optional(),
});

export type Disciplina = z.infer<typeof DisciplinaSchema>;

// Schema de Fase do Concurso
export const FaseConcursoSchema = z.object({
  tipo: z.enum(['objetiva', 'discursiva', 'pratica', 'oral', 'titulos', 'aptidao_fisica']),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$|^a_divulgar$/, 'Data deve estar no formato YYYY-MM-DD ou "a_divulgar"'),
  turno: z.enum(['manha', 'tarde', 'noite', 'integral', 'nao_especificado']),
  totalQuestoes: z.number().int().nonnegative().optional(),
  duracao: z.string().optional(), // Ex: "4 horas"
  caraterEliminatorio: z.boolean().default(false),
  notaMinima: z.number().optional(),
  peso: z.number().positive().default(1.0),
});

export type FaseConcurso = z.infer<typeof FaseConcursoSchema>;

// Schema de Metadata do Concurso
export const MetadataConcursoSchema = z.object({
  examName: z.string().min(1, 'Nome do concurso é obrigatório'),
  examOrg: z.string().min(1, 'Órgão é obrigatório'),
  cargo: z.string().optional(),
  area: z.string().optional(),
  especialidade: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  examTurn: z.enum(['manha', 'tarde', 'noite', 'integral', 'nao_especificado']),
  totalQuestions: z.number().int().positive('Total de questões deve ser positivo'),
  notaMinimaAprovacao: z.number().optional(),
  notaMinimaEliminatoria: z.number().optional(),
  criteriosEliminatorios: z.array(z.string()).default([]),
  notes: z.string().optional(),
  editalUrl: z.string().url().optional(),
  inscricoesInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  inscricoesFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type MetadataConcurso = z.infer<typeof MetadataConcursoSchema>;

// Schema Principal de Concurso
export const ConcursoSchema = z.object({
  metadata: MetadataConcursoSchema,
  fases: z.array(FaseConcursoSchema).min(1, 'Concurso deve ter ao menos uma fase'),
  disciplinas: z.array(DisciplinaSchema).min(1, 'Concurso deve ter ao menos uma disciplina'),
});

export type Concurso = z.infer<typeof ConcursoSchema>;

// Schema de Validação
export const ValidacaoSchema = z.object({
  totalDisciplinas: z.number().int().nonnegative(),
  totalQuestoes: z.number().int().nonnegative(),
  totalMaterias: z.number().int().nonnegative(),
  integridadeOK: z.boolean(),
  avisos: z.array(z.string()).default([]),
  erros: z.array(z.string()).default([]),
});

export type Validacao = z.infer<typeof ValidacaoSchema>;

// Schema Final do Edital Processado
export const EditalProcessadoSchema = z.object({
  concursos: z.array(ConcursoSchema).min(1, 'Deve haver ao menos um concurso'),
  validacao: ValidacaoSchema,
  metadataProcessamento: z.object({
    dataProcessamento: z.string(),
    versaoSchema: z.string().default('1.0'),
    tempoProcessamento: z.number().optional(),
    modeloIA: z.string(),
  }),
});

export type EditalProcessado = z.infer<typeof EditalProcessadoSchema>;

// Função de validação customizada
export function validateEditalIntegrity(edital: EditalProcessado): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const concurso of edital.concursos) {
    // Validar soma de questões
    const somaQuestoesDisciplinas = concurso.disciplinas.reduce(
      (acc, d) => acc + d.numeroQuestoes,
      0
    );

    const faseObjetiva = concurso.fases.find(f => f.tipo === 'objetiva');
    if (faseObjetiva && faseObjetiva.totalQuestoes) {
      if (somaQuestoesDisciplinas !== faseObjetiva.totalQuestoes) {
        errors.push(
          `[${concurso.metadata.examName}] Soma das questões por disciplina (${somaQuestoesDisciplinas}) difere do total da prova objetiva (${faseObjetiva.totalQuestoes})`
        );
      }
    }

    if (somaQuestoesDisciplinas !== concurso.metadata.totalQuestions) {
      warnings.push(
        `[${concurso.metadata.examName}] Soma das questões por disciplina (${somaQuestoesDisciplinas}) difere do total no metadata (${concurso.metadata.totalQuestions})`
      );
    }

    // Validar que todas as disciplinas têm matérias
    for (const disciplina of concurso.disciplinas) {
      if (disciplina.materias.length === 0) {
        errors.push(
          `[${concurso.metadata.examName}] Disciplina "${disciplina.nome}" não possui matérias`
        );
      }

      // Validar ordem das matérias
      const ordens = disciplina.materias.map(m => m.ordem);
      const ordensUnicas = new Set(ordens);
      if (ordens.length !== ordensUnicas.size) {
        warnings.push(
          `[${concurso.metadata.examName}] Disciplina "${disciplina.nome}" possui matérias com ordem duplicada`
        );
      }
    }

    // Validar datas
    try {
      const startDate = new Date(concurso.metadata.startDate);
      if (startDate < new Date('2020-01-01')) {
        warnings.push(
          `[${concurso.metadata.examName}] Data de início parece muito antiga: ${concurso.metadata.startDate}`
        );
      }
    } catch {
      errors.push(
        `[${concurso.metadata.examName}] Data de início inválida: ${concurso.metadata.startDate}`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
