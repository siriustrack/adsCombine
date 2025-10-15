# DEBUG: Falhas em Produção - Edital Process
**Data:** 15 de Outubro de 2025  
**Job ID:** 6cfc3d82-3490-4ef8-a727-4236e736c729  
**Status:** ❌ Processamento com erros críticos

---

## 📊 RESUMO EXECUTIVO

O sistema processou o edital em **5m 47s** mas gerou dados **inválidos e incompletos**:
- ✅ 3 chunks processados
- ❌ 3 erros de parsing JSON (todos os chunks)
- ❌ 3 erros de validação de schema
- ⚠️ 14 warnings durante processamento
- ❌ **Integridade: FALHOU** (`integridadeOK: false`)

**Problema Principal:** Claude retorna JSON válido mas wrappado em markdown code blocks (```json), e mesmo após extração, os dados não passam na validação Zod.

---

## 🔍 ANÁLISE DETALHADA DOS PROBLEMAS

### **PROBLEMA 1: Formato de Resposta do Claude**
**Evidência:**
```
error: Error processing with Claude {
  "error":"Unexpected token '`', \"```json\n{\n\"... is not valid JSON"
}
```

**Análise:**
- Claude está retornando JSON dentro de markdown code blocks (```json ... ```)
- O código tenta fazer `JSON.parse()` direto na resposta
- Falha inicial, depois tenta extrair com fallback
- **Extração funciona** ("Extracted JSON from markdown code block (strategy 1)")

**Auto-questionamento:**
1. Por que em produção Claude retorna com markdown e no teste E2E não?
2. O prompt está diferente entre ambiente de teste e produção?
3. A extração está funcionando, então por que os dados finais são inválidos?

**Hipóteses:**
- ✅ Sistema de extração/fallback ESTÁ funcionando
- ❌ Problema está DEPOIS da extração
- ❌ Claude pode estar retornando estrutura diferente em streaming vs completo

---

### **PROBLEMA 2: Validação de Data - StartDate**
**Evidência:**
```json
{
  "validation": "regex",
  "code": "invalid_string",
  "message": "Data deve estar no formato YYYY-MM-DD",
  "path": ["concursos", 0, "metadata", "startDate"]
}
```

**Análise:**
- **Todos os 3 chunks** falharam na validação de `startDate`
- Formato esperado: `YYYY-MM-DD` (regex: `/^\d{4}-\d{2}-\d{2}$/`)
- Claude pode estar retornando:
  - `DD/MM/YYYY` (formato brasileiro)
  - `DD-MM-YYYY`
  - Texto como "01 de janeiro de 2025"
  - String vazia ou null

**Auto-questionamento:**
1. O prompt especifica claramente o formato ISO 8601?
2. No teste E2E, os dados mockados já estão no formato correto?
3. Há exemplo no prompt mostrando o formato esperado?

**Impacto:**
- ⚠️ Sistema continua com warning mas retorna dados inválidos
- ⚠️ Frontend não conseguirá fazer ordenação/filtro por data
- ⚠️ Database pode rejeitar na inserção se houver constraint

---

### **PROBLEMA 3: Disciplinas Sem Matérias**
**Evidência:**
```json
{
  "code": "too_small",
  "minimum": 1,
  "type": "array",
  "message": "Disciplina deve ter ao menos uma matéria",
  "path": ["concursos", 0, "disciplinas", 0, "materias"]
}
```

**Análise:**
- Chunk 3 retornou disciplinas com array `materias` vazio `[]`
- Schema Zod exige: `.min(1, "Disciplina deve ter ao menos uma matéria")`
- Validação identificou:
  - Disciplina 0: "Direito Constitucional" - sem matérias
  - Disciplina 1: "Direito Administrativo" - sem matérias

**Auto-questionamento:**
1. Por que Claude não está extraindo as matérias dessas disciplinas?
2. O conteúdo do chunk 3 tem informação sobre matérias?
3. O prompt instrui claramente como estruturar disciplinas e matérias?

**Hipóteses:**
- Claude não está entendendo a hierarquia disciplina → matéria → tópicos
- Informação pode estar fragmentada entre chunks
- Prompt pode estar ambíguo sobre o que é "matéria" vs "tópico"

---

### **PROBLEMA 4: Contagem de Questões Zerada**
**Evidência:**
```
"[Concurso...] Soma das questões por disciplina (0) difere do total da prova objetiva (100)"
```

**Análise:**
- Todas as disciplinas estão com `numeroQuestoes: 0`
- Metadata indica 100 questões, mas soma das disciplinas = 0
- **Dados estruturais existem** (26 disciplinas criadas)
- **Dados numéricos ausentes** (questões não contabilizadas)

**Auto-questionamento:**
1. Claude está ignorando números de questões?
2. O campo `numeroQuestoes` está no schema do prompt?
3. Há confusão entre "questões por matéria" vs "questões por disciplina"?

**Impacto Crítico:**
- ❌ Sistema de estudo não consegue distribuir tempo
- ❌ Plano de estudo ficará inválido
- ❌ Usuário não terá visibilidade de peso das disciplinas

---

### **PROBLEMA 5: Inconsistência Entre Chunks**
**Análise Temporal:**
```
17:06:46 - Chunk 0: 1 concurso, validation failed (startDate)
17:08:42 - Chunk 1: 1 concurso, validation failed (startDate)
17:11:52 - Chunk 2: validation failed (startDate + matérias vazias)
```

**Observações:**
- Cada chunk processou ~40-160 segundos
- Chunks 0 e 1: apenas erro de data
- Chunk 2: erros de data + matérias vazias
- **Resultado final:** 2 concursos (deveria ser 1 concurso completo?)

**Auto-questionamento:**
1. O merge dos chunks está duplicando concursos?
2. Como está sendo feita a consolidação dos 3 chunks?
3. O contexto compartilhado está sendo utilizado corretamente?

**Hipóteses:**
- Cada chunk está criando um concurso separado
- Lógica de merge está incorreta ou ausente
- Claude não está entendendo que são partes do mesmo concurso

---

## 💡 COMPARAÇÃO: E2E vs PRODUÇÃO

### **O que funciona no E2E mas falha em produção:**

| Aspecto | E2E | Produção |
|---------|-----|----------|
| Formato resposta | JSON limpo? | Markdown + JSON |
| Validação data | ✅ Passa | ❌ Falha |
| Matérias | ✅ Populadas | ❌ Arrays vazios |
| Questões | ✅ Contadas | ❌ Todas zeradas |
| Chunks | Mock completo? | 3 chunks reais |
| Tempo | Rápido | 5m 47s |

### **Diferenças Críticas:**
1. **E2E provavelmente usa mock/fixture** com dados já validados
2. **Produção usa Claude real** com variabilidade nas respostas
3. **E2E pode não testar chunking** (documento pequeno)
4. **Prompt real pode estar diferente** do usado no desenvolvimento

---

## 🎯 SOLUÇÕES PROPOSTAS

### **SOLUÇÃO 1: Corrigir Formato de Data**

#### **Opção 1A: Pós-processamento no Backend**
**Descrição:** Adicionar transformação de data após receber resposta do Claude

**Implementação:**
- Detectar formatos: `DD/MM/YYYY`, `DD-MM-YYYY`, texto
- Converter para `YYYY-MM-DD`
- Aplicar antes da validação Zod

**Prós:**
- ✅ Resolve imediatamente
- ✅ Independente do Claude
- ✅ Pode tratar múltiplos formatos

**Contras:**
- ⚠️ Adiciona complexidade
- ⚠️ Pode ter ambiguidade (02/03/2025 = fev ou mar?)

#### **Opção 1B: Melhorar Prompt com Exemplos**
**Descrição:** Adicionar ao prompt exemplos explícitos de formato de data

**Implementação:**
```
IMPORTANTE: Todas as datas devem estar no formato ISO 8601: YYYY-MM-DD
Exemplos CORRETOS:
- "2025-01-15"
- "2024-12-31"

Exemplos INCORRETOS (NÃO USE):
- "15/01/2025"
- "15-01-2025"
- "01 de janeiro de 2025"
```

**Prós:**
- ✅ Ataca problema na origem
- ✅ Claude 3.5 Sonnet é bom em seguir exemplos
- ✅ Sem complexidade adicional no código

**Contras:**
- ⚠️ Depende de Claude seguir instruções
- ⚠️ Pode não funcionar 100% das vezes

#### **Opção 1C: Pré-transformação com Zod Transform**
**Descrição:** Usar `.transform()` no schema Zod para normalizar datas

**Implementação:**
```typescript
startDate: z.string()
  .transform((val) => {
    // Tentar vários formatos e converter para YYYY-MM-DD
    return normalizeDateToISO(val);
  })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD")
```

**Prós:**
- ✅ Validação e transformação em um lugar só
- ✅ Transparente para o resto do código
- ✅ Reutilizável em outros schemas

**Contras:**
- ⚠️ Pode mascarar problemas do Claude
- ⚠️ Transformação pode falhar silenciosamente

**RECOMENDAÇÃO:** Combinar **1B + 1C** (prompt melhor + fallback com transform)

---

### **SOLUÇÃO 2: Resolver Disciplinas Sem Matérias**

#### **Opção 2A: Melhorar Estrutura no Prompt**
**Descrição:** Especificar hierarquia clara no prompt

**Implementação:**
```
ESTRUTURA HIERÁRQUICA OBRIGATÓRIA:

Concurso
  └── Disciplinas (ex: "Direito Constitucional")
      └── Matérias (ex: "Princípios Fundamentais") [OBRIGATÓRIO: mínimo 1]
          └── Tópicos (ex: "Dignidade da pessoa humana") [OBRIGATÓRIO: mínimo 1]

REGRA CRÍTICA: Toda disciplina DEVE ter pelo menos 1 matéria.
Se o edital não especifica matérias, use o nome da disciplina como matéria.
```

**Prós:**
- ✅ Instrução explícita
- ✅ Fornece fallback (usar nome da disciplina)
- ✅ Previne arrays vazios

**Contras:**
- ⚠️ Depende de Claude seguir regra
- ⚠️ Fallback pode gerar dados artificiais

#### **Opção 2B: Validação com Correção Automática**
**Descrição:** Detectar disciplinas vazias e criar matéria genérica

**Implementação:**
- Após validação falhar, interceptar erro
- Para cada disciplina sem matérias:
  - Criar matéria com nome = nome da disciplina
  - Adicionar tópico genérico: "Conteúdo geral"

**Prós:**
- ✅ Garante dados válidos sempre
- ✅ Sistema continua funcionando
- ✅ Melhor que falhar totalmente

**Contras:**
- ⚠️ Dados podem ser imprecisos
- ⚠️ Mascara problema real
- ⚠️ Usuário pode ver estrutura artificial

#### **Opção 2C: Rechunking Inteligente**
**Descrição:** Evitar quebrar conteúdo de disciplina entre chunks

**Implementação:**
- Analisar texto antes de dividir
- Identificar marcadores: "DISCIPLINA:", "MATÉRIA:", etc
- Garantir que chunk termine após seção completa
- Passar contexto mais rico entre chunks

**Prós:**
- ✅ Resolve problema de fragmentação
- ✅ Claude terá contexto completo de cada disciplina
- ✅ Melhor qualidade de extração

**Contras:**
- ⚠️ Complexidade alta
- ⚠️ Pode gerar chunks desbalanceados
- ⚠️ Difícil implementar para textos sem estrutura clara

**RECOMENDAÇÃO:** **2A + 2B** (prompt melhor + correção automática como rede de segurança)

---

### **SOLUÇÃO 3: Corrigir Contagem de Questões**

#### **Opção 3A: Adicionar Instrução Explícita no Prompt**
**Descrição:** Destacar importância de `numeroQuestoes`

**Implementação:**
```
CAMPO CRÍTICO: numeroQuestoes

Para cada disciplina, você DEVE identificar e preencher:
- numeroQuestoes: número de questões desta disciplina na prova

Exemplo:
"Língua Portuguesa: 20 questões" → numeroQuestoes: 20
"Matemática (15 questões)" → numeroQuestoes: 15

Se não especificado: calcule proporcionalmente ao conteúdo
NUNCA deixe numeroQuestoes como 0 ou null
```

**Prós:**
- ✅ Instrução clara e exemplificada
- ✅ Fornece estratégia de fallback
- ✅ Previne zeros

**Contras:**
- ⚠️ Cálculo proporcional pode ser impreciso
- ⚠️ Claude pode não encontrar a informação

#### **Opção 3B: Validação Pós-Processamento**
**Descrição:** Distribuir questões proporcionalmente se todas forem 0

**Implementação:**
```typescript
if (somaDisciplinas === 0 && totalProva > 0) {
  // Distribuir igualmente
  const questaoesPorDisciplina = Math.floor(totalProva / numDisciplinas);
  disciplinas.forEach(d => d.numeroQuestoes = questaoesPorDisciplina);
}
```

**Prós:**
- ✅ Garante dados minimamente úteis
- ✅ Melhor que zeros
- ✅ Sistema continua funcionando

**Contras:**
- ⚠️ Distribuição artificial
- ⚠️ Não reflete realidade do edital
- ⚠️ Pode prejudicar plano de estudos

#### **Opção 3C: Validação Rigorosa + Reprocessamento**
**Descrição:** Se questões = 0, reprocessar apenas seção relevante

**Implementação:**
- Detectar `numeroQuestoes: 0` em todas disciplinas
- Extrair do texto original a seção "DISTRIBUIÇÃO DE QUESTÕES"
- Fazer chamada específica ao Claude só para extrair números
- Fazer merge com resultado anterior

**Prós:**
- ✅ Dados precisos
- ✅ Não inventa informação
- ✅ Ataca problema específico

**Contras:**
- ⚠️ Chamada extra à API
- ⚠️ Mais tempo de processamento
- ⚠️ Complexidade na implementação

**RECOMENDAÇÃO:** **3A + 3B** (prompt melhor + distribuição como último recurso)

---

### **SOLUÇÃO 4: Melhorar Merge de Chunks**

#### **Opção 4A: Estratégia de Merge por Seção**
**Descrição:** Cada chunk identifica qual seção está processando

**Implementação:**
```
INSTRUÇÃO PARA CHUNKS:

Se este é um chunk parcial:
1. Identifique qual seção você está processando:
   - "metadata" (informações gerais)
   - "disciplinas-parte-1" (primeiras disciplinas)
   - "disciplinas-parte-2" (disciplinas finais)
   - "provas" (detalhes das provas)

2. No JSON, adicione campo:
   "chunkInfo": {
     "isPartial": true,
     "section": "disciplinas-parte-1"
   }
```

**Prós:**
- ✅ Merge mais inteligente
- ✅ Evita duplicação
- ✅ Preserva contexto

**Contras:**
- ⚠️ Claude precisa entender conceito de chunk
- ⚠️ Lógica de merge mais complexa

#### **Opção 4B: Validação de Unicidade de Concurso**
**Descrição:** Garantir que chunks do mesmo concurso sejam mergeados

**Implementação:**
- Comparar `metadata.title` entre chunks
- Se títulos similares (>80% match): merge
- Se diferentes: concursos separados
- Usar disciplinas.concat() com deduplicação

**Prós:**
- ✅ Previne duplicação
- ✅ Funciona mesmo se Claude não colaborar
- ✅ Robusto

**Contras:**
- ⚠️ Comparação de strings pode falhar
- ⚠️ Pode mergear concursos diferentes acidentalmente

#### **Opção 4C: Contexto Compartilhado Expandido**
**Descrição:** Passar mais informação entre chunks

**Implementação:**
```typescript
const sharedContext = {
  concursoTitle: extractedTitle,
  disciplinasJaProcessadas: [...disciplinas],
  metadataCompleto: {...metadata},
  totalQuesoesEsperadas: 100
};
```

**Prós:**
- ✅ Claude tem visão completa
- ✅ Pode evitar reprocessar
- ✅ Melhor continuidade

**Contras:**
- ⚠️ Aumenta tokens consumidos
- ⚠️ Pode confundir Claude com muita informação

**RECOMENDAÇÃO:** **4B + 4C** (validação de unicidade + contexto rico)

---

### **SOLUÇÃO 5: Problema do Markdown Wrapper**

#### **Opção 5A: Prompt com Instrução de Formato**
**Descrição:** Especificar que resposta deve ser JSON puro

**Implementação:**
```
FORMATO DE RESPOSTA OBRIGATÓRIO:

Retorne APENAS o JSON, sem markdown, sem explicações, sem code blocks.

❌ INCORRETO:
```json
{...}
```

✅ CORRETO:
{...}

Sua resposta deve começar com { e terminar com }
```

**Prós:**
- ✅ Ataca problema na raiz
- ✅ Reduz necessidade de parsing extra
- ✅ Mais eficiente

**Contras:**
- ⚠️ Claude pode ignorar
- ⚠️ Modelo pode ter comportamento padrão difícil de mudar

#### **Opção 5B: Melhorar Extração de Fallback**
**Descrição:** Tornar sistema de extração mais robusto

**Implementação:**
- Estratégia 1: Remover ```json e ```
- Estratégia 2: Regex para extrair objeto entre { }
- Estratégia 3: Buscar primeiro { e último }
- Estratégia 4: Tentar parse linha por linha
- Log detalhado de qual estratégia funcionou

**Prós:**
- ✅ Já está parcialmente implementado
- ✅ Funciona como rede de segurança
- ✅ Sem dependência de Claude

**Contras:**
- ⚠️ Mais código para manter
- ⚠️ Pode mascarar outros problemas

#### **Opção 5C: Usar Parâmetro de API Específico**
**Descrição:** Verificar se Anthropic API tem parâmetro para formato de resposta

**Implementação:**
```typescript
const response = await anthropic.messages.create({
  // ...
  response_format: { type: "json_object" } // Se disponível
});
```

**Prós:**
- ✅ Solução nativa
- ✅ Sem parsing extra
- ✅ Garantido pela API

**Contras:**
- ⚠️ Pode não estar disponível para Claude
- ⚠️ Precisa verificar documentação

**RECOMENDAÇÃO:** **5A + 5B** (já funciona, mas melhorar prompt para reduzir necessidade)

---

## 🔧 PLANO DE AÇÃO PRIORITIZADO

### **FASE 1: Quick Wins (Impacto Imediato)** 🚨

1. **Melhorar Prompt - Formato de Data**
   - Adicionar seção específica sobre datas
   - Incluir exemplos CORRETOS e INCORRETOS
   - Tempo: 30min
   - Impacto: Alto

2. **Adicionar Zod Transform para Datas**
   - Criar função `normalizeDateToISO()`
   - Testar com formatos: DD/MM/YYYY, DD-MM-YYYY, texto
   - Integrar no schema
   - Tempo: 1h
   - Impacto: Alto

3. **Melhorar Prompt - Disciplinas e Matérias**
   - Especificar hierarquia obrigatória
   - Adicionar regra: "mínimo 1 matéria por disciplina"
   - Fornecer fallback explícito
   - Tempo: 30min
   - Impacto: Alto

### **FASE 2: Correções Robustas** 💪

4. **Implementar Correção Automática de Disciplinas Vazias**
   - Detectar `materias: []`
   - Criar matéria genérica automaticamente
   - Log de correções aplicadas
   - Tempo: 1.5h
   - Impacto: Médio-Alto

5. **Melhorar Prompt - Contagem de Questões**
   - Destacar campo `numeroQuestoes`
   - Dar exemplos de onde encontrar
   - Estratégia de cálculo proporcional
   - Tempo: 30min
   - Impacto: Alto

6. **Validação e Distribuição de Questões**
   - Detectar soma = 0
   - Distribuir proporcionalmente como fallback
   - Tempo: 1h
   - Impacto: Médio

### **FASE 3: Otimizações de Chunking** 🧩

7. **Implementar Validação de Unicidade de Concurso**
   - Comparar títulos entre chunks
   - Merge inteligente por similaridade
   - Deduplicação de disciplinas
   - Tempo: 2h
   - Impacto: Alto

8. **Expandir Contexto Compartilhado**
   - Passar metadata completo
   - Lista de disciplinas já processadas
   - Informações de validação
   - Tempo: 1h
   - Impacto: Médio

### **FASE 4: Validação e Monitoramento** 📊

9. **Criar Testes E2E com Dados Reais**
   - Usar texto de edital real (não mock)
   - Testar chunking completo
   - Validar cada etapa
   - Tempo: 2h
   - Impacto: Alto (previne regressões)

10. **Dashboard de Qualidade dos Dados**
    - Endpoint para inspecionar JSON gerado
    - Métricas: campos vazios, validações falhas
    - Comparação antes/depois
    - Tempo: 3h
    - Impacto: Médio (facilita debug)

---

## 📈 MÉTRICAS DE SUCESSO

### **Antes (Situação Atual):**
- ❌ Validação: 0% de sucesso
- ❌ Integridade: FALHOU
- ❌ Campos vazios: 100% disciplinas sem questões
- ❌ Dados utilizáveis: 0%

### **Depois (Meta):**
- ✅ Validação: 95%+ de sucesso
- ✅ Integridade: PASSOU
- ✅ Campos preenchidos: 100%
- ✅ Dados utilizáveis: 95%+
- ✅ Tempo processamento: < 4min (meta: -30%)

---

## 🧪 ESTRATÉGIA DE TESTE

### **1. Teste Unitário de Transformações**
```typescript
describe('Date Normalization', () => {
  test('DD/MM/YYYY → YYYY-MM-DD', () => {
    expect(normalizeDateToISO('15/01/2025')).toBe('2025-01-15');
  });
  
  test('DD-MM-YYYY → YYYY-MM-DD', () => {
    expect(normalizeDateToISO('15-01-2025')).toBe('2025-01-15');
  });
  
  test('Texto → YYYY-MM-DD', () => {
    expect(normalizeDateToISO('15 de janeiro de 2025')).toBe('2025-01-15');
  });
});
```

### **2. Teste de Integração com Claude Real**
- Usar documento de teste fixo
- Processar com novo prompt
- Validar 100% dos campos
- Comparar com baseline

### **3. Teste de Regressão**
- Garantir que E2E continua passando
- Validar que mudanças não quebram casos que já funcionavam

---

## 🎯 PRÓXIMOS PASSOS IMEDIATOS

1. ✅ **Ler código atual do prompt** (src/core/services/editais/)
2. ✅ **Ler schema Zod** para entender validações
3. ✅ **Ler lógica de chunking** e merge
4. ✅ **Implementar Fase 1** (Quick Wins)
5. ✅ **Testar com log real** (mesmo documento que falhou)
6. ✅ **Comparar resultados** antes/depois
7. ✅ **Documentar melhorias** observadas
8. ✅ **Iterar nas Fases 2-4**

---

## 📝 NOTAS IMPORTANTES

### **Por que E2E passa mas produção falha:**

1. **E2E usa mocks/fixtures** com dados já no formato correto
2. **E2E não testa Claude real** (resposta mockada)
3. **E2E pode não testar chunking** (documento pequeno)
4. **Prompt em produção pode ser diferente** do usado em dev

### **Ações para alinhar E2E e Produção:**

- Criar teste E2E com Claude real
- Usar documento de edital real completo
- Forçar chunking mesmo em documentos menores
- Validar TODAS as etapas do pipeline

### **Filosofia da Solução:**

> "Confiar na IA mas validar agressivamente"

- ✅ Dar instruções claras (prompts melhores)
- ✅ Fornecer exemplos (few-shot learning)
- ✅ Validar outputs (Zod + validações custom)
- ✅ Corrigir automaticamente quando possível (transforms)
- ✅ Falhar graciosamente quando necessário (fallbacks)

---

## 🔗 ARQUIVOS RELEVANTES PARA MODIFICAR

1. **Prompt do Claude:**
   - Localização provável: `src/core/services/editais/prompts.ts` ou similar
   - Modificar: seções de data, disciplinas, questões

2. **Schema Zod:**
   - Localização: `src/core/services/editais/schemas.ts` ou similar
   - Adicionar: `.transform()` para datas

3. **Serviço de Processamento:**
   - `src/core/services/editais/edital-process.service.ts`
   - Linha 696: `JSON.parse()` que falha
   - Melhorar: lógica de merge de chunks

4. **Validação:**
   - Adicionar: correção automática pós-validação
   - Log: campos corrigidos automaticamente

---

**Status:** 📋 Documento de debug completo  
**Próximo passo:** Ler código atual e começar implementação Fase 1
