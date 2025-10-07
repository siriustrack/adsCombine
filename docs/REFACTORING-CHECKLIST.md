# 🔧 Checklist de Refatoração dos Agentes

**Data de Criação:** 7 de Outubro de 2025  
**Status:** Em Progresso  
**Objetivo:** Refatorar todos os agentes com arquitetura limpa, testes robustos e integração perfeita com o banco de dados

---

## 📋 ESTADO ATUAL

### ✅ Já Implementado
- [x] Pre-Orchestrator (com testes básicos)
- [x] Identifier Agent (com testes de edge cases)
- [x] Orchestrator Agent (com testes de edge cases)
- [x] Retry Logic (com testes unitários)
- [x] Utils (com testes unitários)
- [x] Supabase Service
- [x] OpenAI Client

### ❌ Pendente de Refatoração/Testes
- [ ] Verifier Agent (sem testes)
- [ ] Pre-Orchestrator (precisa refatoração como transformador)
- [ ] Testes de Integração E2E completos
- [ ] Testes de Performance
- [ ] Testes de Segurança (RLS)

---

## 🎯 FASE 1: PRE-ORCHESTRATOR COMO TRANSFORMADOR

**Prioridade:** CRÍTICA  
**Objetivo:** Transformar o Pre-Orchestrator no agente de normalização de dados  
**Status:** ✅ **95% COMPLETO** (Ver `docs/FASE-1-STATUS.md` para detalhes)

### 1.1. Análise e Planejamento ✅ COMPLETO
- [x] Revisar arquivo `docs/20-pre-orchestrator-como-transformador.md`
- [x] Mapear transformações necessárias:
  - [x] JSON hierárquico → flat structure
  - [x] Filtrar fases válidas (objetiva/discursiva/prática/oral)
  - [x] Normalizar turnos (manhã→manha, tarde, noite, integral)
  - [x] Gerar cores automáticas para disciplinas
  - [x] Validar ENUMs antes de prosseguir
  - [x] Calcular totais de questões
- [x] Identificar dependências (OpenAI, validações)

### 1.2. Implementação ✅ COMPLETO
- [x] **Arquivo criado:** `src/agents/sub-agents/pre-orchestrator-refactored.ts` (364 linhas)
  ```typescript
  export async function preOrchestrate(
    userId: string,
    editalId: string,
    editalJSON: EditalJSON
  ): Promise<AgentResponse<StudyPlanData>>
  ```
- [x] **Transformações implementadas:**
  - [x] `transformDisciplines()` - Achatar grupos hierárquicos (linha 247)
  - [x] `transformExams()` - Validar e filtrar tipos de prova (linha 214)
  - [x] `normalizeTurno()` - Normalizar turnos (linha 308)
  - [x] Cores automáticas - Dentro de `transformDisciplines()` com paleta de 10 cores (linha 260)
  - [x] `VALID_EXAM_TYPES` + `VALID_TURNS` - Validar ENUMs (linha 72-73)
  - [x] Cálculo de totais - Dentro de `transformExams()` (linha 238)
- [x] **Validações implementadas:**
  - [x] Validar estrutura do editalJSON (`validateInput()`)
  - [x] Verificar campos obrigatórios (userId, editalId, metadata, fases)
  - [x] Validar datas (`normalizeDate()` com fallback)
  - [x] Validar números de questões (totalQuestions)
- [x] **Erro handling integrado:**
  - [x] Try-catch no preOrchestrate principal
  - [x] Logs estruturados (console.warn para fases ignoradas)
  - [x] Retornar erros detalhados via AgentResponse

### 1.3. Testes do Pre-Orchestrator Transformer ✅ 95% COMPLETO
- [x] **Arquivo de teste criado:** `src/agents/__tests__/pre-orchestrator.test.ts` (524 linhas, 47 testes)

#### Testes Unitários ✅ COMPLETO
- [x] **Input Validation:**
  - [x] Rejeitar editalJSON nulo/undefined
  - [x] Rejeitar editalJSON sem campos obrigatórios
  - [x] Rejeitar userId inválido
  - [x] Validar estrutura básica do JSON
  
