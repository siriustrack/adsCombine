# 📚 Estrutura de Editais e Mapeamento para Banco de Dados

## 🎯 Objetivo

Este documento define **com precisão absoluta** como os JSONs de editais são mapeados para o banco de dados Supabase, garantindo que a extração via Claude Sonnet 4.5 seja consistente.

---

## 📦 TIPO 1: Estrutura Simples (Sem Grupos)

### Exemplo: ENAC, OAB

```json
{
  "concursos": [{
    "disciplinas": [
      {
        "nome": "Direito Civil",
        "numeroQuestoes": 20,
        "materias": [
          {
            "nome": "Contratos",
            "subtopicos": ["Compra e venda", "Locação", "Doação"]
          },
          {
            "nome": "Responsabilidade Civil",
            "subtopicos": ["Dano moral", "Dano material"]
          }
        ]
      }
    ]
  }]
}
```

### ✅ Mapeamento para Banco:

| JSON | Banco de Dados | Exemplo |
|------|----------------|---------|
| `disciplinas[].nome` | `disciplines.name` | "Direito Civil" |
| `disciplinas[].numeroQuestoes` | `disciplines.number_of_questions` | 20 |
| `disciplinas[].materias[]` | `topics[]` | ["Contratos", "Responsabilidade Civil"] |
| `disciplinas[].materias[].subtopicos[]` | ❌ **IGNORADO** | (não vai pro banco) |

**Total esperado:**
- ✅ **N disciplines** (mesmo número de `disciplinas[]`)
- ✅ **M topics** (soma de todas as `materias[]`)

---

## 📦 TIPO 2: Estrutura com Grupos (Advogado da União, MPRS, Cartórios RS, TJSC)

### Exemplo: Advogado da União

```json
{
  "concursos": [{
    "disciplinas": [  // ← NÃO SÃO DISCIPLINAS! SÃO GRUPOS!
      {
        "nome": "Grupo I",  // ← GRUPO (apenas categoria, ignorar)
        "numeroQuestoes": 46,  // ← Total do GRUPO (distribuir entre as matérias)
        "materias": [  // ← ESSAS SÃO AS DISCIPLINAS REAIS!
          {
            "nome": "Direito Constitucional",  // ← DISCIPLINE
            "ordem": 1,
            "subtopicos": [  // ← TOPICS
              "História Constitucional do Brasil",
              "Constituição: conceito e classificação",
              "Poder constituinte",
              // ... 11 subtópicos total
            ]
          },
          {
            "nome": "Direito Administrativo",  // ← DISCIPLINE
            "subtopicos": [  // ← TOPICS
              "Atos administrativos",
              "Licitações",
              // ... 10 subtópicos total
            ]
          }
          // ... mais 4 matérias (total 6 no Grupo I)
        ]
      },
      {
        "nome": "Grupo II",
        "numeroQuestoes": 34,
        "materias": [ /* 4 matérias */ ]
      },
      {
        "nome": "Grupo III",
        "numeroQuestoes": 20,
        "materias": [ /* 4 matérias */ ]
      }
    ]
  }],
  "validacao": {
    "totalDisciplinas": 3,      // ← NÚMERO DE GRUPOS (ignorar)
    "totalQuestoes": 100,       // ← TOTAL CORRETO
    "totalMaterias": 14         // ← NÚMERO REAL DE DISCIPLINES (usar!)
  }
}
```

### ✅ Mapeamento para Banco:

| JSON | Banco de Dados | Exemplo |
|------|----------------|---------|
| `disciplinas[].nome` | ❌ **IGNORADO** | "Grupo I" (apenas categoria) |
| `disciplinas[].numeroQuestoes` | ⚙️ **DISTRIBUIR** | 46 ÷ 6 matérias = ~7-8 por discipline |
| `disciplinas[].materias[].nome` | ✅ `disciplines.name` | "Direito Constitucional" |
| `disciplinas[].materias[].subtopicos[]` | ✅ `topics[].name` | "História Constitucional do Brasil" |

**Total esperado (Advogado da União):**
- ✅ **14 disciplines** (6 + 4 + 4 matérias)
- ✅ **~200 topics** (soma de todos os subtópicos)
- ✅ **100 questões** distribuídas proporcionalmente

---

## 🧮 Algoritmo de Distribuição de Questões

### Para editais com GRUPOS:

```typescript
// Exemplo: Grupo I com 46 questões e 6 matérias
const grupo = {
  nome: "Grupo I",
  numeroQuestoes: 46,
  materias: [
    { nome: "Dir. Constitucional", subtopicos: [...] }, // 11 subtópicos
    { nome: "Dir. Administrativo", subtopicos: [...] }, // 10 subtópicos
    { nome: "Dir. Tributário", subtopicos: [...] },     // 6 subtópicos
    { nome: "Legislação AGU", subtopicos: [...] },      // 6 subtópicos
    { nome: "Dir. Financeiro", subtopicos: [...] },     // 6 subtópicos
    { nome: "Dir. Ambiental", subtopicos: [...] }       // 7 subtópicos
  ]
};

// 1. Calcular peso de cada matéria (proporcional ao número de subtópicos)
const totalSubtopicos = grupo.materias.reduce((sum, m) => 
  sum + m.subtopicos.length, 0
); // = 46 subtópicos

// 2. Distribuir questões proporcionalmente
grupo.materias.forEach(materia => {
  const peso = materia.subtopicos.length / totalSubtopicos;
  materia.numeroQuestoes = Math.round(peso * grupo.numeroQuestoes);
});

// 3. Ajustar arredondamento para somar exatamente 46
let soma = grupo.materias.reduce((s, m) => s + m.numeroQuestoes, 0);
if (soma !== grupo.numeroQuestoes) {
  // Ajustar na matéria com mais subtópicos
  const materiaComMaisTopics = grupo.materias.reduce((max, m) => 
    m.subtopicos.length > max.subtopicos.length ? m : max
  );
  materiaComMaisTopics.numeroQuestoes += (grupo.numeroQuestoes - soma);
}
```

