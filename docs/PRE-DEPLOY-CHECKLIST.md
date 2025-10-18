# 🔍 PRE-DEPLOY CHECKLIST - Estratégia Adaptativa

**Data:** 17 de Outubro de 2025  
**Versão:** 1.0  
**Status:** 🔴 EM REVISÃO CRÍTICA

---

## 📋 CHECKLIST DE IMPLEMENTAÇÃO

### ✅ 1. Arquivos Modificados

- [x] `src/core/services/editais/edital-process.service.ts` - Métodos adicionados
- [x] `src/core/services/editais/edital-schema.ts` - Schema atualizado
- [x] `test/test-adaptive-strategy.test.ts` - Testes criados
- [x] Documentação criada

---

## 🚨 ANÁLISE CRÍTICA: O QUE PODE FALHAR?

### ⚠️ 1. DETECÇÃO DE TRUNCAMENTO

**Código atual:**
```typescript
private isTruncationError(error: any): boolean {
  const msg = error?.message?.toLowerCase() || '';
  return (
    msg.includes('socket') ||
    msg.includes('truncat') ||
    msg.includes('incomplete') ||
    msg.includes('connection closed') ||
    msg.includes('timeout')
  );
}
```

**❌ PROBLEMA POTENCIAL:**
- E se Claude retornar JSON incompleto SEM lançar erro?
- E se o erro for diferente (ex: "max_tokens exceeded")?
- E se a conexão cair por outro motivo (rede instável)?

**✅ SOLUÇÃO:**
1. Adicionar validação do JSON retornado
2. Verificar se `concursos.length > 0` e `disciplinas.length > 0`
3. Detectar JSON truncado (termina sem `}` ou array incompleto)

**🔧 AÇÃO NECESSÁRIA:** Melhorar detecção de truncamento

---

### ⚠️ 2. EXTRAÇÃO DE ESTRUTURA (Pass 1)

**Código atual:**
```typescript
private async extractStructureOnly(content: string): Promise<any>
```

**❌ PROBLEMAS POTENCIAIS:**

1. **Tipo de retorno é `any`** - Sem validação de schema
   - E se faltar campo obrigatório?
   - E se `disciplinas` vier vazio?

2. **JSON pode vir com markdown** - Depende de regex frágil
   ```typescript
   const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
   ```
   - E se Claude não usar code block?
   - E se houver múltiplos code blocks?

3. **Sem retry** - Se falhar, falha tudo
   - E se for erro temporário de API?

**✅ SOLUÇÃO:**
1. Criar schema Zod para estrutura
2. Melhorar parsing de JSON (múltiplas estratégias)
3. Adicionar retry com backoff

**🔧 AÇÃO NECESSÁRIA:** Validar estrutura com Zod

---

### ⚠️ 3. EXTRAÇÃO POR DISCIPLINA (Pass 2)

**Código atual:**
```typescript
private async extractDisciplineDetails(
  fullContent: string,
  disciplina: { nome: string; numeroQuestoes?: number; observacoes?: string },
  currentIndex: number,
  totalCount: number
): Promise<{ nome: string; materias: any[]; ... }>
```

**❌ PROBLEMAS POTENCIAIS:**

1. **Paralelização massiva** - 14 chamadas simultâneas ao Claude
   - E se API limitar rate (429 Too Many Requests)?
   - E se causar timeout no cliente?

2. **Erro em UMA disciplina quebra TUDO** - Promise.all falha se 1 falhar
   ```typescript
   await Promise.all(disciplinas.map(disc => extractDisciplineDetails(...)))
   ```
   - E se apenas 1 disciplina falhar?
   - Perderíamos as outras 13 extrações bem-sucedidas!

3. **Sem cache** - Se reprocessar, faz tudo de novo
   - E se quisermos re-tentar apenas disciplinas que falharam?

4. **Input gigante em TODAS as chamadas** - 200K × 14 = 2.8M chars
   - Custo: $2.10 só de input!
   - E se 80% do texto não é relevante para aquela disciplina?

**✅ SOLUÇÕES:**

1. **Rate limiting:** Adicionar semáforo (max 5 paralelas)
2. **Promise.allSettled:** Não falhar tudo se 1 falhar
3. **Retry por disciplina:** Tentar 3x antes de desistir
4. **Considerar extração de seção:** Se disciplina tem posição conhecida

**🔧 AÇÃO NECESSÁRIA:** Usar `Promise.allSettled` + retry

---

### ⚠️ 4. MERGE PROGRAMÁTICO (Pass 3)

**Código atual:**
```typescript
private mergeStructureAndDetails(structure: any, disciplinasDetalhadas: any[]): EditalProcessado
```