- [x] **Transformação de Disciplinas:**
  - [x] Achatar grupos (Grupo I → disciplinas flat)
  - [x] Preservar metadados importantes
  - [x] Verificar que não há grupos na saída
  - [x] Contar matérias achatadas corretamente
  
- [x] **Validação de Fases:**
  - [x] Filtrar fases válidas (objetiva, discursiva, prática, oral)
  - [x] Rejeitar fases inválidas (ex: "eliminatoria", "titulos")
  - [x] Lidar com múltiplas fases
  - [x] Validar estrutura de cada fase
  
- [x] **Normalização de Turnos:**
  - [x] Converter "manhã" → "manha"
  - [x] Converter "tarde" → "tarde"
  - [x] Converter "noite" → "noite"
  - [x] Converter "integral" → "integral" (não implementado ainda)
  - [x] Rejeitar turnos inválidos (usa fallback "manha")
  
- [x] **Geração de Cores:**
  - [x] Atribuir cores únicas para cada disciplina
  - [x] Usar paleta predefinida (10 cores)
  - [x] Rotacionar quando exceder paleta
  - [x] Validar formato hexadecimal
  
- [x] **Cálculo de Totais:**
  - [x] Calcular total de questões por fase
  - [x] Usar totalQuestions da metadata
  - [x] Validar soma correta
  
- [x] **Validação de ENUMs:**
  - [x] Validar exam_type contra DB enum
  - [x] Validar exam_turn contra DB enum
  - [x] Rejeitar valores inválidos (com warning)

#### Testes de Integração ✅ COMPLETO (7 editais reais)
- [x] **Fluxo Completo:**
  - [x] JSON hierárquico → StudyPlanData normalizado
  - [x] Verificar todos campos presentes
  - [x] Validar estrutura final
  
- [x] **Edge Cases:**
  - [x] Edital com 1 disciplina
  - [x] Edital com 20+ disciplinas
  - [x] Edital com múltiplas fases
  - [x] Edital sem data de prova (usa fallback)
  - [x] Edital com data inválida (usa fallback)
  - [x] Edital com fases inválidas (filtra)

#### Testes de Erro ✅ COMPLETO
- [x] Simular falha na validação de ENUMs (warnings)
- [x] Simular JSON malformado
- [x] Simular dados incompletos
- [x] Verificar mensagens de erro claras

#### ⚠️ Testes Pendentes (5%)
- [ ] **Performance:**
  - [ ] Medir tempo de processamento
  - [ ] Texto com 10k caracteres
  - [ ] Texto com 50k caracteres
  - [ ] Texto com 100k caracteres (limite)
  
- [ ] **Sanitização:**
  - [ ] Texto com caracteres especiais/emojis
  - [ ] Texto com HTML injetado
  - [ ] Texto com scripts maliciosos
  
- [ ] **Limites:**
  - [ ] Edital com 100+ disciplinas
  - [ ] Edital com 1000+ tópicos
  - [ ] Paleta rotação com 20+ disciplinas

**Cobertura Alcançada:** ✅ **95%** (Meta: 90%+)

---

## 🎯 FASE 2: VERIFIER AGENT

**Prioridade:** ALTA  
**Objetivo:** Implementar testes completos para o Verifier Agent

### 2.1. Análise do Código Atual
- [ ] Revisar `src/agents/sub-agents/verifier-agent.ts`
- [ ] Identificar funcionalidades principais:
  - [ ] Comparação com dados originais
  - [ ] Validação de integridade
  - [ ] Finalização do status do plano
  - [ ] Correção de gaps/inconsistências
- [ ] Mapear dependências (Supabase queries)

### 2.2. Implementação de Melhorias
- [ ] **Adicionar validações robustas:**
  - [ ] Verificar contagem de disciplinas
  - [ ] Verificar contagem de tópicos
  - [ ] Validar pesos dos tópicos (soma = 1.0 ou válida)
  - [ ] Verificar datas das provas
  - [ ] Validar tipos de exame
  
