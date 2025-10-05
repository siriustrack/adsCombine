export interface StudyPlanInput {
  userId: string;
  content: string; // Conteúdo extraído do PDF
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