**❌ PROBLEMAS POTENCIAIS:**

1. **Ordem das disciplinas** - E se ordem mudar entre Pass 1 e Pass 2?
   ```typescript
   const disciplinas = disciplinasDetalhadas.map(disc => ({ ... }))
   ```
   - Dependemos de index correto!

2. **Disciplinas duplicadas** - E se Claude retornar mesma disciplina 2x?

3. **Disciplinas faltando** - E se Pass 2 retornar menos disciplinas que Pass 1?

**✅ SOLUÇÕES:**

1. Fazer merge por **nome** (não por index)
2. Detectar duplicatas
3. Avisar se disciplinas faltarem

**🔧 AÇÃO NECESSÁRIA:** Merge por nome, não por index

---

### ⚠️ 5. VALIDAÇÃO DE BLOCOS vs DISCIPLINAS

**Código do teste:**
```typescript
const blockNames = result.concursos[0].disciplinas.filter(d => 
  d.nome.toLowerCase().includes('bloco') || 
  d.nome.toLowerCase().includes('grupo')
);
expect(blockNames.length).toBe(0);
```

**❌ PROBLEMAS POTENCIAIS:**

1. **Falso positivo** - E se disciplina real se chamar "Grupo de Processos Administrativos"?

2. **Outros padrões de blocos** - Podemos ter:
   - "Parte I", "Parte II"
   - "Módulo A", "Módulo B"
   - "Área 1", "Área 2"
   - "Conhecimentos Básicos", "Conhecimentos Específicos"

3. **Blocos em observações** - Isso é OK!
   ```json
   {
     "nome": "Direito Civil",
     "observacoes": "Bloco I" // ✅ Correto
   }
   ```

**✅ SOLUÇÃO:**

Melhorar regex para detectar padrões típicos de blocos:
```typescript
const isBlockPattern = (nome: string) => {
  const patterns = [
    /^bloco\s+[IVX\d]+$/i,           // "Bloco I", "Bloco 1"
    /^grupo\s+[IVX\d]+$/i,           // "Grupo I", "Grupo 1"
    /^parte\s+[IVX\d]+$/i,           // "Parte I"
    /^módulo\s+[A-Z\d]+$/i,          // "Módulo A"
    /^área\s+\d+$/i,                 // "Área 1"
    /^conhecimentos\s+(básicos|gerais|específicos)$/i
  ];
  return patterns.some(p => p.test(nome.trim()));
};
```

**🔧 AÇÃO NECESSÁRIA:** Melhorar validação de blocos

---

### ⚠️ 6. CUSTO EXPLOSIVO

**Cenário pior caso:**

```
Edital com 20 disciplinas, Strategy 1 falha:

Pass 1 (estrutura):
- Input:  50K × $0.003 = $0.15
- Output: 8K × $0.015  = $0.12

Pass 2 (20 disciplinas paralelas):
- Input:  50K × 20 × $0.003 = $3.00  😱
- Output: 8K × 20 × $0.015  = $2.40

TOTAL: $5.67 para UM edital!
```

**❌ PROBLEMA:**
- Se processar 100 editais = $567!
- 80% deles não precisariam de chunking

**✅ SOLUÇÃO:**

Considerar extração por seção (se viável):
```typescript
// Em vez de enviar 200K em cada chamada:
const section = extractRelevantSection(content, disciplina.nome);
// Enviar apenas 20K relevante
```

**⚠️ TRADE-OFF:**
- ✅ Custo: $3.00 → $0.60 (5x menor)
- ❌ Risco: Perder contexto se conteúdo espalhado

**🔧 AÇÃO NECESSÁRIA:** Decidir se otimizar custo ou garantir qualidade

---

### ⚠️ 7. TIMEOUT EM PARALELIZAÇÃO

**Código atual:**
```typescript
const disciplinasDetalhadas = await Promise.all(
  structure.disciplinas.map((disc, idx) => 
    this.extractDisciplineDetails(content, disc, idx + 1, totalDisciplinas)
  )
);
```

**❌ PROBLEMA:**
- 14 chamadas Claude em paralelo
- Cada uma pode levar 30-60s
- Total: ~60s se paralelo, ~840s se sequencial

**E se:**
- Alguma disciplina travar (timeout)?
- API retornar 429 (rate limit)?
- Conexão cair no meio?

**✅ SOLUÇÃO:**

Implementar controle de concorrência:
```typescript
async function parallelWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<any>
): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.allSettled(
      batch.map(fn)
    );
    results.push(...batchResults);
  }
  return results;
}

// Usar:
const results = await parallelWithLimit(
  disciplinas,
  5, // Max 5 paralelas
  (disc) => extractDisciplineDetails(content, disc)
);
```