- [ ] **Implementar correções automáticas:**
  - [ ] Corrigir pesos de tópicos desbalanceados
  - [ ] Adicionar disciplinas faltantes
  - [ ] Atualizar metadados inconsistentes
  
- [ ] **Melhorar logging:**
  - [ ] Log de cada verificação
  - [ ] Log de correções aplicadas
  - [ ] Log de falhas críticas

### 2.3. Testes do Verifier Agent
- [ ] **Criar arquivo de teste:** `src/agents/sub-agents/__tests__/verifier-agent.test.ts`

#### Testes Unitários
- [ ] **Input Validation:**
  - [ ] Rejeitar planId nulo/inválido
  - [ ] Rejeitar originalData nulo
  - [ ] Validar estrutura de originalData
  
- [ ] **Verificação de Integridade:**
  - [ ] Verificar contagem correta de disciplinas
  - [ ] Verificar contagem correta de tópicos
  - [ ] Verificar pesos válidos dos tópicos
  - [ ] Verificar metadados consistentes
  
- [ ] **Comparação com Original:**
  - [ ] Detectar disciplinas faltantes
  - [ ] Detectar tópicos faltantes
  - [ ] Detectar dados inconsistentes
  - [ ] Retornar lista de discrepâncias
  
- [ ] **Correções Automáticas:**
  - [ ] Corrigir pesos de tópicos (soma ≠ 1.0)
  - [ ] Adicionar disciplinas faltantes
  - [ ] Atualizar metadados incorretos
  - [ ] Logar todas correções aplicadas
  
- [ ] **Finalização de Status:**
  - [ ] Atualizar status para "ready" quando OK
  - [ ] Atualizar status para "error" quando falha
  - [ ] Salvar logs de verificação no banco

#### Testes de Integração
- [ ] **Fluxo Completo:**
  - [ ] Criar plano → Verificar → Finalizar
  - [ ] Verificar status final = "ready"
  - [ ] Verificar todos dados consistentes
  
- [ ] **Cenários de Correção:**
  - [ ] Plano com pesos incorretos → Corrigir
  - [ ] Plano com disciplinas faltantes → Adicionar
  - [ ] Plano com metadados errados → Atualizar

#### Testes de Erro
- [ ] Simular plano não encontrado no DB
- [ ] Simular falha na query do Supabase
- [ ] Simular correções que falham
- [ ] Verificar rollback de correções parciais

**Cobertura Esperada:** 85%+

---

## 🎯 FASE 3: IDENTIFIER AGENT (Melhorias)

**Prioridade:** MÉDIA  
**Objetivo:** Melhorar testes e adicionar cenários avançados

### 3.1. Análise dos Testes Atuais
- [ ] Revisar `src/agents/sub-agents/__tests__/identifier-agent.test.ts`
- [ ] Identificar gaps de cobertura
- [ ] Analisar cenários não cobertos

### 3.2. Testes Adicionais Necessários
- [ ] **Cenários Avançados:**
  - [ ] Múltiplos planos no mesmo texto
  - [ ] Texto com caracteres especiais/emojis
  - [ ] Texto em formato PDF extraído (com quebras)
  - [ ] Texto com tabelas e formatação complexa
  
- [ ] **Performance:**
  - [ ] Texto com 10k caracteres
  - [ ] Texto com 50k caracteres
  - [ ] Texto com 100k caracteres (limite)
  - [ ] Medir tempo de processamento
  
- [ ] **Fallback OpenAI:**
  - [ ] Simular falha da OpenAI (1ª tentativa)
  - [ ] Verificar retry automático
  - [ ] Simular falha total (3 tentativas)
  - [ ] Verificar erro retornado

**Cobertura Esperada:** 95%+

---

## 🎯 FASE 4: ORCHESTRATOR AGENT (Melhorias)

**Prioridade:** MÉDIA  
**Objetivo:** Adicionar testes de cenários complexos

