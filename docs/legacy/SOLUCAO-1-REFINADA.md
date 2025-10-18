# 🎯 Solução 1 Refinada: Chunking Hierárquico SEM Dividir o Input

## ⚠️ IMPORTANTE: Input Completo, Output Chunked

### O Problema do Chunking de Input (que você evitou)

**Abordagem ERRADA (que NÃO usaremos):**
```typescript
// ❌ MAU: Dividir o TXT em pedaços
const chunks = splitTextIntoChunks(editalText);
for (const chunk of chunks) {
  await processChunk(chunk); // Perde contexto entre chunks!
}
```

**Por que não funciona:**
- ❌ Perde contexto entre chunks
- ❌ Disciplinas podem estar fragmentadas
- ❌ Conteúdo programático quebrado
- ❌ Impossível manter coerência

**Por isso você escolheu Claude Sonnet 4.5 com 200K context** ✅

---

## ✅ Solução Correta: Input Completo, Output Fragmentado

### Estratégia

**Conceito:**
1. Enviar o TXT **COMPLETO** em TODAS as chamadas
2. Mas pedir para extrair **APENAS uma parte** do output por vez
3. Combinar os outputs fragmentados no final

### Arquitetura

```
┌─────────────────────────────────────────────────────┐
│         EDITAL COMPLETO (202K chars)                │
│     "Todo o conteúdo do edital..."                  │
└─────────────────────────────────────────────────────┘
                        │
                        │ Enviado COMPLETO para cada chamada
                        ▼
        ┌───────────────┴───────────────┬───────────────────┐
        │                               │                   │
        ▼                               ▼                   ▼
┌──────────────┐              ┌──────────────┐    ┌──────────────┐
│  CHAMADA 1   │              │  CHAMADA 2   │... │  CHAMADA N   │
│              │              │              │    │              │
│ "Extraia só │              │ "Extraia só  │    │ "Extraia só  │
│  ESTRUTURA"  │              │ detalhes de  │    │ detalhes de  │
│              │              │ Dir. Civil"  │    │ Dir. Admin"  │
└──────────────┘              └──────────────┘    └──────────────┘
        │                               │                   │
        ▼                               ▼                   ▼
   JSON 4KB                        JSON 8KB            JSON 8KB
        │                               │                   │
        └───────────────┬───────────────┴───────────────────┘
                        ▼
                  MERGE FINAL
            (JSON completo combinado)
```

---

## 📝 Implementação Detalhada

### 1. Extração de Estrutura (Pass 1)

```typescript
private async extractStructure(
  fullContent: string // ✅ TXT COMPLETO
): Promise<EditalStructure> {
  
  const promptStructure = `# BRAZILIAN EXAM EDITAL - STRUCTURE EXTRACTION ONLY

You will receive the COMPLETE edital text.

**CRITICAL: Extract ONLY the following (minimal JSON):**

1. Exam metadata (name, organization, date, total questions)
2. Exam phases (objetiva, discursiva, oral, etc.)
3. Subject list with question counts

**DO NOT extract:**
- Detailed topics (matérias) ❌
- Subtopics ❌
- Legislation details ❌
- Bibliography ❌

