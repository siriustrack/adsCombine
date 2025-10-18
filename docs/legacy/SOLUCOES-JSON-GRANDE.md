# 🏭 Soluções Industriais para Processamento de JSONs Grandes

## Contexto do Problema

**Situação Atual:**
- Edital Juiz SC: 202K chars input → 2536+ linhas JSON output
- Claude Sonnet 4.5: 200K context, 64K max_tokens output
- Problema: Socket timeout/truncamento após ~8 minutos

**Casos Similares na Indústria:**
- Processamento de documentos legais extensos
- Extração de dados médicos detalhados
- Análise de relatórios financeiros complexos
- ETL de sistemas legados

---

## 🎯 Solução 1: Chunking Hierárquico com Merge (RECOMENDADO)

### Estratégia: Dividir e Conquistar

**Conceito:**
1. Primeira passagem: Extrair **estrutura** (disciplinas + metadados)
2. Segunda passagem: Extrair **detalhes** por disciplina
3. Merge final: Combinar resultados

### Implementação

```typescript
// 1. PASS 1: Extrair estrutura básica
interface EditalStructure {
  metadata: Metadata;
  fases: Fase[];
  disciplinas: {
    nome: string;
    numeroQuestoes: number;
    observacoes?: string;
  }[];
}

async extractStructure(content: string): Promise<EditalStructure> {
  const promptStructure = `
# EXTRACT ONLY STRUCTURE - NO DETAILED CONTENT

Extract ONLY:
1. Exam metadata (name, org, date, total questions)
2. Exam phases (objetiva, discursiva, etc)
3. Subject names and question counts

DO NOT extract:
- Detailed topics (materias)
- Subtopics
- Legislation details

Return minimal JSON:
{
  "metadata": {...},
  "fases": [...],
  "disciplinas": [
    {"nome": "Direito Civil", "numeroQuestoes": 10}
  ]
}
`;

  const response = await this.anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4000, // MUITO menor - só estrutura
    system: promptStructure,
    messages: [{ role: 'user', content }]
  });
  
  return JSON.parse(response.content[0].text);
}

// 2. PASS 2: Extrair detalhes por disciplina
async extractDisciplineDetails(
  content: string, 
  disciplineName: string
): Promise<Materia[]> {
  const promptDetails = `
# EXTRACT DETAILS FOR SPECIFIC SUBJECT

Subject: "${disciplineName}"

Extract ONLY topics (matérias) and subtopics for THIS subject.
Ignore all other subjects.

Return:
{
  "materias": [
    {
      "nome": "...",
      "ordem": 1,
      "subtopicos": [...],
      "legislacoes": [...]
    }
  ]
}
`;

  const response = await this.anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8000, // Por disciplina
    system: promptDetails,
    messages: [{ role: 'user', content }]
  });
  
  return JSON.parse(response.content[0].text).materias;
}

// 3. ORCHESTRATOR: Combinar tudo
async processWithChunking(content: string): Promise<EditalProcessado> {
  // Pass 1: Estrutura
  const structure = await this.extractStructure(content);
  
  // Pass 2: Detalhes por disciplina (paralelo)
  const disciplinasCompletas = await Promise.all(
    structure.disciplinas.map(async (disc) => {
      const materias = await this.extractDisciplineDetails(content, disc.nome);
      return {
        ...disc,
        materias,
        peso: 1.0
      };
    })
  );
  
  // Merge final
  return {
    concursos: [{
      metadata: structure.metadata,
      fases: structure.fases,
      disciplinas: disciplinasCompletas
    }],
    validacao: this.calculateValidation(disciplinasCompletas),
    metadataProcessamento: {
      dataProcessamento: new Date().toISOString(),
      versaoSchema: '1.0',
      modeloIA: 'claude-sonnet-4-5-20250929',
      strategy: 'hierarchical-chunking'
    }
  };
}
```

