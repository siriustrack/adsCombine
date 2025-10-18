# Debug Report - Uso do Zod na Plataforma

**Data**: 14 de Outubro de 2025
**Status**: ⚠️ Problemas Identificados

## 📋 Sumário Executivo

Foram identificados **5 problemas críticos** no uso do Zod na plataforma:

1. ❌ Import inconsistente no `env.ts` (default vs named export)
2. ❌ Método `.loose()` não existe no Zod v3.25+ (deprecado)
3. ❌ Método `z.url()` não existe, deve usar `z.string().url()`
4. ⚠️ Versão do Zod inconsistente (package.json vs instalado)
5. ⚠️ Tratamento de erros de validação pode ser melhorado

---

## 🔍 Análise Detalhada

### 1. Problema: Import Inconsistente em `env.ts`

**Arquivo**: `src/config/env.ts`
**Linha**: 1

**Código Atual**:
```typescript
import z from 'zod';  // ❌ Default import
```

**Problema**: 
- O Zod v3.25+ não exporta um default export
- Outros arquivos usam `import { z } from 'zod'` (named import)
- Isso causa inconsistência e pode falhar em builds

**Impacto**: 🔴 CRÍTICO - O arquivo pode não funcionar em produção

**Solução**:
```typescript
import { z } from 'zod';  // ✅ Named import
```

---

### 2. Problema: Método `.loose()` Deprecado

**Arquivos Afetados**:
- `src/api/controllers/messages.controllers.ts` (linhas 7-13 e 22-28)

**Código Atual**:
```typescript
const FileInfoSchema = z
  .object({
    fileId: z.string(),
    url: z.string().url(),
    mimeType: z.string(),
  })
  .loose();  // ❌ Método não existe no Zod v3.25+
```

**Problema**:
- O método `.loose()` foi removido no Zod v3+
- Deve ser substituído por `.passthrough()` ou `.strip()` ou remover completamente

**Impacto**: 🔴 CRÍTICO - TypeScript error, código não compila

**Solução**:
```typescript
const FileInfoSchema = z
  .object({
    fileId: z.string(),
    url: z.string().url(),
    mimeType: z.string(),
  })
  .passthrough();  // ✅ Permite propriedades extras
  
// OU simplesmente remover se não precisa de propriedades extras:
const FileInfoSchema = z.object({
  fileId: z.string(),
  url: z.string().url(),
  mimeType: z.string(),
});  // ✅ Modo strict por padrão
```

---

### 3. Problema: `z.url()` Não Existe

**Arquivos Afetados**:
- `src/api/controllers/videos.controllers.ts` (linhas 22 e 36)

**Código Atual**:
```typescript
videos: z
  .array(
    z.object({
      url: z.url('Invalid video URL'),  // ❌ z.url não existe
    })
  )
```

**Problema**:
- No Zod, não existe `z.url()`
- O correto é `z.string().url()`

**Impacto**: 🔴 CRÍTICO - TypeScript error, código não compila

**Solução**:
```typescript
videos: z
  .array(
    z.object({
      url: z.string().url('Invalid video URL'),  // ✅ Correto
    })
  )
```

---

### 4. Problema: Versão do Zod Inconsistente

**Encontrado**:
- `package.json`: `"zod": "^3.23.8"`
- `node_modules`: `zod@3.25.76`

**Problema**:
- A versão instalada é mais recente que a especificada
- Pode haver breaking changes entre 3.23 e 3.25

**Impacto**: 🟡 MÉDIO - Pode causar comportamentos inesperados

**Solução**:
```bash
# Atualizar package.json para versão específica
npm install zod@^3.25.76 --save-exact
```

---

### 5. Análise: Uso de `.parse()` vs `.safeParse()`

**Arquivos que usam `.parse()`**:
1. `src/config/env.ts` - ✅ OK (deve falhar se env inválido)
2. `src/core/services/editais/edital-process.service.ts` - ⚠️ Pode melhorar
3. `src/api/controllers/videos.controllers.ts` - ⚠️ Não tem try/catch

**Recomendação**:
- ✅ **Use `.parse()`**: Quando DEVE falhar (ex: variáveis de ambiente)
- ✅ **Use `.safeParse()`**: Quando quer tratar erros de forma customizada
- ✅ **Use `.parseAsync()`**: Para validações assíncronas