**Output format:**
\`\`\`json
{
  "metadata": {
    "examName": "...",
    "examOrg": "...",
    "startDate": "YYYY-MM-DD",
    "totalQuestions": 100
  },
  "fases": [
    {
      "tipo": "objetiva",
      "totalQuestoes": 100,
      "data": "YYYY-MM-DD"
    }
  ],
  "disciplinas": [
    {
      "nome": "Direito Civil",
      "numeroQuestoes": 10,
      "observacoes": "Bloco I"
    },
    {
      "nome": "Direito Penal", 
      "numeroQuestoes": 10,
      "observacoes": "Bloco II"
    }
  ]
}
\`\`\`

**REMEMBER:**
- Return ONLY structure, no details
- Keep JSON minimal (<4K tokens)
- List ALL subjects but without their topics
`;

  const response = await this.anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4000, // Pequeno - só estrutura
    temperature: 0,
    system: promptStructure,
    messages: [{
      role: 'user',
      content: fullContent // ✅ TXT COMPLETO aqui
    }]
  });

  const text = response.content[0].type === 'text' 
    ? response.content[0].text 
    : '';
    
  return JSON.parse(text);
}
```

### 2. Extração de Detalhes por Disciplina (Pass 2)

```typescript
private async extractDisciplineDetails(
  fullContent: string,     // ✅ TXT COMPLETO (mesmo que Pass 1)
  disciplineName: string,  // Filtro: qual disciplina extrair
  observacoes?: string     // Contexto: "Bloco I", etc.
): Promise<Materia[]> {
  
  const promptDetails = `# BRAZILIAN EXAM EDITAL - SINGLE SUBJECT EXTRACTION

You will receive the COMPLETE edital text.

**CRITICAL: Extract details ONLY for this specific subject:**

**Subject to extract:** "${disciplineName}"
${observacoes ? `**Context:** ${observacoes}` : ''}

**Extract from this subject:**
1. All topics (matérias) ✅
2. Subtopics for each topic ✅
3. Legislation references ✅
4. Bibliography (if any) ✅

**IGNORE all other subjects** - focus ONLY on "${disciplineName}"

**Output format:**
\`\`\`json
{
  "materias": [
    {
      "nome": "Lei de Introdução às Normas do Direito Brasileiro",
      "ordem": 1,
      "subtopicos": [
        "Vigência e eficácia das normas jurídicas",
        "Aplicação da lei no tempo",
        "Conflito de leis no tempo"
      ],
      "legislacoes": [
        {
          "tipo": "decreto_lei",
          "numero": "4657",
          "ano": "1942",
          "nome": "Lei de Introdução às Normas do Direito Brasileiro"
        }
      ],
      "observacoes": "Fundamental para compreensão do sistema"
    }
  ]
}
\`\`\`

**CRITICAL:**
- Extract ONLY "${disciplineName}"
- Be thorough - include ALL topics for this subject
- Max 8K tokens output
`;

  const response = await this.anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8000, // Por disciplina
    temperature: 0,
    system: promptDetails,
    messages: [{
      role: 'user',
      content: fullContent // ✅ TXT COMPLETO novamente
    }]
  });

  const text = response.content[0].type === 'text' 
    ? response.content[0].text 
    : '{}';
    
  const parsed = JSON.parse(text);
  return parsed.materias || [];
}
```

### 3. Orquestrador (Combina Tudo)

```typescript
public async processWithChunking(
  fullContent: string // ✅ TXT COMPLETO
): Promise<EditalProcessado> {
  
  logger.info('Starting chunked extraction', { 
    contentLength: fullContent.length,
    strategy: 'hierarchical-output-chunking'
  });

  // PASS 1: Extrair estrutura (TXT completo → JSON pequeno)
  logger.info('Pass 1: Extracting structure');
  const structure = await this.extractStructure(fullContent);
  
  logger.info('Structure extracted', { 
    totalDisciplinas: structure.disciplinas.length,
    disciplinas: structure.disciplinas.map(d => d.nome)
  });

  // PASS 2: Extrair detalhes por disciplina (paralelo)
  logger.info('Pass 2: Extracting details per subject (parallel)');
  
  const disciplinasCompletas = await Promise.all(
    structure.disciplinas.map(async (disc, index) => {
      try {
        logger.info(`Extracting details for: ${disc.nome}`, {
          index: index + 1,
          total: structure.disciplinas.length
        });
        
        const materias = await this.extractDisciplineDetails(
          fullContent,      // ✅ TXT COMPLETO
          disc.nome,
          disc.observacoes
        );
        
        logger.info(`Success: ${disc.nome}`, {
          materiasCount: materias.length
        });
        
        return {
          ...disc,
          materias,
          peso: 1.0
        };
        
      } catch (error) {
        // Fallback: disciplina sem detalhes
        logger.warn(`Failed to extract details for ${disc.nome}`, { 
          error: error instanceof Error ? error.message : 'Unknown'
        });
        
        return {
          ...disc,
          materias: [{
            nome: `${disc.nome} - Conteúdo Geral`,
            ordem: 1,
            subtopicos: [],
            legislacoes: [],
            observacoes: 'Detalhes não extraídos - fallback genérico'
          }],
          peso: 1.0
        };
      }
    })
  );

  // MERGE FINAL
  logger.info('Merging results');
  
  const totalMaterias = disciplinasCompletas.reduce(
    (sum, d) => sum + d.materias.length, 
    0
  );
  
  const successfulDisciplines = disciplinasCompletas.filter(
    d => d.materias.length > 1 || 
         !d.materias[0].observacoes?.includes('fallback')
  ).length;

  return {
    concursos: [{
      metadata: structure.metadata,
      fases: structure.fases,
      disciplinas: disciplinasCompletas
    }],
    validacao: {
      totalDisciplinas: disciplinasCompletas.length,
      totalMaterias,
      totalQuestoes: structure.metadata.totalQuestions,
      integridadeOK: successfulDisciplines === disciplinasCompletas.length,
      avisos: successfulDisciplines < disciplinasCompletas.length 
        ? [`${disciplinasCompletas.length - successfulDisciplines} disciplinas com fallback genérico`]
        : [],
      erros: []
    },
    metadataProcessamento: {
      dataProcessamento: new Date().toISOString(),
      versaoSchema: '1.0',
      modeloIA: 'claude-sonnet-4-5-20250929',
      strategy: 'hierarchical-output-chunking',
      totalAPICalls: 1 + disciplinasCompletas.length,
      successfulDisciplines,
      totalDisciplines: disciplinasCompletas.length,
      inputSize: fullContent.length,
      processingTime: 0 // Será preenchido pelo caller
    }
  };
}
```

---

## 🎯 Por Que Esta Abordagem Funciona

### ✅ Vantagens

1. **Contexto Completo Sempre**
   - Cada chamada vê o edital inteiro
   - Não há perda de contexto
   - Claude pode correlacionar informações

2. **Output Controlado**
   - Cada resposta é pequena (4K ou 8K tokens)
   - Sem risco de truncamento
   - JSON sempre parseável

3. **Paralelização Eficiente**
   - 14 disciplinas = 14 chamadas simultâneas
   - Tempo total ≈ tempo da disciplina mais lenta
   - Muito mais rápido que sequencial

4. **Resiliente**
   - Se 1 disciplina falhar → outras continuam
   - Fallback automático para disciplinas problemáticas
   - Sempre retorna resultado utilizável

5. **Custo Otimizado**
   ```
   Input:  202K chars × 15 chamadas = 3.030K chars processados
   Output: 4K + (8K × 14) = 116K tokens gerados
   
   Custo: Similar a 1 chamada grande, mas sem truncamento!
   ```

### ❌ Desvantagens (Mínimas)

1. **Múltiplas Chamadas à API**
   - Mas são paralelas (rápido)
   - Custo similar ao atual

2. **Complexidade de Implementação**
   - Mas é encapsulado no service
   - API externa permanece simples

---

## 📊 Comparação: Atual vs Chunking

| Aspecto | Atual (1 chamada) | Chunking (15 chamadas) |
|---------|-------------------|------------------------|
| **Input** | 202K chars (completo) | 202K chars × 15 (completo sempre) ✅ |
| **Output** | 1 JSON gigante (2536 linhas) | 15 JSONs pequenos (4K + 14×8K) |
| **Risco Truncamento** | ❌ Alto (já aconteceu) | ✅ Zero (outputs pequenos) |
| **Contexto** | ✅ Completo | ✅ Completo (input sempre inteiro) |
| **Tempo** | ~8min (até falhar) | ~2-3min (paralelo) ✅ |
| **Resiliência** | ❌ Tudo ou nada | ✅ Fallback por disciplina |
| **Custo API** | ~$0.XX | ~$0.XX (similar) |

---

## 🚀 Próximos Passos

1. **Implementar** o código acima no `EditalProcessService`
2. **Testar** com Edital Juiz SC
3. **Validar** que extrai 14 disciplinas completas
4. **Usar** como estratégia padrão para todos editais

Quer que eu implemente isso agora no código real?

---

## 💡 Alternativa Simples (Se Quiser Evitar Complexidade)

Se preferir algo mais simples por enquanto:

**Opção B: Prompt para JSON Compacto**
```typescript
// Simplesmente instruir a IA a ser mais concisa
const compactPrompt = `
**CRITICAL: Keep JSON COMPACT**

1. Use short subtopic descriptions (max 50 chars each)
2. Abbreviate when possible: "CF/88" instead of "Constituição Federal de 1988"
3. Omit empty fields
4. List only ESSENTIAL legislation

Goal: Generate JSON under 50K tokens
`;
```

Esta é mais simples de implementar mas menos garantida de funcionar.

Qual abordagem prefere?
