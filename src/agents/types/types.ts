export interface StudyPlanInput {
  userId: string;
  content: string | EditalProcessadoData; // Aceita texto OU JSON estruturado
}

// Tipo para JSON processado do edital-process
export interface EditalProcessadoData {
  concursos: Array<{
    metadata: {
      examName: string;
      examOrg: string;
      startDate: string | null;
      examTurn?: string;
      totalQuestions: number;
      [key: string]: any;
    };
    fases: Array<{
      tipoFase: string;
      nomeProva: string;
      tipoProva: string;
      disciplinas: Array<{
        nome: string;
        materias: Array<{
          nome: string;
          ordem: number;
          subtopicos?: string[];
          legislacoes?: string[];
        }>;
        numeroQuestoes?: number;
        peso?: number;
      }>;
    }>;
    disciplinas: Array<{
      nome: string;
      materias: Array<{
        nome: string;
        ordem: number;
        subtopicos?: string[];
        legislacoes?: string[];
      }>;
      numeroQuestoes?: number;
      peso?: number;
    }>;
  }>;
  validacao: {
    totalDisciplinas: number;
    totalQuestoes: number;
    totalMaterias: number;
    integridadeOK: boolean;
  };
}

export interface StudyPlanMetadata {
  examName: string;
  examOrg: string;
  startDate: string; // YYYY-MM-DD
  fixedOffDays?: string[]; // Ex.: ['sun', 'sat']
  notes?: string;
}

export interface ExamData {
  examType: 'objetiva' | 'discursiva' | 'prática' | 'oral';
  examDate: string; // Pode ser "a divulgar"
  examTurn: 'manha' | 'tarde' | 'noite';
  totalQuestions: number;
}

export interface DisciplineData {
  name: string;
  color?: string;
  numberOfQuestions?: number;
}

export interface TopicData {
  name: string;
  weight: 1.0 | 1.5 | 2.0;
}

export interface DisciplineWithTopics extends DisciplineData {
  topics: TopicData[];
}

export interface StudyPlanData {
  metadata: StudyPlanMetadata;
  exams: ExamData[];
  disciplines: DisciplineWithTopics[];
}

export interface AgentResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}