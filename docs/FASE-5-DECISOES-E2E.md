# ✅ Checklist de Decisões - Fase 5 E2E

**Data:** 13 de Outubro de 2025  
**Status:** 🔄 AGUARDANDO DECISÕES

---

## 🎯 Decisões Críticas (BLOQUEIA IMPLEMENTAÇÃO)

### 1. 🗄️ Infraestrutura de Banco de Dados

#### Opção A: Supabase Branch (RECOMENDADA ⭐)
```
✅ Prós:
- Mesma estrutura do production
- RLS funciona igual
- Isolamento completo
- Fácil cleanup (delete branch)

❌ Contras:
- Precisa configurar branch
- Pode ter custo (verificar plano)
```

#### Opção B: Docker Postgres Local
```
✅ Prós:
- Totalmente local
- Sem custos
- Controle total

❌ Contras:
- Precisa setup inicial
- RLS precisa configuração manual
- Não testa Supabase real
```

#### Opção C: Usar Banco de Produção com Prefix
```
✅ Prós:
- Sem setup extra
- Testa ambiente real

❌ Contras:
- Risco de poluir produção
- Cleanup crítico
- NÃO RECOMENDADO ⚠️
```

**🔴 DECISÃO NECESSÁRIA:**
```
[ ] Qual opção usar? (A, B, ou C)
[ ] Temos acesso a Supabase Branch?
[ ] Limite de branches no plano atual?
```

---

### 2. 📁 Editais JSON: Usar Existentes ou Criar Novos?

#### Opção A: Usar 7 Editais de docs/editais/ (RECOMENDADA ⭐)
```
✅ Prós:
- Já existem
- Dados reais
- Variedade de tamanhos (8KB → 116KB)

❌ Contras:
- Podem ter inconsistências
- Não controlamos estrutura
```

#### Opção B: Criar Fixtures Sintéticas
```
✅ Prós:
- Controle total
- Dados limpos e previsíveis

❌ Contras:
- Trabalho extra
- Não testa dados reais
```

**🔴 DECISÃO NECESSÁRIA:**
```
[ ] Usar editais reais de docs/editais/? SIM/NÃO
[ ] Se NÃO, criar quantas fixtures?
[ ] Validar se 7 editais são válidos agora?
```

---

### 3. 🏗️ Estratégia de Testes

#### Opção A: Testes Sequenciais (Simples)
```typescript
test('Cenário 1', async () => {
  await processEdital();
  await verify();
});

test('Cenário 2', async () => {
  await processEdital();
  await verify();
});
```
```
✅ Prós: Simples, fácil debug
❌ Contras: Lento (não paraleliza)
```

#### Opção B: Testes Paralelos (Rápido)
```typescript
describe.concurrent('E2E Tests', () => {
  test('Cenário 1', async () => { ... });
  test('Cenário 2', async () => { ... });
});
```
```
✅ Prós: Mais rápido
❌ Contras: Precisa isolamento de userId
```

**🔴 DECISÃO NECESSÁRIA:**
```
[ ] Sequencial ou Paralelo?
[ ] Se paralelo, como garantir isolamento?
```

---

## 🟡 Decisões Importantes (NÃO BLOQUEIA, MAS IMPACTA)

### 4. 🧹 Estratégia de Cleanup

#### Opção A: afterEach (Granular)
```typescript
afterEach(async () => {
  await cleanupUser(testUserId);
});
```
```
✅ Prós: Limpo entre testes
❌ Contras: Mais lento
```

#### Opção B: afterAll (Batch)
```typescript
afterAll(async () => {
  await cleanupAllTestUsers();
});
```
```
✅ Prós: Mais rápido
❌ Contras: Testes podem interferir
```

**🟡 DECISÃO:**
```
[ ] afterEach ou afterAll?
[ ] Usar CASCADE DELETE?
```

---

### 5. ⏱️ Timeouts dos Testes

#### Valores Sugeridos
```typescript
// Pequeno
test('Small edital', async () => { ... }, 10000); // 10s

// Médio
test('Medium edital', async () => { ... }, 20000); // 20s

// Grande
test('Large edital', async () => { ... }, 40000); // 40s

// Global
jest.setTimeout(60000); // 60s
```

**🟡 DECISÃO:**
```
[ ] Aceitar valores acima? SIM/NÃO
[ ] Ajustar para valores diferentes?
```

---

### 6. 📊 Métricas a Coletar

