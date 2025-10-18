# 🔧 Correção da Heurística - Análise Correta

## ❌ ERRO NA MINHA LÓGICA ANTERIOR

### O que eu disse (ERRADO):
```typescript
// Heurística: Se > 150K chars, pular direto para chunking
const isLarge = content.length > 150000;

if (!isLarge) {
  try {
    return await this.processSingle(content);
  } catch (err) { ... }
}
```

### Por que está ERRADO:

**Meu erro de raciocínio:**
- ❌ Assumi que INPUT grande = OUTPUT grande
- ❌ Criei heurística baseada em tamanho de INPUT
- ❌ Ignorei que INPUT 200K é PERFEITAMENTE suportado

**Realidade:**
- ✅ Claude Sonnet 4.5 suporta **200K INPUT** tranquilamente
- ✅ O problema é **OUTPUT** grande (>64K tokens)
- ✅ INPUT 200K pode gerar OUTPUT de 4K (estrutura) ou 100K (completo)

---

## ✅ CORREÇÃO: Heurística baseada em OUTPUT esperado

### Lógica Correta:

```typescript
async processEdital(content: string): Promise<EditalProcessado> {
  // ✅ SEMPRE tenta 1 chamada primeiro
  // Input 200K não é problema, problema é OUTPUT grande
  try {
    logger.info('Strategy: Attempting full extraction (single call)');
    return await this.processWithClaude(content, { 
      maxTokens: 64000  // Deixa alto, só paga se usar
    });
  } catch (error) {
    if (this.isTruncationError(error)) {
      logger.warn('Full extraction truncated, switching to chunking');
      return await this.processChunked(content);
    }
    throw error; // Outro tipo de erro
  }
}
```

**Por que essa lógica é correta:**
1. ✅ INPUT 200K é suportado (sempre envia completo)
2. ✅ Se OUTPUT cabe em 64K → sucesso e barato ($2-3)
3. ✅ Se OUTPUT trunca → fallback automático para chunking
4. ✅ Sem heurística arbitrária (150K não faz sentido)

---

## 📊 Análise de Custo Real

### Cenário 1: Edital "Normal" (maioria dos casos)

**Input:** 150K chars (~40K tokens)
**Output esperado:** 20K tokens (cabe em 64K)

```
Custo tentativa única:
- Input:  40K tokens × $0.003 = $0.12
- Output: 20K tokens × $0.015 = $0.30
- TOTAL: $0.42 ✅ SUCESSO
```

### Cenário 2: Edital "Grande" (Juiz SC)

**Input:** 200K chars (~50K tokens)
**Output esperado:** 100K tokens (NÃO cabe em 64K)

**Tentativa 1 (falha):**
```
- Input:  50K tokens × $0.003 = $0.15
- Output: 64K tokens × $0.015 = $0.96 (truncado)
- TOTAL: $1.11 ❌ TRUNCADO
```

**Tentativa 2 (chunking):**
```
Pass 1 (estrutura):
- Input:  50K tokens × $0.003 = $0.15
- Output: 4K tokens × $0.015  = $0.06

Pass 2-15 (14 disciplinas em paralelo):
- Input:  50K × 14 × $0.003 = $2.10
- Output: 8K × 14 × $0.015  = $1.68

TOTAL CHUNKING: $3.99
```

**Custo total Cenário 2:** $1.11 (tentativa) + $3.99 (chunking) = **$5.10**

---

## 🎯 Sobre maxTokens no Agent 1

### Você está CORRETO:

```typescript
async extractStructure(content: string): Promise<Structure> {
  return await this.callClaude(content, {
    maxTokens: 64000,  // ✅ Deixa alto
    systemPrompt: `Extract ONLY structure: metadata, phases, disciplines list.
                   Do NOT include "materias" details. Keep output minimal.`
  });
}
```

**Por que 64K e não 4K?**

1. ✅ **Você só paga pelo que usar**
   - Se output for 4K → cobra $0.06
   - Se output for 10K → cobra $0.15
   - maxTokens é limite, não cobrança

2. ✅ **Segurança contra variação**
   - Edital com 20 disciplinas → output 8K
   - Edital com 50 disciplinas → output 12K
   - Se colocar maxTokens=4K → pode truncar desnecessariamente

3. ✅ **Prompt controla o tamanho**
   - Instruções claras: "ONLY structure, NO materias"
   - IA vai gerar ~4K mesmo com limite de 64K

---

## 💡 IMPLEMENTAÇÃO CORRETA

```typescript
export class EditalProcessService {
  
  /**
   * Estratégia adaptativa: Tenta full extraction primeiro,
   * fallback automático para chunking se necessário
   */
  async processEdital(content: string): Promise<EditalProcessado> {
    try {
      logger.info('🎯 Strategy: Full extraction (single call)');
      return await this.processSingleCall(content);
      
    } catch (error) {
      if (this.isTruncationError(error)) {
        logger.warn('⚠️  Full extraction truncated, switching to hierarchical chunking');
        return await this.processChunked(content);
      }
      throw error;
    }
  }

  /**
   * Tentativa de extração completa em uma chamada
   */
  private async processSingleCall(content: string): Promise<EditalProcessado> {
    const response = await this.callClaude(content, {
      maxTokens: 64000,  // ✅ Alto, mas só paga se usar
      systemPrompt: this.getFullExtractionPrompt(),
      temperature: 0
    });
    
    return this.parseAndValidate(response);
  }

  /**
   * Extração em múltiplos passes (fallback)
   */
  private async processChunked(content: string): Promise<EditalProcessado> {
    // Pass 1: Estrutura básica
    logger.info('📋 Pass 1/2: Extracting structure');
    const structure = await this.extractStructure(content);
    
    // Pass 2: Disciplinas em paralelo
    logger.info(`📚 Pass 2/2: Extracting ${structure.disciplinas.length} disciplines in parallel`);
    const disciplinasDetalhadas = await Promise.all(
      structure.disciplinas.map((disc, idx) => 
        this.extractDisciplineDetails(content, disc, idx + 1, structure.disciplinas.length)
      )
    );
    
    // Merge programático
    return this.mergeProgrammatically(structure, disciplinasDetalhadas);
  }

  /**
   * Pass 1: Extrai APENAS estrutura (metadata + disciplinas sem matérias)
   */
  private async extractStructure(content: string): Promise<Structure> {
    const response = await this.callClaude(content, {
      maxTokens: 64000,  // ✅ Alto para segurança, mas output esperado ~4-8K
      systemPrompt: `You are an expert at extracting structure from Brazilian exam editals.