**Exemplo Atual (Bom)**:
```typescript
// src/api/controllers/editais.controllers.ts
const { value: body, error } = await wrapPromiseResult<EditalProcessBody, ZodError>(
  EditalProcessBodySchema.parseAsync(req.body)  // ✅ Usa parseAsync
);

if (error) {
  logger.error('Validation error', { errors: error.issues });
  return res.status(400).json({ error: 'Invalid request body', details: error.issues });
}
```

**Exemplo que Precisa Melhorar**:
```typescript
// src/api/controllers/videos.controllers.ts
export class VideosController {
  createVideoHandler = async (req: Request, res: Response) => {
    const data = VideoRequestSchema.parse(req.body);  // ⚠️ Não tem try/catch
    // Se parse falhar, vai lançar exceção não tratada
```

---

## 🎯 Plano de Ação - Prioridades

### 🔴 URGENTE (Bloqueia Build)

1. **Corrigir import no `env.ts`**
   - Arquivo: `src/config/env.ts`
   - Mudança: `import z from 'zod'` → `import { z } from 'zod'`

2. **Remover `.loose()` no `messages.controllers.ts`**
   - Arquivo: `src/api/controllers/messages.controllers.ts`
   - Mudança: Substituir `.loose()` por `.passthrough()` ou remover

3. **Corrigir `z.url()` no `videos.controllers.ts`**
   - Arquivo: `src/api/controllers/videos.controllers.ts`
   - Mudança: `z.url()` → `z.string().url()`

### 🟡 IMPORTANTE (Melhoria de Código)

4. **Adicionar try/catch em `videos.controllers.ts`**
   - Proteger `.parse()` com tratamento de erro adequado

5. **Atualizar versão do Zod no package.json**
   - Alinhar com versão instalada

---

## 📊 Arquivos Analisados

### Arquivos com Zod:
1. ✅ `src/config/env.ts` - Precisa correção no import
2. ✅ `src/core/services/editais/edital-schema.ts` - OK
3. ⚠️ `src/core/services/editais/edital-process.service.ts` - OK com ressalvas
4. ⚠️ `src/api/controllers/editais.controllers.ts` - OK (bom padrão)
5. ❌ `src/api/controllers/messages.controllers.ts` - Precisa correção (.loose)
6. ❌ `src/api/controllers/videos.controllers.ts` - Precisa correção (z.url e try/catch)

### Schemas Definidos:
1. **EditalProcessadoSchema** - Schema complexo para validação de editais
   - ✅ Bem estruturado
   - ✅ Usa validações customizadas apropriadas
   - ✅ Tem mensagens de erro descritivas

2. **EditalProcessBodySchema** - Validação de request body
   - ✅ Usa `.parseAsync()` corretamente
   - ✅ Tem tratamento de erro adequado

3. **VideoRequestSchema** - Validação de vídeos
   - ❌ Usa `z.url()` incorretamente
   - ⚠️ Não tem tratamento de erro

4. **MessageSchema** - Validação de mensagens
   - ❌ Usa `.loose()` deprecado

---

## 🔧 Comandos para Testar

```bash
# 1. Verificar erros de TypeScript
npx tsc --noEmit

# 2. Verificar versão do Zod
npm list zod

# 3. Rodar testes após correções
npm test

# 4. Verificar lint
npm run lint
```

---

## 📚 Referências

- [Zod Documentation](https://zod.dev/)
- [Zod v3 Migration Guide](https://github.com/colinhacks/zod/releases/tag/v3.0.0)
- [Zod Best Practices](https://zod.dev/?id=basic-usage)

---

## ✅ Checklist de Correção

- [ ] Corrigir import em `env.ts`
- [ ] Remover `.loose()` em `messages.controllers.ts`
- [ ] Corrigir `z.url()` em `videos.controllers.ts`
- [ ] Adicionar try/catch em `videos.controllers.ts`
- [ ] Atualizar `package.json` com versão correta do Zod
- [ ] Rodar `npm install` após mudanças
- [ ] Rodar `npx tsc --noEmit` para verificar
- [ ] Rodar testes: `npm test`
- [ ] Commit com mensagem descritiva

---

**Última Atualização**: 14 de Outubro de 2025