#### Métricas Básicas (obrigatórias)
```
- ✅ Tempo de processamento
- ✅ Contagens de registros
- ✅ Status final (ready/error)
```

#### Métricas Avançadas (opcionais)
```
- 📊 Uso de memória
- 📊 Queries executadas
- 📊 Latência por agente
- 📊 Taxa de erro
```

**🟡 DECISÃO:**
```
[ ] Coletar apenas métricas básicas? SIM/NÃO
[ ] Se NÃO, quais métricas avançadas?
```

---

## 🟢 Decisões Opcionais (NICE TO HAVE)

### 7. 🎥 Logs e Debug

#### Nível de Logging
```
A) Minimal: Apenas erros
B) Normal: Erros + warnings
C) Verbose: Tudo (debug, info, etc)
```

**🟢 DECISÃO:**
```
[ ] Nível de log? (A, B, ou C)
[ ] Salvar logs em arquivo?
```

---

### 8. 📸 Snapshots de Dados

#### Salvar Snapshots?
```typescript
// Salvar JSON do resultado para comparação futura
test('Process ENAC', async () => {
  const result = await processEdital('enac-2024.json');
  expect(result).toMatchSnapshot(); // Jest snapshot
});
```

**🟢 DECISÃO:**
```
[ ] Usar snapshots? SIM/NÃO
[ ] Se SIM, para quais testes?
```

---

### 9. 🔄 CI/CD Integration

#### Rodar E2E em CI?
```
A) Sim, em todo PR
B) Sim, mas só em main/staging
C) Não, apenas manual
```

**🟢 DECISÃO:**
```
[ ] Rodar E2E no CI? (A, B, ou C)
[ ] Configurar DB de teste no CI?
```

---

## 📋 Resumo de Decisões

### CRÍTICAS (antes de começar)
```
1. [ ] Banco de dados: Supabase Branch / Docker / Produção
2. [ ] Editais: Reais (docs/editais/) / Fixtures sintéticas
3. [ ] Execução: Sequencial / Paralela
```

### IMPORTANTES (pode decidir durante)
```
4. [ ] Cleanup: afterEach / afterAll
5. [ ] Timeouts: 10s/20s/40s ou customizado
6. [ ] Métricas: Básicas / Avançadas
```

### OPCIONAIS (pode pular)
```
7. [ ] Logs: Minimal / Normal / Verbose
8. [ ] Snapshots: Sim / Não
9. [ ] CI/CD: Sim / Não
```

---

## 🚀 Recomendações do Arquiteto

### Decisões Recomendadas para Começar Rápido

```typescript
// 1. Banco de Dados
✅ USAR: Supabase Branch (se disponível)
   OU Docker local (se não)

// 2. Editais
✅ USAR: 7 editais reais de docs/editais/

// 3. Execução
✅ USAR: Sequencial (simples primeiro)
   Otimizar para paralelo depois

// 4. Cleanup
✅ USAR: afterEach (mais seguro)

// 5. Timeouts
✅ USAR: 10s/20s/40s (valores sugeridos)

// 6. Métricas
✅ USAR: Básicas (tempo, contagens, status)

// 7-9. Opcionais
✅ PULAR: Implementar se sobrar tempo
```

### Por que essas recomendações?

1. **Supabase Branch:** Testa ambiente real sem risco
2. **Editais reais:** Detecta problemas reais
3. **Sequencial:** Mais fácil de debugar
4. **afterEach:** Evita interferências
5. **Timeouts padrão:** Funcionam para 90% dos casos
6. **Métricas básicas:** Suficiente para validação

---

## ✅ Checklist de Ação

### Antes de Implementar
```
[ ] Escolher banco de dados
[ ] Validar acesso/credenciais
[ ] Confirmar 7 editais válidos
[ ] Decidir sequencial vs paralelo
[ ] Definir timeouts
```

### Durante Implementação
```
[ ] Criar helpers de DB
[ ] Implementar cleanup
[ ] Escrever primeiro teste E2E
[ ] Validar que funciona
[ ] Expandir cobertura
```

### Após Implementação
```
[ ] Rodar todos os testes
[ ] Validar performance
[ ] Documentar resultados
[ ] Commit e push
```

---

**Status:** ⏸️ **AGUARDANDO DECISÕES**  
**Bloqueadores:** Decisões 1, 2, 3 (Críticas)

**Próximo Passo:** Tomar decisões críticas para desbloquear implementação

---

*Checklist criado em 13 de Outubro de 2025*