Extract ONLY the following:
1. Metadata (exam name, institution, year, etc.)
2. Phases (if multiple phases exist)
3. Disciplines list (names only, NO "materias" details)

CRITICAL: Do NOT include "materias" array. Just discipline names and basic info.

Return minimal JSON:
{
  "metadata": {...},
  "fases": [...],
  "disciplinas": [
    {"nome": "Direito Civil", "descricao": "brief description"},
    {"nome": "Direito Penal", "descricao": "brief description"}
  ]
}`,
      temperature: 0
    });
    
    const parsed = JSON.parse(response);
    logger.info(`✅ Structure extracted: ${parsed.disciplinas.length} disciplines found`);
    
    return parsed;
  }

  /**
   * Pass 2: Extrai detalhes de UMA disciplina (matérias + subtópicos)
   */
  private async extractDisciplineDetails(
    content: string,
    disciplina: { nome: string; descricao?: string },
    currentIndex: number,
    totalCount: number
  ): Promise<Materia[]> {
    
    logger.info(`  📖 [${currentIndex}/${totalCount}] Extracting: ${disciplina.nome}`);
    
    const response = await this.callClaude(content, {
      maxTokens: 64000,  // ✅ Alto para disciplinas complexas
      systemPrompt: `You are extracting detailed content for a specific discipline from a Brazilian exam edital.

**Target Discipline:** "${disciplina.nome}"

Extract ONLY the "materias" (subjects) for this discipline, including:
1. Materia name
2. Sub-topics (if any)
3. Legislation references
4. Bibliografia (if any)

Return JSON array:
[
  {
    "nome": "Materia name",
    "subtopicos": ["topic 1", "topic 2"],
    "legislacao": ["Lei X", "Lei Y"],
    "bibliografia": ["Book A", "Book B"]
  }
]

IMPORTANT: Extract ONLY for "${disciplina.nome}". Ignore other disciplines.`,
      temperature: 0,
      userMessage: content
    });
    
    const materias = JSON.parse(response);
    logger.info(`  ✅ [${currentIndex}/${totalCount}] ${disciplina.nome}: ${materias.length} matérias extracted`);
    
    return materias;
  }

  /**
   * Merge programático (não usa IA)
   */
  private mergeProgrammatically(
    structure: Structure,
    disciplinasDetalhadas: Materia[][]
  ): EditalProcessado {
    
    const disciplinas = structure.disciplinas.map((disc, idx) => ({
      nome: disc.nome,
      descricao: disc.descricao || '',
      materias: disciplinasDetalhadas[idx],
      peso: 1.0,
      quantidadeQuestoes: 0 // Calculado depois
    }));
    
    return {
      concursos: [{
        metadata: structure.metadata,
        fases: structure.fases || [],
        disciplinas
      }],
      validacao: this.calculateValidation(disciplinas),
      metadataProcessamento: {
        dataProcessamento: new Date().toISOString(),
        versaoSchema: '1.0',
        modeloIA: 'claude-sonnet-4-5-20250929',
        strategy: 'adaptive-hierarchical-chunking',
        totalDisciplinas: disciplinas.length,
        totalMaterias: disciplinas.reduce((acc, d) => acc + d.materias.length, 0)
      }
    };
  }

  private isTruncationError(error: any): boolean {
    const msg = error?.message?.toLowerCase() || '';
    return msg.includes('socket') || 
           msg.includes('truncat') || 
           msg.includes('incomplete') ||
           msg.includes('connection closed');
  }
}
```

---

## 📊 COMPARAÇÃO FINAL (CORRIGIDA)

| Estratégia | Lógica de Decisão | maxTokens Agent 1 | Custo Médio | Recomendação |
|-----------|-------------------|-------------------|-------------|--------------|
| **Minha anterior** | Heurística 150K chars | 4K (rígido) | $2-10 | ❌ Lógica falha |
| **Corrigida (sua sugestão)** | Sempre tenta full first | 64K (flexível) | $0.42-$5 | ✅ **CORRETO** |

---

## ✅ CONCLUSÃO

Você estava **100% CORRETO** em questionar:

1. ✅ **150K chars não faz sentido** como heurística
   - INPUT aguenta 200K tranquilo
   - Problema é OUTPUT, não INPUT

2. ✅ **maxTokens deve ser alto** (32K ou 64K)
   - Só paga pelo que usar
   - Evita truncamento desnecessário
   - Prompt controla tamanho real do output

3. ✅ **Sempre tentar 1 chamada primeiro**
   - Mais barato para editais normais
   - Fallback automático para grandes

---

## 🎯 PRÓXIMO PASSO

Implementar essa lógica corrigida:
- ✅ Remove heurística de 150K
- ✅ maxTokens = 64000 em todos passes
- ✅ Sempre tenta full extraction first
- ✅ Fallback automático para chunking

Posso implementar agora?
