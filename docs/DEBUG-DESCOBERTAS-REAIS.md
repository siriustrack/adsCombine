# 🔍 DESCOBERTAS REAIS - Debug E2E Produção

**Data:** 15 de Outubro de 2025  
**Teste:** E2E com URL real de produção  
**Status:** ✅ **PROBLEMAS REPRODUZIDOS COM SUCESSO**

---

## 📊 RESUMO EXECUTIVO

Consegui **reproduzir EXATAMENTE** os mesmos erros que ocorrem em produção executando um teste E2E local que:
1. ✅ Busca o mesmo arquivo TXT da produção
2. ✅ Processa com o mesmo serviço
3. ✅ Gera os MESMOS erros

**Resultado:** 20 erros, 26 warnings, 5m 9s de processamento

---

## 🎯 PROBLEMAS CONFIRMADOS

### **1. Data Inválida - `startDate: "a_divulgar"`**

**Problema:**
```json
"startDate": "a_divulgar"
```

**Erro:**
```
Data deve estar no formato YYYY-MM-DD
```

**Análise:**
- Claude está retornando `"a_divulgar"` quando a data não está especificada no edital
- Schema Zod exige: `/^\d{4}-\d{2}-\d{2}$/`
- **ESTE É UM COMPORTAMENTO CORRETO DO CLAUDE** - o edital realmente não tem data específica

**Causa Raiz:**
- O edital diz "data provável estabelecida no cronograma constante do Anexo I"
- Claude interpreta corretamente que não há uma data específica
- Nosso schema está MUITO RÍGIDO

---

### **2. Disciplinas Sem Matérias - Arrays Vazios**

**Problema:**
```json
{
  "nome": "Direito Constitucional",
  "numeroQuestoes": 0,
  "peso": 1.0,
  "materias": [],
  "observacoes": "Grupo I - Número exato de questões não especificado neste chunk"
}
```

**16 disciplinas** com `materias: []`

**Análise:**
- **CAUSA RAIZ ENCONTRADA:** O primeiro chunk (primeiras 80k chars) contém apenas:
  - Informações administrativas do concurso
  - Dados de vagas e inscrição
  - NOMES das disciplinas, MAS NÃO O CONTEÚDO
- O conteúdo detalhado (objetos de avaliação) está no **FINAL do edital**
- Claude está criando a estrutura de disciplinas mas não tem informação sobre matérias **naquele chunk**

**Observação do Claude:**
```
"observacoes": "Grupo I - Número exato de questões não especificado neste chunk"
```

➡️ **Claude SABE que faltam informações!**

---

### **3. Número de Questões Zerado**

**Problema:**
- Todas disciplinas: `numeroQuestoes: 0`
- Soma: 0 questões
- Total esperado: 100 questões

**Análise:**
- Mesma causa do problema #2
- O quadro com distribuição de questões está no chunk 1 ou 2
- Chunk 1 não tem essa informação ainda

---

### **4. Duplicação de Concursos**

**Resultado:**
- Processamento retornou **2 concursos**
- Deveria ser **1 concurso**

**Análise:**
```
Chunk 0: 1 concurso (estrutura básica)
Chunk 1: 1 concurso (mais detalhes)
Chunk 2: 1 concurso (objetos de avaliação)
TOTAL ESPERADO: 1 concurso consolidado
TOTAL RETORNADO: 2 concursos
```

**Causa Raiz:**
- Lógica de merge está INCORRETA
- Chunks estão sendo tratados como concursos independentes
- Não há consolidação adequada

---

## 🔬 ANÁLISE PROFUNDA DO CHUNK 1

### **Conteúdo do Chunk 1 (primeiros 80k chars):**

1. ✅ Título do concurso
2. ✅ Órgão
3. ✅ Cargo
4. ✅ Área
5. ❌ Data específica (diz "a divulgar")
6. ✅ Total de questões (100)
7. ✅ Fases do concurso
8. ✅ **APENAS NOMES** das disciplinas
9. ❌ Conteúdo detalhado das disciplinas
10. ❌ Matérias
11. ❌ Tópicos
12. ❌ Legislações

### **O que está NO FINAL do edital (chunks 2-3):**

```
17 DOS OBJETOS DE AVALIAÇÃO
17.1 DIREITO CONSTITUCIONAL
1. Teoria Geral da Constituição
2. Princípios fundamentais
3. Direitos e garantias individuais
...
```

➡️ **TODO O CONTEÚDO REAL ESTÁ NO ITEM 17, que começa na página 36+**

---

## 💡 DESCOBERTA CRÍTICA

### **POR QUE O TESTE E2E PASSA MAS PRODUÇÃO FALHA?**

**Hipótese Inicial (ERRADA):**
- "E2E usa mock com dados corretos"

**Realidade (DESCOBERTA):**
1. ✅ **NÃO HÁ TESTE E2E REAL** que processe um edital completo com Claude
2. ✅ Testes existentes usam **documentos pequenos** ou **mocks**
3. ✅ Este edital específico (179k chars) **SEMPRE FALHA**, inclusive localmente
4. ✅ O problema **NÃO É DE AMBIENTE**, é de **LÓGICA DO CHUNKING**

---

## 🚨 PROBLEMAS REAIS IDENTIFICADOS

### **Problema 1: Estratégia de Chunking Inadequada**

**Atual:**
```typescript
const CHUNK_SIZE = 60000; // caracteres
// Divide em blocos fixos de 60k
```

**Problema:**
- Corta o conteúdo **sem respeitar estrutura semântica**
- Disciplinas ficam fragmentadas entre chunks
- Informações relacionadas ficam separadas

**Solução Necessária:**
- Analisar o texto ANTES de dividir
- Identificar seções naturais: "ITEM 1", "ITEM 17", etc
- Garantir que conteúdo relacionado fique no mesmo chunk