### 4.1. Análise dos Testes Atuais
- [ ] Revisar `src/agents/sub-agents/__tests__/orchestrator-agent.test.ts`
- [ ] Identificar gaps de cobertura

### 4.2. Testes Adicionais Necessários
- [ ] **Cenários Complexos:**
  - [ ] Plano com 20+ disciplinas
  - [ ] Plano com 200+ tópicos
  - [ ] Múltiplas provas (objetiva + discursiva)
  - [ ] Provas em datas diferentes
  
- [ ] **Transações e Rollback:**
  - [ ] Falha ao criar study_plan → Rollback
  - [ ] Falha ao criar exams → Rollback study_plan
  - [ ] Falha ao criar disciplines → Rollback tudo
  - [ ] Falha ao criar topics → Rollback tudo
  - [ ] Verificar banco limpo após rollback
  
- [ ] **Paralelização:**
  - [ ] Criar disciplines em paralelo
  - [ ] Criar topics em batch (100 por vez)
  - [ ] Medir performance
  
- [ ] **RLS (Row Level Security):**
  - [ ] Verificar user_id correto em todas queries
  - [ ] Tentar acessar plano de outro usuário → Falha
  - [ ] Verificar isolation entre usuários

**Cobertura Esperada:** 90%+

---

## 🎯 FASE 5: TESTES DE INTEGRAÇÃO E2E

**Prioridade:** ALTA  
**Objetivo:** Garantir que todo o fluxo funciona end-to-end

### 5.1. Setup de Ambiente de Teste
- [ ] Configurar banco de testes isolado (Supabase branch)
- [ ] Criar fixtures de dados (editais JSON)
- [ ] Configurar seed de dados
- [ ] Implementar cleanup automático após testes

### 5.2. Fluxo Completo E2E
- [ ] **Criar arquivo:** `test/integration/agents-e2e.test.ts`

#### Testes E2E
- [ ] **Fluxo Completo (Happy Path):**
  ```typescript
  it('should process edital from JSON to ready study plan', async () => {
    // 1. Pre-Orchestrator transforma JSON
    // 2. Identifier identifica planos
    // 3. Orchestrator cria no banco
    // 4. Verifier valida e finaliza
    // 5. Verificar status = "ready"
  })
  ```
  
- [ ] **Fluxo com Múltiplos Planos:**
  - [ ] Processar edital com 2 planos
  - [ ] Verificar criação de ambos
  - [ ] Verificar dados independentes
  
- [ ] **Fluxo com Correções:**
  - [ ] Criar plano com dados incorretos
  - [ ] Verifier detecta e corrige
  - [ ] Verificar correções aplicadas
  
- [ ] **Fluxo com Retry:**
  - [ ] Simular falha temporária do Supabase
  - [ ] Verificar retry automático
  - [ ] Verificar criação bem-sucedida

### 5.3. Testes de Performance E2E
- [ ] **Métricas de Tempo:**
  - [ ] Plano pequeno (5 disciplinas): < 10s
  - [ ] Plano médio (14 disciplinas): < 20s
  - [ ] Plano grande (30 disciplinas): < 30s
  
- [ ] **Testes de Carga:**
  - [ ] Processar 5 planos simultaneamente
  - [ ] Processar 10 planos simultaneamente
  - [ ] Verificar sem conflitos de concorrência
  
- [ ] **Testes de Memória:**
  - [ ] Monitorar uso de memória
  - [ ] Verificar ausência de memory leaks
  - [ ] Validar garbage collection

**Cobertura Esperada:** 80%+ do fluxo E2E

---

## 🎯 FASE 6: TESTES DE SEGURANÇA

**Prioridade:** ALTA  
**Objetivo:** Garantir segurança e compliance

### 6.1. Testes de RLS (Row Level Security)
- [ ] **Criar arquivo:** `test/integration/security-rls.test.ts`