**🔧 AÇÃO NECESSÁRIA:** Limitar paralelização a 5 simultâneas

---

### ⚠️ 8. SCHEMA VALIDATION

**Código atual:**
```typescript
metadataProcessamento: z.object({
  ...
  strategy: z.enum([
    'full-extraction-single-call',
    'hierarchical-chunking',
  ]).optional(),
  chunking: z.object({
    totalPasses: z.number(),
    disciplinasExtracted: z.number(),
    processingTime: z.number(),
  }).optional(),
}),
```

**❌ PROBLEMA:**

Se `strategy = 'hierarchical-chunking'` mas `chunking` é `undefined`?

**✅ SOLUÇÃO:**

Validação condicional:
```typescript
.refine(
  (data) => {
    if (data.strategy === 'hierarchical-chunking') {
      return data.chunking !== undefined;
    }
    return true;
  },
  'chunking é obrigatório quando strategy é hierarchical-chunking'
)
```

**🔧 AÇÃO NECESSÁRIA:** Adicionar refinement ao schema

---

### ⚠️ 9. LOGGING EXCESSIVO

**Problema:**
- Logs demais podem poluir output
- Logs com conteúdo sensível?

**Atual:**
```typescript
logger.info(`[DISCIPLINE] 📖 [${currentIndex}/${totalCount}] Extracting: ${disciplina.nome}`);
```

**✅ Está OK**, mas cuidado com:
- Não logar conteúdo completo do edital
- Não logar API keys
- Não logar dados sensíveis do usuário

---

### ⚠️ 10. ROLLBACK STRATEGY

**❌ PROBLEMA CRÍTICO:**

E se a nova implementação quebrar em produção?

**Plano de rollback:**

1. **Manter método antigo:**
   ```typescript
   // Renomear, não deletar
   private async processWithClaudeLegacy(content: string): Promise<EditalProcessado>
   ```

2. **Feature flag:**
   ```typescript
   const USE_ADAPTIVE_STRATEGY = process.env.USE_ADAPTIVE_STRATEGY === 'true';
   
   if (USE_ADAPTIVE_STRATEGY) {
     return await this.processEditalAdaptive(content);
   } else {
     return await this.processWithClaudeLegacy(content);
   }
   ```

3. **Comparação A/B:**
   - Processar com ambas estratégias
   - Comparar resultados
   - Logar diferenças

**🔧 AÇÃO NECESSÁRIA:** Adicionar feature flag

---

## 🎯 PRIORIDADES DE CORREÇÃO

### 🔴 CRÍTICO (Deve corrigir ANTES de testar):

1. ✅ **Promise.allSettled** em vez de Promise.all
2. ✅ **Merge por nome** em vez de index
3. ✅ **Validação de estrutura** com schema Zod
4. ✅ **Melhorar detecção de truncamento**

### 🟡 IMPORTANTE (Corrigir antes de produção):

5. ⚠️ **Limitar paralelização** (max 5 simultâneas)
6. ⚠️ **Retry por disciplina** (3 tentativas)
7. ⚠️ **Feature flag** para rollback
8. ⚠️ **Validação condicional** do schema

### 🟢 NICE TO HAVE (Otimizações futuras):

9. 💡 **Extração por seção** (reduzir custo)
10. 💡 **Cache de disciplinas** (reprocessamento)
11. 💡 **Melhor validação de blocos** (regex avançado)

---

## 🔧 CORREÇÕES A IMPLEMENTAR AGORA

### 1. Promise.allSettled

```typescript
// ❌ ANTES:
const disciplinasDetalhadas = await Promise.all(
  structure.disciplinas.map((disc, idx) => 
    this.extractDisciplineDetails(content, disc, idx + 1, totalDisciplinas)
  )
);

// ✅ DEPOIS:
const results = await Promise.allSettled(
  structure.disciplinas.map((disc, idx) => 
    this.extractDisciplineDetails(content, disc, idx + 1, totalDisciplinas)
  )
);

const disciplinasDetalhadas = results
  .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
  .map(r => r.value);

const failures = results
  .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  .map(r => r.reason);

if (failures.length > 0) {
  logger.warn(`[CHUNKING] ⚠️  ${failures.length} disciplinas falharam`, {
    failures: failures.map(f => f.message),
  });
}
```

### 2. Merge por Nome

```typescript
// ✅ Merge seguro por nome
const disciplinasMap = new Map(
  disciplinasDetalhadas.map(d => [d.nome, d])
);

const disciplinas = structure.disciplinas.map(structDisc => {
  const details = disciplinasMap.get(structDisc.nome);
  if (!details) {
    logger.warn(`[MERGE] ⚠️  Disciplina sem detalhes: ${structDisc.nome}`);
    return {
      nome: structDisc.nome,
      materias: [],
      numeroQuestoes: structDisc.numeroQuestoes || 0,
      peso: 1.0,
      observacoes: 'Detalhes não extraídos',
    };
  }
  return details;
});
```

