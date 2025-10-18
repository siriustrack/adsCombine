# 📋 Planejamento da Fase 5: Testes E2E

**Data:** 13 de Outubro de 2025  
**Status:** 🔄 EM PLANEJAMENTO  
**Objetivo:** Testar fluxo completo do processamento de editais

---

## 🎯 Objetivo Geral

Validar o fluxo **end-to-end** completo desde o JSON extraído até a inserção no banco de dados, garantindo que todos os agentes trabalham em conjunto corretamente.

---

## 🔄 Fluxo E2E Completo

```
📄 EDITAL JSON (input)
    ↓
🤖 IDENTIFIER AGENT (mock - já testado na Fase 3)
    ↓ EditalJSON (hierárquico)
    ↓
🔄 PRE-ORCHESTRATOR (Fase 1 ✅)
    ↓ StudyPlanData (flat)
    ↓
🎯 ORCHESTRATOR AGENT (Fase 4 ✅)
    ↓ Inserções no banco
    ↓ plan_id retornado
    ↓
✅ VERIFIER AGENT (Fase 2 ✅)
    ↓ Validação de contagens
    ↓
💾 BANCO DE DADOS
    ├── study_plans ✓
    ├── exams ✓
    ├── disciplines ✓
    └── topics ✓
```

---

## 📊 Cenários de Teste

### 1️⃣ **Happy Path - Fluxo Completo com Sucesso**

#### Cenário 1.1: Edital Pequeno (5 disciplinas)
```typescript
Input: enac-2024.json (8KB)
Expected:
  - 1 study_plan criado
  - 1 exam criado
  - 5 disciplines criadas
  - ~25 topics criados
  - Status: 'ready'
  - Tempo: < 5 segundos
```

#### Cenário 1.2: Edital Médio (15 disciplinas)
```typescript
Input: tecnico-tjsp-2024.json (25KB)
Expected:
  - 1 study_plan criado
  - 2-3 exams criados
  - 15 disciplines criadas
  - ~100 topics criados
  - Status: 'ready'
  - Tempo: < 10 segundos
```

#### Cenário 1.3: Edital Grande (30+ disciplinas)
```typescript
Input: auditor-fiscal-rj-2024.json (58KB)
Expected:
  - 1 study_plan criado
  - 2-4 exams criados
  - 30+ disciplines criadas
  - ~200+ topics criados
  - Status: 'ready'
  - Tempo: < 20 segundos
```

---

### 2️⃣ **Validação de Integridade E2E**

#### Cenário 2.1: Contagens Corretas
```typescript
Test: Contagem de topics no banco === contagem no JSON original
Validation:
  - SELECT COUNT(*) FROM topics WHERE plan_id = X
  - Comparar com JSON original
  - Verifier deve aprovar (status = 'ready')
```

#### Cenário 2.2: Referências de Foreign Keys
```typescript
Test: Todas as referências estão corretas
Validation:
  - exams.plan_id → study_plans.id
  - disciplines.plan_id → study_plans.id
  - topics.plan_id → study_plans.id
  - topics.discipline_id → disciplines.id
```

#### Cenário 2.3: userId Correto em Todas as Entidades
```typescript
Test: RLS está funcionando
Validation:
  - study_plans.user_id = 'test-user-e2e'
  - Queries com outro userId retornam vazio
```

---

### 3️⃣ **Tratamento de Erros E2E**

#### Cenário 3.1: Falha no Pre-Orchestrator
```typescript
Test: JSON malformado → erro no Pre-Orchestrator
Expected:
  - Retornar erro claro
  - Nenhuma inserção no banco
  - Status: N/A (não criado)
```

#### Cenário 3.2: Falha no Orchestrator (DB indisponível)
```typescript
Test: Simular erro de conexão no banco
Expected:
  - Erro capturado
  - Rollback (se implementado)
  - Status: N/A ou 'error'
```

#### Cenário 3.3: Falha no Verifier
```typescript
Test: Contagens não batem
Expected:
  - Status: 'processing' ou 'error'
  - Log de discrepâncias
  - Plano criado mas sinalizado
```

