import { SupabaseService } from '../services/supabase-service';
import type { StudyPlanData, AgentResponse } from '../types/types';
import { logError, logInfo } from '../utils/logger';

export async function orchestratePlanCreation(userId: string, planData: StudyPlanData): Promise<AgentResponse<string>> {
  // Validações de Input
  if (!userId || typeof userId !== 'string') {
    return { success: false, error: 'userId inválido' };
  }
  if (!planData || !planData.metadata || !planData.exams || !planData.disciplines) {
    return { success: false, error: 'Dados do plano inválidos' };
  }

  logInfo('orchestrator-agent', userId, 'Iniciando criação do plano de estudo', { examName: planData.metadata.examName });

  try {
    // 1. Criar study_plan
    const studyPlanData = {
      user_id: userId,
      exam_name: planData.metadata.examName,
      exam_org: planData.metadata.examOrg,
      start_date: planData.metadata.startDate,
      fixed_off_days: planData.metadata.fixedOffDays,
      notes: planData.metadata.notes,
      status: 'processing',
    };

    const studyPlan = await SupabaseService.insertStudyPlan(studyPlanData, userId);
    const planId = studyPlan.id;
    logInfo('orchestrator-agent', userId, 'Study plan criado', { planId });

    // 2. Criar exams
    const examsData = planData.exams.map(exam => ({
      plan_id: planId,
      exam_type: exam.examType,
      exam_date: exam.examDate,
      exam_turn: exam.examTurn,
      total_questions: exam.totalQuestions,
    }));

    await SupabaseService.insertExams(examsData, userId);
    logInfo('orchestrator-agent', userId, 'Exams criados', { count: planData.exams.length });

    // 3. Criar disciplines e topics
    const disciplinesData = planData.disciplines.map(discipline => ({
      plan_id: planId,
      name: discipline.name,
      color: discipline.color,
      number_of_questions: discipline.numberOfQuestions,
    }));

    const insertedDisciplines = await SupabaseService.insertDisciplines(disciplinesData, userId);

    for (let i = 0; i < planData.disciplines.length; i++) {
      const discipline = planData.disciplines[i];
      const disciplineId = insertedDisciplines[i].id;

      const topicsData = discipline.topics.map(topic => ({
        plan_id: planId,
        discipline_id: disciplineId,
        name: topic.name,
        weight: topic.weight,
      }));

      await SupabaseService.insertTopics(topicsData, userId);
    }

    logInfo('orchestrator-agent', userId, 'Disciplines e topics criados', { disciplineCount: planData.disciplines.length });

    return { success: true, data: planId };
  } catch (error) {
    logError('orchestrator-agent', userId, error, { planData });
    return { success: false, error: `Erro no orquestrador: ${(error as Error).message}` };
  }
}