### 3. Schema de Estrutura

```typescript
const StructureSchema = z.object({
  metadata: z.object({
    examName: z.string().min(1),
    examOrg: z.string().min(1),
    cargo: z.string().optional(),
    area: z.string().optional(),
    startDate: z.string().nullable(),
    examTurn: z.enum(['manha', 'tarde', 'noite', 'integral', 'nao_especificado']),
    totalQuestions: z.number().min(1),
    notes: z.string().optional(),
  }),
  fases: z.array(FaseSchema),
  disciplinas: z.array(z.object({
    nome: z.string().min(1),
    numeroQuestoes: z.number(),
    peso: z.number(),
    observacoes: z.string().optional(),
  })).min(1, 'Deve haver ao menos 1 disciplina'),
});

// Validar no extractStructureOnly:
const parsed = JSON.parse(cleaned);
const validated = StructureSchema.parse(parsed); // 🔥 Vai falhar se inválido
return validated;
```

### 4. Melhor Detecção de Truncamento

```typescript
private isTruncationError(error: any): boolean {
  // Checar mensagem de erro
  const msg = error?.message?.toLowerCase() || '';
  const hasErrorMsg = 
    msg.includes('socket') ||
    msg.includes('truncat') ||
    msg.includes('incomplete') ||
    msg.includes('connection closed') ||
    msg.includes('timeout') ||
    msg.includes('max_tokens');
  
  // Checar se JSON está incompleto
  const responseText = error?.responseText || '';
  const isIncompleteJSON = 
    responseText.length > 0 && 
    !responseText.trim().endsWith('}');
  
  return hasErrorMsg || isIncompleteJSON;
}

// Melhorar catch no processEditalAdaptive:
} catch (error) {
  // Checar se resultado é válido mas truncado
  if (this.isTruncationError(error)) {
    logger.warn('[ADAPTIVE] ⚠️  Truncation detected, switching to chunking');
    return await this.processWithHierarchicalChunking(content);
  }
  
  // Checar se retornou estrutura mas incompleta
  if (error?.partialResult?.concursos?.length > 0) {
    const partial = error.partialResult;
    if (partial.validacao.totalDisciplinas < 5) { // Muito pouco
      logger.warn('[ADAPTIVE] ⚠️  Partial result too small, retrying with chunking');
      return await this.processWithHierarchicalChunking(content);
    }
  }
  
  throw error;
}
```

---

## ✅ CHECKLIST FINAL

Antes de rodar teste com dados reais:

- [ ] Implementar Promise.allSettled
- [ ] Implementar merge por nome
- [ ] Criar schema de validação para estrutura
- [ ] Melhorar detecção de truncamento
- [ ] Adicionar retry por disciplina (3x)
- [ ] Limitar paralelização (max 5)
- [ ] Adicionar logging de falhas
- [ ] Testar com 1 edital pequeno primeiro
- [ ] Testar com 1 edital grande (Juiz SC)
- [ ] Comparar com resultado antigo
- [ ] Validar número de disciplinas >= 8
- [ ] Validar que não há blocos como disciplinas
- [ ] Verificar custo final
- [ ] Documentar diferenças

---

## 🚀 PLANO DE TESTE

1. **Teste unitário:** Métodos isolados
2. **Teste com edital pequeno:** ENAC (esperado: single call)
3. **Teste com edital grande:** Juiz SC (esperado: chunking)
4. **Teste com todos 7 editais:** Reprocessamento completo
5. **Comparação A/B:** Novo vs antigo
6. **Teste e2e:** Inserção no banco de dados

---

## 📝 NOTAS

**Auto-questionamento:**

1. ❓ **O que acontece se Claude mudar formato de resposta?**
   - Resposta: Regex de parsing quebra → Precisa fallback

2. ❓ **O que acontece se API subir preço?**
   - Resposta: Custo explode → Precisa monitoramento

3. ❓ **O que acontece se edital tiver 50 disciplinas?**
   - Resposta: 50 chamadas paralelas → Precisa limit

4. ❓ **O que acontece se usuário cancelar processamento?**
   - Resposta: Processos órfãos → Precisa cleanup

5. ❓ **O que acontece se disco encher?**
   - Resposta: Falha ao salvar JSON → Precisa validação

---

**Conclusão:** Implementação tem potencial, mas precisa de **4 correções críticas** antes de testar com dados reais.

