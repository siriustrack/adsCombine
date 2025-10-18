# 🔄 Atualização do Prompt de Extração - Resolução do Problema de Blocos

## Data: 17 de Outubro de 2025

## 🎯 Problema Identificado

A Claude estava extraindo **BLOCOS/GRUPOS organizacionais** como se fossem **DISCIPLINAS REAIS**, resultando em:
- Edital Juiz SC: 3 "disciplinas" (blocos) → Deveria ter 14 disciplinas
- Edital MPRS: 2 "grupos" → Deveria ter 8-10 disciplinas
- Edital Advogado União: 3 "blocos" → Deveria ter 10-12 disciplinas
- Edital OAB: 2 grupos + erro matemático

## ✅ Solução Implementada

### 1. Prompt Reescrito em Inglês Profissional

**Motivo:** Claude Sonnet 4.5 é treinada primariamente em inglês, oferecendo melhor compreensão e seguimento de instruções complexas em inglês.

### 2. Seção Crítica Adicionada: "CRITICAL DISTINCTION: BLOCKS/GROUPS vs ACTUAL SUBJECTS"

**Conteúdo da seção (146 linhas):**

#### ⚠️ Padrões Hierárquicos Identificados
- "Bloco I", "Bloco II", "Bloco III"
- "Grupo 1: Conhecimentos Gerais", "Grupo 2: Conhecimentos Específicos"
- "Parte A", "Parte B"
- "Conhecimentos Básicos", "Conhecimentos Específicos"

#### 🚫 O Que NÃO Fazer
```json
// ❌ ERRADO
{
  "disciplinas": [
    { "nome": "Bloco I", "numeroQuestoes": 40 }
  ]
}
```

#### ✅ O Que Fazer
```json
// ✅ CORRETO
{
  "disciplinas": [
    { "nome": "Direito Civil", "numeroQuestoes": 10, "observacoes": "Block I" },
    { "nome": "Direito Processual Civil", "numeroQuestoes": 10, "observacoes": "Block I" },
    { "nome": "Direito do Consumidor", "numeroQuestoes": 10, "observacoes": "Block I" },
    { "nome": "Direito da Criança e do Adolescente", "numeroQuestoes": 10, "observacoes": "Block I" }
  ]
}
```

#### 📋 Regras Detalhadas de Extração

1. **Identificar nível hierárquico:** Buscar marcadores estruturais
2. **Extrair disciplinas, não containers:** "Bloco I" → NÃO; "Português" → SIM
3. **Distribuição de questões:** Proporcional ou explícita
4. **Usar campo 'observacoes':** Preservar informação de bloco sem corromper extração
5. **Validação:** Se < 5 disciplinas em prova de 100 questões → PROVAVELMENTE ERRADO

#### 🔍 Exemplo Real do Edital Juiz SC

**Texto original:**
```
DISCIPLINAS                    QUESTÕES
Bloco I:                       40
  Direito Civil
  Direito Processual Civil
  Direito do Consumidor
  Direito da Criança e do Adolescente

Bloco II:                      30
  Direito Penal
  Direito Processual Penal
  Direito Constitucional
  Direito Eleitoral
```

**Extração correta (14 disciplinas):**
```json
{
  "disciplinas": [
    { "nome": "Direito Civil", "numeroQuestoes": 0, "observacoes": "Bloco I - 40 questões total" },
    { "nome": "Direito Processual Civil", "numeroQuestoes": 0, "observacoes": "Bloco I" },
    { "nome": "Direito do Consumidor", "numeroQuestoes": 0, "observacoes": "Bloco I" },
    { "nome": "Direito da Criança e do Adolescente", "numeroQuestoes": 0, "observacoes": "Bloco I" },
    { "nome": "Direito Penal", "numeroQuestoes": 0, "observacoes": "Bloco II - 30 questões total" },
    { "nome": "Direito Processual Penal", "numeroQuestoes": 0, "observacoes": "Bloco II" },
    { "nome": "Direito Constitucional", "numeroQuestoes": 0, "observacoes": "Bloco II" },
    { "nome": "Direito Eleitoral", "numeroQuestoes": 0, "observacoes": "Bloco II" }
  ]
}
```