---

### 4️⃣ **Performance E2E**

#### Cenário 4.1: Latência por Tamanho
```typescript
Test: Medir tempo de processamento
Benchmarks:
  - Pequeno (5 disc):   < 5s
  - Médio (15 disc):    < 10s
  - Grande (30 disc):   < 20s
  - Muito grande (50):  < 30s
```

#### Cenário 4.2: Múltiplos Editais Sequenciais
```typescript
Test: Processar 3 editais em sequência
Expected:
  - 3 study_plans criados
  - Todos independentes (user_ids diferentes)
  - Sem conflitos
  - Tempo total: < 30s
```

---

### 5️⃣ **Casos Reais com Editais de docs/editais/**

#### Editais Disponíveis (7 arquivos)
```
1. enac-2024.json (58KB)
2. edital MPRS.json (48KB)
3. edital advogado da união.json (17KB)
4. edital concurso cartórios rs.json (116KB) ⭐ MAIOR
5. edital juiz sc.json (23KB)
6. edital oab.json (23KB)
7. edital prefeitura.json (23KB)
```

#### Cenário 5.1: ENAC 2024
```typescript
Test: Processar edital ENAC completo
Validation:
  - Estrutura correta extraída
  - Todas disciplines criadas
  - Topics mapeados corretamente
  - Status final: 'ready'
```

#### Cenário 5.2: Cartórios RS (STRESS TEST)
```typescript
Test: Maior edital (116KB)
Expected:
  - Processar sem erros
  - Tempo: < 30s
  - Memória: < 50MB
  - Todas entidades criadas
```

#### Cenário 5.3: Batch - Processar Todos os 7 Editais
```typescript
Test: Loop pelos 7 editais
Expected:
  - 7 study_plans criados
  - Todos com status 'ready'
  - Tempo total: < 2 minutos
  - Sem memory leaks
```

---

## 🛠️ Infraestrutura de Testes E2E

### Ambiente Necessário

#### 1. Banco de Dados de Teste
```typescript
// Opções:
A) Supabase Branch (isolado)
B) Docker Postgres local
C) In-memory SQLite (limitado)

Recomendado: Supabase Branch
- Isola testes de produção
- Mesma estrutura/RLS
- Fácil cleanup
```

#### 2. Setup de Fixtures
```typescript
// Fixtures necessárias:
- 7 editais JSON (já existem em docs/editais/)
- User IDs de teste
- Função de cleanup (DELETE CASCADE)
```

#### 3. Helpers de Teste
```typescript
// test/e2e/helpers/db-helpers.ts
- cleanupDatabase(userId)
- verifyStudyPlan(planId)
- countRecords(table, planId)
- checkIntegrity(planId)
```

---

## 📝 Estrutura de Arquivos

```
test/
├── e2e/
│   ├── agents-e2e.test.ts          # Fluxo completo (cenários 1-3)
│   ├── performance-e2e.test.ts     # Performance (cenário 4)
│   ├── real-editais-e2e.test.ts    # Editais reais (cenário 5)
│   └── helpers/
│       ├── db-helpers.ts           # Funções de DB
│       ├── fixtures.ts             # Dados de teste
│       └── assertions.ts           # Validações customizadas
```

---

## 🎯 Métricas de Sucesso

### Cobertura
- ✅ 80%+ do fluxo E2E coberto
- ✅ Todos os 7 editais reais testados
- ✅ Cenários de erro cobertos

### Performance
- ✅ < 5s para editais pequenos
- ✅ < 10s para editais médios
- ✅ < 20s para editais grandes
- ✅ < 30s para stress test (116KB)

### Qualidade
- ✅ 100% dos testes E2E passando
- ✅ Zero falhas de integridade
- ✅ Zero memory leaks
- ✅ Cleanup automático

---

## ⚠️ Desafios Previstos

### 1. **Banco de Dados Real**
```
Problema: Testes precisam de DB real
Solução: Supabase Branch + cleanup automático
```