**Vantagens:**
- ✅ Cada chamada retorna JSON pequeno (<8K tokens)
- ✅ Processamento paralelo das disciplinas (rápido)
- ✅ Sem risco de truncamento
- ✅ Fallback: se 1 disciplina falhar, outras continuam
- ✅ Custo total similar (múltiplas chamadas pequenas vs 1 grande)

**Desvantagens:**
- ⚠️ Mais complexo de implementar
- ⚠️ Múltiplas chamadas à API (latência)

---

## 🎯 Solução 2: Streaming com Acumulação Incremental

### Estratégia: Parse JSON Incremental

**Conceito:**
Processar o streaming da Claude em tempo real, parseando JSON incrementalmente.

### Implementação

```typescript
import { JSONParser } from '@streamparser/json';

async processWithIncrementalParsing(content: string): Promise<EditalProcessado> {
  const parser = new JSONParser();
  let result: any = null;
  
  const stream = this.anthropic.messages.stream({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 100000, // Máximo possível
    system: systemPrompt,
    messages: [{ role: 'user', content }]
  });

  // Parse incremental
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      try {
        parser.write(chunk.delta.text);
        
        // Verificar se JSON está completo
        const parsed = parser.read();
        if (parsed) {
          result = parsed;
        }
      } catch (err) {
        // Continue acumulando...
      }
    }
  }
  
  return result;
}
```

**Vantagens:**
- ✅ Não depende de tamanho fixo
- ✅ Parse em tempo real
- ✅ Detecta JSON completo automaticamente

**Desvantagens:**
- ⚠️ Ainda sujeito a limites de tokens
- ⚠️ Dependência externa (streamparser)

---

## 🎯 Solução 3: Schema Simplificado + Referências

### Estratégia: Extrair conteúdo detalhado separadamente

**Conceito:**
1. JSON principal: Estrutura + IDs de referência
2. Arquivos separados: Conteúdo detalhado por disciplina

### Implementação

```typescript
// JSON principal (pequeno)
{
  "concursos": [{
    "metadata": {...},
    "disciplinas": [
      {
        "id": "disc_1",
        "nome": "Direito Civil",
        "numeroQuestoes": 10,
        "materiasRef": "disc_1_materias.json" // Arquivo separado
      }
    ]
  }]
}

// disc_1_materias.json (arquivo separado)
{
  "disciplina_id": "disc_1",
  "materias": [
    {
      "nome": "Lei de Introdução às Normas",
      "subtopicos": [...]
    }
  ]
}
```

**Vantagens:**
- ✅ JSON principal sempre pequeno
- ✅ Escalável infinitamente
- ✅ Fácil de debugar (arquivos separados)
- ✅ Permite processamento parcial

**Desvantagens:**
- ⚠️ Precisa gerenciar múltiplos arquivos
- ⚠️ Merge necessário antes de inserir no banco

---

## 🎯 Solução 4: Prompt Engineering - Conteúdo Compacto

### Estratégia: Instruir a IA a retornar JSON compacto

**Conceito:**
Modificar o prompt para retornar JSON mais enxuto.

### Implementação

```typescript
const compactPrompt = `
# COMPACT JSON MODE - CRITICAL

Return the most COMPACT JSON possible:

1. **Abbreviate when possible:**
   - ✅ "subtp" instead of "subtopicos"
   - ✅ "leg" instead of "legislacoes"
   - ✅ "obs" instead of "observacoes"

2. **Minimize text:**
   - ✅ Use abbreviations in subtopics
   - ✅ Remove redundant information
   - ✅ Use short field names

3. **Example COMPACT format:**
{
  "conc": [{ // concursos
    "meta": {...}, // metadata
    "disc": [ // disciplinas
      {
        "n": "Dir. Civil", // nome (abreviado)
        "q": 10, // numeroQuestoes
        "mat": [ // materias
          {
            "n": "LINDB", // nome abreviado
            "subtp": ["Princ. gerais", "Fontes"], // compacto
            "leg": [{"t":"lei","num":"12376","ano":"2010"}]
          }
        ]
      }
    ]
  }]
}