---

### **Problema 2: Merge de Chunks Incorreto**

**Atual:**
```typescript
// Cada chunk retorna um JSON completo
// Merge simplesmente concatena arrays
```

**Problema:**
- Não há inteligência no merge
- Chunks com o MESMO concurso geram concursos DUPLICADOS
- Não há consolidação de informações parciais

**Solução Necessária:**
- Identificar quando chunks se referem ao mesmo concurso
- Fazer merge inteligente:
  - Se `metadata.examName` for igual → MERGE
  - Se disciplina existir → ENRIQUECER, não duplicar
  - Se matéria existir → adicionar à disciplina correspondente

---

### **Problema 3: Prompt Não Guia Fragmentação**

**Atual:**
```typescript
const prompt = `Extraia as informações deste edital...`;
// Não diz ao Claude que é um CHUNK
// Não diz o que fazer quando informação está incompleta
```

**Problema:**
- Claude não sabe que está processando uma parte
- Tenta criar estrutura completa com informação parcial
- Cria arrays vazios quando não tem dados

**Solução Necessária:**
```typescript
const promptForChunk = `
IMPORTANTE: Você está processando um CHUNK de um edital maior.

REGRAS:
1. Se você NÃO encontrar informações completas sobre matérias de uma disciplina:
   - NÃO crie array vazio
   - Use: "observacoes": "Conteúdo detalhado não encontrado neste chunk"
   - Marque: "dadosIncompletos": true

2. Se você encontrar apenas NOME de disciplina sem detalhes:
   - Crie a estrutura básica
   - Marque: "aguardandoDetalhes": true

3. Se a data não estiver especificada:
   - Use: null (não "a_divulgar")
`;
```

---

### **Problema 4: Schema Zod Muito Rígido**

**Atual:**
```typescript
startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD")
materias: z.array(...).min(1, "Disciplina deve ter ao menos uma matéria")
```

**Problema:**
- Não permite dados parciais
- Não permite `null` quando informação não existe
- Não permite flags de "dados incompletos"

**Solução Necessária:**
```typescript
// Permitir null quando dado não existe
startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()

// Permitir array vazio MAS com flag
materias: z.array(...).default([])
dadosIncompletos: z.boolean().optional()
```

---

## 📋 PLANO DE AÇÃO CORRIGIDO

### **FASE 1: Melhorar Extração de JSON** (30min)
**Problema Atual:** Claude retorna ```json wrappado  
**Status:** ✅ JÁ FUNCIONA (fallback extrai corretamente)  
**Ação:** Melhorar prompt para evitar wrapper

### **FASE 2: Flexibilizar Schema Zod** (1h)
**Problema Atual:** Schema muito rígido  
**Ações:**
1. `startDate`: aceitar `null`
2. `materias`: aceitar array vazio + flag `dadosIncompletos`
3. `numeroQuestoes`: aceitar 0 + flag `aguardandoDistribuicao`
4. Adicionar campo `metadataProcessamento`:
   ```typescript
   metadataProcessamento: {
     chunkOriginario: number,
     dadosCompletos: boolean,
     camposIncompletos: string[]
   }
   ```

### **FASE 3: Melhorar Prompt de Chunking** (1h)
**Ações:**
1. Informar Claude que está processando chunk
2. Dar instruções sobre dados parciais
3. Solicitar flags de completude
4. Exemplo de estrutura esperada

### **FASE 4: Implementar Merge Inteligente** (3h)
**Ações:**
1. Comparar `examName` entre chunks
2. Se igual → merge
3. Enriquecer disciplinas existentes
4. Não duplicar
5. Consolidar flags de completude

### **FASE 5: Rechunking Semântico** (4h - opcional)
**Ações:**
1. Analisar estrutura do texto
2. Identificar seções: ITEM 1, ITEM 17, etc
3. Quebrar em seções lógicas
4. Manter conteúdo relacionado junto

---

## 🎯 IMPACTO ESPERADO

### **Antes (Atual):**
- ❌ 20 erros
- ❌ 26 warnings
- ❌ 2 concursos (duplicado)
- ❌ 16 disciplinas sem matérias
- ❌ Todas disciplinas com 0 questões
- ❌ Dados inválidos para banco

### **Depois (Meta - Fase 2):**
- ✅ 0 erros de schema (dados parciais aceitos)
- ⚠️ Alguns warnings (dados incompletos flagados)
- ✅ 1 concurso
- ⚠️ Disciplinas marcadas como incompletas
- ✅ Dados VÁLIDOS para banco (mesmo que parciais)

### **Depois (Meta - Fase 4):**
- ✅ 0 erros
- ✅ 0 warnings
- ✅ 1 concurso completo
- ✅ Todas disciplinas com matérias
- ✅ Distribuição correta de questões
- ✅ Dados COMPLETOS e válidos

---

## 🔧 PRÓXIMOS PASSOS IMEDIATOS

1. ✅ **DOCUMENTAR descobertas** ← FEITO
2. ⏭️ **Implementar Fase 2** (Schema flexível)
3. ⏭️ **Testar novamente** com mesmo edital
4. ⏭️ **Comparar resultados** antes/depois
5. ⏭️ **Implementar Fase 4** se necessário

---

## 📝 CONCLUSÃO

O problema **NÃO É** de ambiente ou configuração.  
O problema **É** de lógica do chunking e merge.

**Boa notícia:** Problema reproduzível localmente = facilmente debugável  
**Má notícia:** Requer mudanças mais profundas que apenas ajustar prompt

**Prioridade:** Implementar Fase 2 PRIMEIRO (schema flexível) para permitir dados parciais válidos, depois Fase 4 (merge inteligente) para obter dados completos.