### 2. **Tempo de Execução**
```
Problema: E2E são lentos (I/O de banco)
Solução: 
  - Paralelizar quando possível
  - Usar beforeAll para setup
  - Batch cleanup
```

### 3. **Isolamento de Testes**
```
Problema: Testes podem interferir uns nos outros
Solução:
  - userId único por teste
  - Cleanup em afterEach
  - Transações (se possível)
```

### 4. **Dados Sensíveis**
```
Problema: Editais podem ter dados sensíveis
Solução:
  - Já são arquivos públicos
  - Usar .gitignore se necessário
  - Sanitizar em fixtures
```

---

## 📅 Cronograma de Implementação

### Dia 1: Setup (2-3 horas)
```
- [ ] Configurar Supabase Branch
- [ ] Criar helpers de DB
- [ ] Implementar cleanup automático
- [ ] Validar acesso aos 7 editais
```

### Dia 2: Testes Happy Path (2-3 horas)
```
- [ ] Cenário 1.1: Edital pequeno
- [ ] Cenário 1.2: Edital médio
- [ ] Cenário 1.3: Edital grande
- [ ] Validar integridade básica
```

### Dia 3: Testes de Erro e Performance (2-3 horas)
```
- [ ] Cenários de erro (3.1, 3.2, 3.3)
- [ ] Performance benchmarks (4.1, 4.2)
- [ ] Stress test com Cartórios RS
```

### Dia 4: Editais Reais e Refinamento (2-3 horas)
```
- [ ] Processar todos os 7 editais
- [ ] Batch test
- [ ] Documentação
- [ ] Ajustes finais
```

**Total Estimado:** 8-12 horas (2-3 dias de trabalho)

---

## 🚀 Próximos Passos Imediatos

### 1. Decisão de Infraestrutura
```
[ ] Escolher: Supabase Branch vs Docker vs SQLite
[ ] Configurar credenciais de teste
[ ] Validar acesso ao banco
```

### 2. Verificar Editais
```
[ ] Confirmar que 7 editais em docs/editais/ são válidos
[ ] Verificar tamanhos e estrutura
[ ] Identificar qual usar para cada cenário
```

### 3. Criar Estrutura Base
```
[ ] Criar pasta test/e2e/
[ ] Criar helpers básicos
[ ] Setup de Jest para E2E
```

---

## 📊 Comparação: Unit vs E2E

| Aspecto | Unit Tests | E2E Tests |
|---------|------------|-----------|
| **Velocidade** | < 1ms | 1-30s |
| **Isolamento** | Mocks | DB real |
| **Cobertura** | Função | Fluxo completo |
| **Manutenção** | Fácil | Moderada |
| **Confiança** | Média | Alta |
| **Quando rodar** | Sempre | CI/CD + manual |

---

## 💡 Insights Importantes

### 1. E2E ≠ Testes de Integração
```
E2E: Fluxo completo (JSON → DB)
Integration: Agente A → Agente B (parcial)
```

### 2. Foco em Happy Path Primeiro
```
80% dos bugs aparecem no happy path mal testado
20% aparecem em edge cases
```

### 3. Performance é Feature
```
Usuário não espera > 30s para processar edital
E2E devem validar tempos aceitáveis
```

### 4. Cleanup é Crítico
```
Testes E2E sem cleanup = banco poluído
Banco poluído = testes intermitentes
```

---

## 🎯 Critérios de Aceite

Para considerar a Fase 5 completa:

- ✅ 15-20 testes E2E implementados
- ✅ Todos os 7 editais processados com sucesso
- ✅ Performance dentro das metas (< 5s, < 10s, < 20s)
- ✅ Integridade 100% validada
- ✅ Cleanup automático funcionando
- ✅ Documentação completa
- ✅ Zero testes flaky (intermitentes)

---

**Status:** 📋 **PLANEJAMENTO COMPLETO**  
**Próximo:** 🔨 **IMPLEMENTAÇÃO**

---

*Planejamento criado em 13 de Outubro de 2025*