4. **Then expand in code:**
We'll expand abbreviations back to full schema in application code.
`;

// Depois expandir no código
function expandCompactJSON(compact: any): EditalProcessado {
  return {
    concursos: compact.conc.map(c => ({
      metadata: c.meta,
      fases: c.fases,
      disciplinas: c.disc.map(d => ({
        nome: d.n,
        numeroQuestoes: d.q,
        peso: d.p || 1.0,
        materias: d.mat.map(m => ({
          nome: m.n,
          ordem: m.o,
          subtopicos: m.subtp || [],
          legislacoes: m.leg || []
        }))
      }))
    })),
    validacao: {...},
    metadataProcessamento: {...}
  };
}
```

**Vantagens:**
- ✅ Reduz tamanho do JSON em 30-50%
- ✅ Simples de implementar
- ✅ Uma única chamada

**Desvantagens:**
- ⚠️ Ainda tem limite (pode não ser suficiente)
- ⚠️ Código de expansão necessário

---

## 🎯 Solução 5: Hybrid - Estrutura + Detalhes Opcionais

### Estratégia: Dois níveis de detalhe

**Conceito:**
1. Modo BÁSICO: Só disciplinas + questões (sempre sucesso)
2. Modo DETALHADO: Conteúdo completo (best effort)

### Implementação

```typescript
interface EditalConfig {
  mode: 'basic' | 'detailed';
  fallbackToBasic: boolean;
}

async processWithFallback(
  content: string, 
  config: EditalConfig
): Promise<EditalProcessado> {
  
  if (config.mode === 'basic') {
    // Garantido: estrutura básica
    return await this.extractBasicStructure(content);
  }
  
  try {
    // Tentar modo detalhado
    return await this.extractDetailedContent(content);
  } catch (error) {
    if (config.fallbackToBasic) {
      logger.warn('Detailed extraction failed, falling back to basic', { error });
      return await this.extractBasicStructure(content);
    }
    throw error;
  }
}

async extractBasicStructure(content: string): Promise<EditalProcessado> {
  // Prompt minimalista - SEMPRE sucede
  const prompt = `Extract ONLY: exam name, subjects, question counts. No details.`;
  
  const response = await this.anthropic.messages.create({
    max_tokens: 4000,
    system: prompt,
    messages: [{ role: 'user', content }]
  });
  
  // Retorna estrutura mínima mas funcional
}
```

**Vantagens:**
- ✅ Sempre retorna algo utilizável
- ✅ Graceful degradation
- ✅ Flexível por edital

**Desvantagens:**
- ⚠️ Pode perder detalhes em fallback

---

## 🏆 RECOMENDAÇÃO PARA SEU CASO

### Solução Híbrida: **Chunking Hierárquico (Solução 1)** + **Fallback Básico (Solução 5)**