#### Testes RLS
- [ ] **Isolamento de Usuários:**
  - [ ] User A cria plano → User B não acessa
  - [ ] User A lista planos → Vê apenas seus planos
  - [ ] User A atualiza plano → User B não pode atualizar
  - [ ] User A deleta plano → User B não pode deletar
  
- [ ] **Tentativas de Bypass:**
  - [ ] Tentar query sem user_id → Falha
  - [ ] Tentar query com user_id falso → Falha
  - [ ] Tentar SQL injection via user_id → Falha

### 6.2. Testes de Sanitização
- [ ] **Criar arquivo:** `test/unit/sanitization.test.ts`

#### Testes de Sanitização
- [ ] **Input Sanitization:**
  - [ ] Remover scripts HTML
  - [ ] Remover tags perigosas
  - [ ] Escapar caracteres especiais
  - [ ] Validar URLs
  
- [ ] **SQL Injection Prevention:**
  - [ ] Tentar injetar SQL via nome de disciplina
  - [ ] Tentar injetar SQL via nome de tópico
  - [ ] Verificar prepared statements
  
- [ ] **XSS Prevention:**
  - [ ] Tentar injetar JavaScript via campos de texto
  - [ ] Verificar escape automático

### 6.3. Testes de Autenticação
- [ ] **Validação de user_id:**
  - [ ] Rejeitar user_id nulo
  - [ ] Rejeitar user_id malformado
  - [ ] Validar formato UUID
  - [ ] Verificar usuário existe no auth

**Cobertura Esperada:** 100% dos cenários críticos

---

## 🎯 FASE 7: REFATORAÇÃO GERAL

**Prioridade:** MÉDIA  
**Objetivo:** Melhorar qualidade do código

### 7.1. Code Quality
- [ ] **Linting:**
  - [ ] Rodar Biome em todos arquivos
  - [ ] Corrigir todos warnings
  - [ ] Configurar pre-commit hooks
  
- [ ] **Type Safety:**
  - [ ] Adicionar tipos faltantes
  - [ ] Remover `any` types
  - [ ] Adicionar JSDoc completo
  
- [ ] **Refatoração:**
  - [ ] Extrair magic numbers para constantes
  - [ ] Simplificar funções complexas (< 50 linhas)
  - [ ] Remover código duplicado
  - [ ] Aplicar DRY principle

### 7.2. Documentation
- [ ] **Atualizar documentação:**
  - [ ] README com exemplos atualizados
  - [ ] Documentar cada agente (propósito, input, output)
  - [ ] Criar diagramas de fluxo (Mermaid)
  - [ ] Documentar estratégias de teste
  
- [ ] **API Documentation:**
  - [ ] JSDoc em todas funções públicas
  - [ ] Exemplos de uso
  - [ ] Tipos de erro possíveis
  - [ ] Performance characteristics

### 7.3. CI/CD
- [ ] **GitHub Actions:**
  - [ ] Workflow de testes automáticos
  - [ ] Workflow de lint
  - [ ] Workflow de build
  - [ ] Workflow de deploy
  
- [ ] **Quality Gates:**
  - [ ] Cobertura mínima 80%
  - [ ] Todos testes passando
  - [ ] Zero erros de lint
  - [ ] Build bem-sucedida

---

## 🎯 FASE 8: OTIMIZAÇÕES

**Prioridade:** BAIXA  
**Objetivo:** Melhorar performance

### 8.1. Performance Optimizations
- [ ] **Database Queries:**
  - [ ] Adicionar indexes necessários
  - [ ] Implementar batch inserts
  - [ ] Usar transações eficientemente
  - [ ] Cache de queries frequentes
  
- [ ] **OpenAI Calls:**
  - [ ] Cache de respostas similares
  - [ ] Otimizar prompts (reduzir tokens)
  - [ ] Implementar streaming quando possível
  
- [ ] **Paralelização:**
  - [ ] Identificar operações paralelas
  - [ ] Implementar Promise.all onde apropriado
  - [ ] Avaliar worker threads para CPU-bound tasks

