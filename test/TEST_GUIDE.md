# Guia de Testes - Sistema de Processamento de Editais

## 📋 Visão Geral

Este documento descreve a estratégia de testes para garantir **99.99% de precisão** no processamento de editais de concursos públicos.

## 🎯 Objetivos de Qualidade

### Métricas Alvo

| Métrica | Objetivo | Crítico |
|---------|----------|---------|
| **Precisão de Extração** | ≥ 99% | ✅ |
| **Validação de Schema** | 100% | ✅ |
| **Integridade de Dados** | ≥ 95% | ✅ |
| **Cobertura de Testes** | ≥ 80% | ⚠️ |
| **Taxa de Falha** | < 1% | ✅ |

### Definição de Precisão

```
Precisão = (Dados Corretos / Dados Totais) × 100

Onde "Dados Corretos" inclui:
- Nome do concurso exato
- Organização correta
- Datas no formato YYYY-MM-DD
- Todas as disciplinas identificadas
- Todas as matérias listadas literalmente
- Números de questões corretos
- Legislações com número e ano completos
```

## 🧪 Tipos de Testes

### 1. Testes Unitários (`test/unit/`)

**Arquivo:** `edital-processing.test.ts`

**Objetivo:** Validar componentes individuais sem dependências externas

**Cobertura:**
- ✅ Validação de schema Zod
- ✅ Integridade de dados
- ✅ Extração de legislações
- ✅ Processamento de conteúdo de amostra

**Execução:**
```bash
npx jest test/unit/edital-processing.test.ts
```

### 2. Testes de Integração (`test/integration/`)

**Arquivo:** `edital-processing.test.ts`

**Objetivo:** Validar fluxo completo PDF → Transcrição → Processamento → JSON

**Cobertura:**
- ✅ Extração de texto de PDFs reais
- ✅ Processamento com Claude AI
- ✅ Validação de precisão ≥99%
- ✅ Métricas de performance

**Execução:**
```bash
./test/integration/run-edital-tests.sh
# ou
npx jest test/integration/edital-processing.test.ts --runInBand
```

## 📂 Estrutura de Testes

```
test/
├── unit/
│   └── edital-processing.test.ts        # Testes unitários
├── integration/
│   ├── edital-processing.test.ts        # Testes de integração
│   └── run-edital-tests.sh              # Script executor
└── fixtures/
    └── sample-editais/                  # Samples para unit tests

docs/
└── editais-test/                        # PDFs reais para integration tests
    ├── edital advogado da união.pdf
    ├── edital concurso cartórios rs.pdf
    ├── edital ENAC.pdf
    ├── edital juiz sc.pdf
    ├── edital juiz trf4.pdf
    ├── edital MPRS.pdf
    ├── edital oab.pdf
    └── edital prefeitura.pdf

temp/
└── test-results/                        # Resultados dos testes
    ├── *.json                           # Resultado por edital
    └── _SUMMARY.json                    # Sumário consolidado
```

## ✅ Critérios de Validação

### Validação de Schema (Weight: 50%)

```typescript
EditalProcessadoSchema.parse(data)
```

**Verifica:**
- ✅ Todos os campos obrigatórios presentes
- ✅ Tipos de dados corretos
- ✅ Formato de datas (YYYY-MM-DD)
- ✅ Enums válidos (turnos, tipos de prova, etc.)

### Validação de Integridade (Weight: 20%)

```typescript
validateEditalIntegrity(edital)
```

**Verifica:**
- ✅ Soma de questões por disciplina = total da prova
- ✅ Todas as disciplinas têm matérias
- ✅ Ordens de matérias sequenciais
- ✅ Datas válidas (não muito antigas)

### Validação de Completude (Weight: 20%)

**Verifica:**
- ✅ Nome do concurso ≥ 10 caracteres
- ✅ Organização presente
- ✅ Pelo menos 1 fase
- ✅ Pelo menos 1 disciplina
- ✅ Cada disciplina tem ≥ 1 matéria

### Validação de Legislação (Weight: 10%)

**Verifica:**
- ✅ Formato: tipo, número, ano, nome
- ✅ Ano com 4 dígitos
- ✅ Número presente

## 📊 Sistema de Pontuação

```typescript
Score inicial: 100 pontos

Penalidades:
- Schema inválido: -50 pontos
- Erro de integridade: -20 pontos
- Disciplina sem matérias: -5 pontos
- Nome do concurso inválido: -5 pontos
- Organização faltando: -5 pontos
- Data inválida: -5 pontos
- Nenhuma fase: -10 pontos
- Nenhuma disciplina: -20 pontos
- Legislação inválida: -2 pontos cada

Aprovação: Score ≥ 95 pontos
```

## 🎯 Casos de Teste

### Caso 1: Edital Simples
**Arquivo:** `edital oab.pdf`
**Características:**
- 1 concurso
- ~10 disciplinas
- Estrutura clara
- Poucas legislações