### Resultado esperado:

```typescript
[
  { nome: "Dir. Constitucional", numeroQuestoes: 8 },  // 11 subtópicos (mais)
  { nome: "Dir. Administrativo", numeroQuestoes: 8 },  // 10 subtópicos
  { nome: "Dir. Tributário", numeroQuestoes: 8 },      // 6 subtópicos
  { nome: "Legislação AGU", numeroQuestoes: 7 },       // 6 subtópicos
  { nome: "Dir. Financeiro", numeroQuestoes: 8 },      // 6 subtópicos
  { nome: "Dir. Ambiental", numeroQuestoes: 7 }        // 7 subtópicos
]
// TOTAL: 8+8+8+7+8+7 = 46 ✅
```

---

## 🔍 Como Identificar o Tipo de Edital

### Tipo 1 (Simples):
- ✅ `disciplinas[].nome` **NÃO** começa com "Grupo"
- ✅ `disciplinas[].numeroQuestoes` está presente e correto
- ✅ `validacao.totalDisciplinas` == `disciplinas.length`

### Tipo 2 (Com Grupos):
- ✅ `disciplinas[].nome` começa com "Grupo"
- ✅ `validacao.totalDisciplinas` **<** `validacao.totalMaterias`
- ✅ Estrutura aninhada: `disciplinas[] → materias[] → subtopicos[]`

---

## 📊 Exemplos Reais

### ENAC (Tipo 1):
```
Disciplinas: 10
Topics: 100 (matérias)
Subtópicos: Ignorados
```

### Advogado da União (Tipo 2):
```
Grupos: 3 (Grupo I, II, III) → IGNORAR
Disciplines: 14 (matérias)
Topics: ~200 (subtópicos)
Questões: 100 (distribuídas entre as 14 disciplines)
```

### Cartórios RS (Tipo 2):
```
Grupos: 3 blocos
Disciplines: 9 (matérias)
Topics: ~130 (subtópicos)
Questões: Total do edital (distribuir)
```

---

## ⚠️ REGRAS CRÍTICAS

### ❌ NÃO FAZER:
1. ❌ Usar `disciplinas[].nome` como discipline quando começa com "Grupo"
2. ❌ Criar disciplines a partir de grupos
3. ❌ Ignorar a distribuição de questões entre matérias
4. ❌ Usar subtópicos como disciplines

### ✅ FAZER:
1. ✅ Detectar tipo de edital (com ou sem grupos)
2. ✅ Para Tipo 2: `materias[] → disciplines`, `subtopicos[] → topics`
3. ✅ Distribuir `numeroQuestoes` do grupo entre as matérias proporcionalmente
4. ✅ Validar: `soma(disciplines.numberOfQuestions) == totalQuestoes`

---

## 🎯 Prompt para Claude Sonnet 4.5

```
ESTRUTURA DE EDITAIS:

Existem 2 tipos de editais:

TIPO 1 (Simples):
- disciplinas[] → disciplines no banco (com numeroQuestoes direto)
- materias[] → topics no banco
- subtopicos[] → IGNORAR

TIPO 2 (Com Grupos - identificado por disciplinas[].nome começando com "Grupo"):
- disciplinas[] → IGNORAR (são apenas categorias: "Grupo I", "Grupo II")
- disciplinas[].materias[] → disciplines no banco
- disciplinas[].materias[].subtopicos[] → topics no banco
- disciplinas[].numeroQuestoes → DISTRIBUIR entre as matérias proporcionalmente

ALGORITMO DE DISTRIBUIÇÃO (Tipo 2):
1. Contar subtópicos de cada matéria no grupo
2. Calcular peso: subtopicos_materia / total_subtopicos_grupo
3. Distribuir: numeroQuestoes_materia = round(peso * numeroQuestoes_grupo)
4. Ajustar arredondamento para somar exatamente numeroQuestoes_grupo

VALIDAÇÃO:
- Para Tipo 1: disciplines.length == validacao.totalDisciplinas
- Para Tipo 2: disciplines.length == validacao.totalMaterias
- SEMPRE: sum(disciplines.numberOfQuestions) == validacao.totalQuestoes
```

---

## 📝 Changelog

**2025-10-13**: Documentação inicial criada baseada na análise do edital Advogado da União.

---

**Autor**: Sistema de Extração de Editais  
**Versão**: 1.0.0  
**Data**: 2025-10-13
