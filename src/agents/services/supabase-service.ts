import { supabase } from '../../config/supabase';
import { logError, logInfo } from '../utils/logger';

export class SupabaseService {
  static async insertStudyPlan(data: any, userId: string) {
    logInfo('supabase-service', userId, 'Inserindo study_plan', { examName: data.exam_name });
    const { data: result, error } = await supabase
      .from('study_plans')
      .insert(data)
      .select('id')
      .single();

    if (error) {
      logError('supabase-service', userId, error, { data });
      throw error;
    }

    return result;
  }

  static async insertExams(exams: any[], userId: string) {
    logInfo('supabase-service', userId, 'Inserindo exams', { count: exams.length });
    const { data, error } = await supabase
      .from('exams')
      .insert(exams)
      .select();

    if (error) {
      logError('supabase-service', userId, error, { exams });
      throw error;
    }

    return data;
  }

  static async insertDisciplines(disciplines: any[], userId: string) {
    logInfo('supabase-service', userId, 'Inserindo disciplines', { count: disciplines.length });
    const { data, error } = await supabase
      .from('disciplines')
      .insert(disciplines)
      .select('id, name');

    if (error) {
      logError('supabase-service', userId, error, { disciplines });
      throw error;
    }

    return data;
  }

  static async insertTopics(topics: any[], userId: string) {
    logInfo('supabase-service', userId, 'Inserindo topics', { count: topics.length });
    const { data, error } = await supabase
      .from('topics')
      .insert(topics)
      .select();

    if (error) {
      logError('supabase-service', userId, error, { topics });
      throw error;
    }

    return data;
  }

  static async updateStudyPlanStatus(planId: string, status: string, userId: string) {
    logInfo('supabase-service', userId, 'Atualizando status do study_plan', { planId, status });
    const { error } = await supabase
      .from('study_plans')
      .update({ status })
      .eq('id', planId);

    if (error) {
      logError('supabase-service', userId, error, { planId, status });
      throw error;
    }
  }

  static async getStudyPlan(planId: string, userId: string) {
    const { data, error } = await supabase
      .from('study_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (error) {
      logError('supabase-service', userId, error, { planId });
      throw error;
    }

    return data;
  }

  static async getExams(planId: string, userId: string) {
    const { data, error } = await supabase
      .from('exams')
      .select('*')
      .eq('plan_id', planId);

    if (error) {
      logError('supabase-service', userId, error, { planId });
      throw error;
    }

    return data;
  }

  static async getDisciplinesWithTopics(planId: string, userId: string) {
    const { data, error } = await supabase
      .from('disciplines')
      .select('*, topics(*)')
      .eq('plan_id', planId);

    if (error) {
      logError('supabase-service', userId, error, { planId });
      throw error;
    }

    return data;
  }

  static async deleteStudyPlan(planId: string, userId: string) {
    logInfo('supabase-service', userId, 'Deletando study_plan (rollback)', { planId });
    const { error } = await supabase
      .from('study_plans')
      .delete()
      .eq('id', planId);

    if (error) {
      logError('supabase-service', userId, error, { planId });
      throw error;
    }
  }
}