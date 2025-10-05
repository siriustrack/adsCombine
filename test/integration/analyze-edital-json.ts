#!/usr/bin/env bun
/**
 * Análise do JSON do Edital Processado
 * 
 * Analisa o JSON extraído pelo Claude e gera um relatório detalhado
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const JSON_FILE = process.argv[2] || 'temp/editais-json/edital ENAC.json';

async function analyzeEditalJson() {
  console.log('📊 ANÁLISE DO JSON PROCESSADO\n');
  console.log(`📄 Arquivo: ${JSON_FILE}\n`);

  // Ler JSON
  const content = await fs.readFile(JSON_FILE, 'utf-8');
  const data = JSON.parse(content);

  // Análise geral
  console.log('🎯 INFORMAÇÕES GERAIS');
  console.log('='.repeat(60));
  console.log(`✅ Status de Integridade: ${data.validacao.integridadeOK ? 'OK' : 'COM PROBLEMAS'}`);
  console.log(`📚 Total de Concursos: ${data.concursos.length}`);
  console.log(`📊 Total de Disciplinas: ${data.validacao.totalDisciplinas}`);
  console.log(`📝 Total de Matérias: ${data.validacao.totalMaterias}`);
  console.log(`❓ Total de Questões: ${data.validacao.totalQuestoes}`);
  
  if (data.validacao.erros.length > 0) {
    console.log(`\n❌ Erros (${data.validacao.erros.length}):`);
    data.validacao.erros.forEach((e: string) => console.log(`   • ${e}`));
  }
  
  if (data.validacao.avisos.length > 0) {
    console.log(`\n⚠️  Avisos (${data.validacao.avisos.length}):`);
    data.validacao.avisos.forEach((a: string) => console.log(`   • ${a}`));
  }

  // Análise por concurso
  for (const concurso of data.concursos) {
    console.log('\n\n📋 DETALHES DO CONCURSO');
    console.log('='.repeat(60));
    console.log(`Nome: ${concurso.metadata.examName}`);
    console.log(`Órgão: ${concurso.metadata.examOrg}`);
    console.log(`Data: ${concurso.metadata.startDate}`);
    console.log(`Turno: ${concurso.metadata.examTurn}`);
    console.log(`Total de Questões: ${concurso.metadata.totalQuestions}`);
    console.log(`Nota Mínima: ${concurso.metadata.notaMinimaAprovacao || 'N/A'}`);
    
    if (concurso.metadata.cargo) {
      console.log(`Cargo: ${concurso.metadata.cargo}`);
    }
    
    if (concurso.metadata.area) {
      console.log(`Área: ${concurso.metadata.area}`);
    }

    // Fases
    console.log(`\n📅 Fases (${concurso.fases.length}):`);
    concurso.fases.forEach((fase: any, i: number) => {
      console.log(`   ${i + 1}. ${fase.tipo} - ${fase.totalQuestoes || 'N/A'} questões - Nota: ${fase.notaMinima || 'N/A'}`);
    });

    // Disciplinas
    console.log(`\n📚 DISCIPLINAS (${concurso.disciplinas.length}):`);
    console.log('='.repeat(60));
    
    let totalMaterias = 0;
    let totalLegislacoes = 0;
    
    concurso.disciplinas.forEach((disc: any, i: number) => {
      totalMaterias += disc.materias.length;
      
      const legislacoes = disc.materias.reduce((sum: number, mat: any) => 
        sum + (mat.legislacoes?.length || 0), 0
      );
      totalLegislacoes += legislacoes;
      
      console.log(`\n${i + 1}. ${disc.nome}`);
      console.log(`   Questões: ${disc.numeroQuestoes}`);
      console.log(`   Matérias: ${disc.materias.length}`);
      console.log(`   Legislações: ${legislacoes}`);
      
      // Listar matérias
      disc.materias.forEach((mat: any, j: number) => {
        const subtopics = mat.subtopicos?.length || 0;
        const laws = mat.legislacoes?.length || 0;
        console.log(`      ${j + 1}. ${mat.nome} (${subtopics} subtópicos, ${laws} leis)`);
      });
    });

    console.log(`\n\n📊 ESTATÍSTICAS CONSOLIDADAS:`);
    console.log(`   Total de Matérias: ${totalMaterias}`);
    console.log(`   Total de Legislações: ${totalLegislacoes}`);
    
    // Legislações mais citadas
    const legislacoesMap = new Map<string, number>();
    concurso.disciplinas.forEach((disc: any) => {
      disc.materias.forEach((mat: any) => {
        mat.legislacoes?.forEach((leg: any) => {
          const key = `${leg.tipo} ${leg.numero}/${leg.ano}`;
          legislacoesMap.set(key, (legislacoesMap.get(key) || 0) + 1);
        });
      });
    });
    
    if (legislacoesMap.size > 0) {
      const topLaws = Array.from(legislacoesMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      
      console.log(`\n📜 TOP 10 LEGISLAÇÕES MAIS CITADAS:`);
      topLaws.forEach(([law, count], i) => {
        console.log(`   ${i + 1}. ${law} - ${count}x`);
      });
    }
  }

  // Metadata de processamento
  console.log('\n\n🤖 METADATA DE PROCESSAMENTO');
  console.log('='.repeat(60));
  console.log(`Data: ${data.metadataProcessamento.dataProcessamento}`);
  console.log(`Versão do Schema: ${data.metadataProcessamento.versaoSchema}`);
  console.log(`Modelo de IA: ${data.metadataProcessamento.modeloIA}`);

  console.log('\n✨ Análise concluída!\n');
}

analyzeEditalJson().catch(console.error);