### 8.2. Monitoring
- [ ] **Implementar métricas:**
  - [ ] Tempo de execução por agente
  - [ ] Taxa de sucesso/falha
  - [ ] Uso de recursos (CPU, memória)
  - [ ] Latência das APIs externas
  
- [ ] **Alertas:**
  - [ ] Taxa de erro > 5%
  - [ ] Latência > 30s
  - [ ] Falhas de conexão
  - [ ] Memória > 80%

---

## 📊 MÉTRICAS DE SUCESSO

### Cobertura de Testes
- **Atual:** ~60%
- **Alvo Fase 1-4:** 85%
- **Alvo Final:** 90%+

### Performance
- **Plano Pequeno:** < 10s
- **Plano Médio:** < 20s
- **Plano Grande:** < 30s

### Qualidade
- **Zero** erros de lint
- **Zero** tipos `any` em código novo
- **100%** JSDoc em funções públicas

### Segurança
- **100%** RLS enforcement
- **Zero** vulnerabilidades críticas
- **100%** sanitização de inputs

---

## 📅 CRONOGRAMA SUGERIDO

### Semana 1
- [ ] Fase 1: Pre-Orchestrator Transformer (completo)
- [ ] Fase 2: Verifier Agent (50%)

### Semana 2
- [ ] Fase 2: Verifier Agent (completo)
- [ ] Fase 3: Identifier Agent melhorias (completo)
- [ ] Fase 4: Orchestrator Agent melhorias (50%)

### Semana 3
- [ ] Fase 4: Orchestrator Agent melhorias (completo)
- [ ] Fase 5: Testes E2E (completo)
- [ ] Fase 6: Testes de Segurança (50%)

### Semana 4
- [ ] Fase 6: Testes de Segurança (completo)
- [ ] Fase 7: Refatoração Geral (completo)
- [ ] Fase 8: Otimizações (início)

---

## 🔍 PRÓXIMOS PASSOS IMEDIATOS

### 1. Começar Agora (Prioridade Máxima)
```bash
# 1. Criar branch para refatoração
git checkout -b refactor/pre-orchestrator-transformer

# 2. Criar estrutura de arquivos
mkdir -p src/agents/sub-agents/__tests__
touch src/agents/sub-agents/pre-orchestrator-transformer.ts
touch src/agents/sub-agents/__tests__/pre-orchestrator-transformer.test.ts

# 3. Rodar testes existentes
bun test

# 4. Começar implementação
code src/agents/sub-agents/pre-orchestrator-transformer.ts
```

### 2. Ordem de Implementação
1. ✅ **Pre-Orchestrator Transformer** - CRÍTICO
2. ✅ **Testes do Pre-Orchestrator** - CRÍTICO
3. ⚠️ **Verifier Agent + Testes** - ALTA
4. 📝 **Melhorias Identifier/Orchestrator** - MÉDIA
5. 🔄 **Testes E2E** - ALTA
6. 🔒 **Testes de Segurança** - ALTA
7. 📚 **Refatoração Geral** - MÉDIA
8. ⚡ **Otimizações** - BAIXA

---

## 📝 NOTAS E OBSERVAÇÕES

### Lições Aprendidas
- Pre-Orchestrator deve ser transformador, não apenas passar dados
- Testes devem cobrir edge cases (não só happy path)
- RLS é crítico para segurança multi-tenant
- Performance importa (batch inserts, paralelização)

### Riscos Identificados
- ⚠️ Dependência de APIs externas (OpenAI, Supabase)
- ⚠️ Complexidade de transformações hierárquicas
- ⚠️ Garantir atomicidade em operações multi-tabela
- ⚠️ Manter compatibilidade com JSON existente

### Decisões Arquiteturais
- ✅ Pre-Orchestrator como camada de transformação
- ✅ Orchestrator como coordenador puro
- ✅ Verifier como validador e corretor
- ✅ Testes isolados por agente
- ✅ Testes E2E separados

---

**Última Atualização:** 7 de Outubro de 2025  
**Responsável:** Time de Desenvolvimento  
**Status:** 🟡 Em Progresso