**Expectativa:** 99%+ precisão

### Caso 2: Edital Complexo
**Arquivo:** `edital advogado da união.pdf`
**Características:**
- Múltiplas fases
- 15+ disciplinas
- Muitas legislações
- Conteúdo denso

**Expectativa:** 97%+ precisão

### Caso 3: Edital Grande
**Arquivo:** `edital juiz trf4.pdf`
**Características:**
- Conteúdo > 100k caracteres
- Requer chunking
- Estrutura complexa

**Expectativa:** 95%+ precisão

## 📈 Métricas Coletadas

### Por Edital

```json
{
  "name": "edital-name",
  "score": 98.5,
  "passed": true,
  "errors": [],
  "warnings": ["..."],
  "metrics": {
    "totalConcursos": 1,
    "totalDisciplinas": 12,
    "totalQuestoes": 120,
    "totalMaterias": 85,
    "totalLegislacoes": 23,
    "avgMateriasPerDisciplina": 7.08
  },
  "performance": {
    "extractionTime": 45000,
    "processingTime": 38000,
    "totalTime": 83000
  }
}
```

### Sumário Geral

```json
{
  "timestamp": "2025-10-05T10:00:00Z",
  "overall": {
    "testsRun": 8,
    "passed": 8,
    "failed": 0,
    "avgScore": 97.8,
    "totalErrors": 0,
    "avgProcessingTime": 42000
  },
  "details": [...]
}
```

## 🚀 Execução de Testes

### Teste Rápido (Unit Tests)

```bash
# Executa apenas testes unitários (~5 segundos)
npm run test:unit

# ou
npx jest test/unit/
```

### Teste Completo (Integration)

```bash
# Executa testes de integração com PDFs reais (~30-60 minutos)
./test/integration/run-edital-tests.sh

# ou
npm run test:integration
```

### Teste Específico

```bash
# Testa apenas um edital
npx jest test/integration/edital-processing.test.ts -t "edital oab"
```

### Modo Watch (Desenvolvimento)

```bash
npx jest --watch test/unit/
```

## 🔍 Análise de Resultados

### 1. Verificar Score Geral

```bash
cat temp/test-results/_SUMMARY.json | jq '.overall'
```

### 2. Identificar Falhas

```bash
cat temp/test-results/_SUMMARY.json | jq '.details[] | select(.passed == false)'
```

### 3. Ver Detalhes de um Edital

```bash
cat temp/test-results/edital-oab.json | jq '.validation'
```

### 4. Comparar Performance

```bash
cat temp/test-results/*.json | jq -s 'sort_by(.performance.processingTime) | reverse'
```

## 🐛 Debugging

### Logs Detalhados

Os logs incluem:
- ⏱️ Tempo de cada etapa
- 📊 Tamanho do conteúdo
- 🔍 Chunks processados
- ✅ Validações executadas

### Arquivo de Resultado

Cada teste gera um JSON completo:

```typescript
{
  edital: EditalProcessado,    // Dados extraídos
  validation: {                // Resultados da validação
    passed: boolean,
    score: number,
    errors: string[],
    warnings: string[],
    metrics: {...}
  },
  performance: {               // Métricas de performance
    extractionTime: number,
    processingTime: number,
    totalTime: number
  }
}
```

### Inspecionar Falhas

```bash
# Ver todos os erros
jq '.validation.errors' temp/test-results/*.json

# Ver avisos
jq '.validation.warnings' temp/test-results/*.json
```

## 📝 Adicionando Novos Testes

### 1. Adicionar PDF de Teste

```bash
cp seu-edital.pdf docs/editais-test/
```

### 2. Adicionar no Array de Testes

```typescript
// test/integration/edital-processing.test.ts
const testEditais = [
  // ... existing
  'seu-edital.pdf',
];
```

### 3. Executar

```bash
./test/integration/run-edital-tests.sh
```

## 🎯 Próximos Passos

### Melhorias Planejadas

1. [ ] **Testes de Regressão Automáticos**
   - CI/CD com GitHub Actions
   - Execução a cada commit
   - Notificação de falhas

2. [ ] **Benchmarking**
   - Comparar versões do modelo
   - Medir impacto de mudanças no prompt
   - Otimização de performance

3. [ ] **Testes de Stress**
   - Editais > 500k caracteres
   - Múltiplos concursos simultâneos
   - Falhas de rede simuladas

4. [ ] **Validação Humana**
   - Sample aleatório para revisão manual
   - Feedback loop para melhorias
   - Casos edge documentados

## 📚 Referências

- [Jest Documentation](https://jestjs.io/)
- [Zod Documentation](https://zod.dev/)
- [Claude API Best Practices](https://docs.anthropic.com/claude/docs/best-practices)

---

**Última Atualização:** 2025-10-05  
**Versão:** 1.0