### 3. Validação Final Reforçada

Adicionado checkpoint antes de retornar JSON:
```
Before returning your JSON, ask yourself:
1. Did I extract BLOCKS or SUBJECTS? If answer is "blocks" → WRONG, go back
2. Is the number of subjects realistic? (8-15+ for typical Brazilian exams)
3. Are all subjects actual knowledge areas? (not "Part A", "Group 1", etc.)
4. Did I preserve hierarchy in 'observacoes'? (so information isn't lost)
```

## 📊 Estrutura do Novo Prompt

### Seções (em ordem):

1. **Title & Role Definition** (3 linhas)
2. **Critical Objective** (2 linhas)
3. **⚠️ CRITICAL DISTINCTION: BLOCKS/GROUPS vs ACTUAL SUBJECTS** (146 linhas) ⭐ NOVO
4. **Mandatory Output Format** (JSON schema - 45 linhas)
5. **Critical Extraction Rules** (8 regras detalhadas - 50 linhas)
6. **Output Example** (Exemplo completo - 60 linhas)
7. **Final Instructions** (6 instruções + validação - 10 linhas)

**Total:** ~316 linhas de prompt profissional em inglês

## 🔧 Mudanças Técnicas

### Arquivo: `src/core/services/editais/edital-process.service.ts`

**Método:** `processWithClaude()`

**Mudanças:**
1. ✅ System prompt reescrito em inglês (português → english)
2. ✅ Adicionada seção crítica sobre blocos vs disciplinas (146 linhas)
3. ✅ User message atualizada para inglês com ênfase adicional
4. ✅ Exemplo real do Edital Juiz SC incluído no prompt
5. ✅ Validação final com 4 perguntas de auto-checagem

**Tamanho do prompt:**
- Antes: ~170 linhas (português)
- Depois: ~316 linhas (inglês com seção crítica)

## 🎯 Expectativa de Resultados

### Editais que devem melhorar:

| Edital | Antes | Esperado Depois |
|--------|-------|-----------------|
| Juiz SC | 3 "blocos" | 14 disciplinas reais |
| MPRS | 2 "grupos" | 8-10 disciplinas |
| Advogado União | 3 "blocos" | 10-12 disciplinas |
| OAB | 2 grupos + erro | 8-10 disciplinas corretas |

### Editais que devem manter qualidade:

| Edital | Situação Atual | Expectativa |
|--------|----------------|-------------|
| ENAC | 10 disciplinas ✅ | Manter 10 |
| Cartórios RS | 18 disciplinas ✅ | Validar matérias |
| Prefeitura | 11 disciplinas ✅ | Manter 11 |

## 📋 Próximos Passos

1. ✅ Prompt atualizado com seção crítica
2. ⏳ **TESTAR** com Edital Juiz SC (deve extrair 14 disciplinas)
3. ⏳ Se sucesso → Reprocessar os 4 editais problemáticos
4. ⏳ Comparar resultados old vs new
5. ⏳ Validar integridade e prosseguir para inserção no banco

## 🎓 Lições Aprendidas

### 1. Capacidade Linguística
Claude Sonnet 4.5 tem melhor performance com prompts em **inglês** para tarefas complexas de seguimento de instruções.

### 2. Explicitação de Padrões
AI models precisam de **exemplos explícitos** de padrões hierárquicos comuns em domínios específicos (editais brasileiros).

### 3. Validação Interna
Adicionar **auto-checagem** no próprio prompt aumenta taxa de acerto (ask yourself: did I extract blocks or subjects?).

### 4. Preservação de Contexto
Usar campo `observacoes` para preservar informação de blocos **sem corromper** a extração de disciplinas.

---

**Status:** ✅ Prompt atualizado e pronto para teste  
**Próxima ação:** Testar com edital problemático (Juiz SC)