```typescript
// edital-process.service.ts

export class EditalProcessService {
  
  async processEdital(
    content: string, 
    strategy: 'full' | 'chunked' = 'chunked'
  ): Promise<EditalProcessado> {
    
    if (strategy === 'full') {
      // Tentativa única (atual)
      try {
        return await this.processWithClaude(content);
      } catch (error) {
        logger.warn('Full extraction failed, switching to chunked', { error });
        // Fallback automático para chunked
        return await this.processWithChunking(content);
      }
    }
    
    // Estratégia chunked (recomendada)
    return await this.processWithChunking(content);
  }
  
  private async processWithChunking(content: string): Promise<EditalProcessado> {
    // 1. Extrair estrutura (rápido, pequeno)
    const structure = await this.extractStructure(content);
    
    // 2. Extrair detalhes por disciplina (paralelo)
    const disciplinasCompletas = await Promise.all(
      structure.disciplinas.map(async (disc) => {
        try {
          const materias = await this.extractDisciplineDetails(content, disc.nome);
          return { ...disc, materias, peso: 1.0 };
        } catch (error) {
          // Fallback: disciplina sem detalhes
          logger.warn(`Failed to extract details for ${disc.nome}`, { error });
          return { 
            ...disc, 
            materias: [{ 
              nome: `${disc.nome} - Conteúdo Geral`, 
              ordem: 1,
              subtopicos: [],
              legislacoes: []
            }],
            peso: 1.0 
          };
        }
      })
    );
    
    return {
      concursos: [{
        metadata: structure.metadata,
        fases: structure.fases,
        disciplinas: disciplinasCompletas
      }],
      validacao: this.calculateValidation(disciplinasCompletas),
      metadataProcessamento: {
        dataProcessamento: new Date().toISOString(),
        versaoSchema: '1.0',
        modeloIA: 'claude-sonnet-4-5-20250929',
        strategy: 'hierarchical-chunking',
        successfulDisciplines: disciplinasCompletas.filter(d => d.materias.length > 1).length,
        totalDisciplines: disciplinasCompletas.length
      }
    };
  }
  
  private async extractStructure(content: string): Promise<any> {
    // Prompt minimalista
    const prompt = `Extract ONLY structure: metadata, fases, disciplinas (name + question count only). Max 4K tokens.`;
    
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      temperature: 0,
      system: prompt,
      messages: [{ role: 'user', content }]
    });
    
    return JSON.parse(response.content[0].text);
  }
  
  private async extractDisciplineDetails(
    content: string, 
    disciplineName: string
  ): Promise<Materia[]> {
    const prompt = `Extract topics ONLY for subject: "${disciplineName}". Ignore other subjects. Max 8K tokens.`;
    
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      temperature: 0,
      system: prompt,
      messages: [{ role: 'user', content }]
    });
    
    const parsed = JSON.parse(response.content[0].text);
    return parsed.materias || [];
  }
}
```

### Por Que Esta Solução?

1. ✅ **Escalável**: Funciona com editais de qualquer tamanho
2. ✅ **Resiliente**: Fallback automático se uma disciplina falhar
3. ✅ **Eficiente**: Paralelização das requisições
4. ✅ **Custo**: Similar ao atual (N disciplinas × 8K ≈ 1 × 64K)
5. ✅ **Debugável**: Logs por disciplina
6. ✅ **Graceful**: Sempre retorna algo utilizável

### Métricas de Sucesso

```typescript
{
  "metadataProcessamento": {
    "strategy": "hierarchical-chunking",
    "totalDisciplines": 14,
    "successfulDisciplines": 13, // Com detalhes completos
    "fallbackDisciplines": 1,    // Só estrutura básica
    "totalAPICalls": 15,          // 1 estrutura + 14 disciplinas
    "totalCost": "$0.XX",
    "processingTime": "45s"       // Muito mais rápido que 8min
  }
}
```

---

## 📊 Comparação das Soluções

| Solução | Escalabilidade | Complexidade | Resiliência | Custo | Recomendação |
|---------|---------------|--------------|-------------|-------|--------------|
| 1. Chunking Hierárquico | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | **🏆 MELHOR** |
| 2. Streaming Incremental | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | Boa |
| 3. Schema + Refs | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Boa |
| 4. JSON Compacto | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | Simples mas limitada |
| 5. Fallback Básico | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Complementar |

---

## 🚀 Implementação Sugerida

**Fase 1 (Imediato):**
- Implementar Chunking Hierárquico (Solução 1)
- Testar com Edital Juiz SC
- Validar qualidade

**Fase 2 (Otimização):**
- Adicionar cache de estruturas extraídas
- Paralelização com rate limiting
- Métricas detalhadas

**Fase 3 (Escalabilidade):**
- Queue system para processamento batch
- Retry logic inteligente
- Monitoramento de custos

Quer que eu implemente a Solução 1 (Chunking Hierárquico) agora?
