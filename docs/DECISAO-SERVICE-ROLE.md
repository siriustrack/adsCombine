# Decisão Arquitetural: service_role vs anon_key

**Data:** 13 de Outubro de 2025  
**Status:** ✅ DECIDIDO

---

## Contexto

O backend precisa acessar o Supabase para operações CRUD. Existem duas keys disponíveis:
1. **`anon_key`**: Pública, respeita RLS, requer autenticação do usuário
2. **`service_role`**: Privada, bypassa RLS, acesso administrativo total

## Decisão

**✅ Usar `service_role` no backend**

## Razões

### 1. **Controle Total no Backend**
- Backend pode implementar sua própria lógica de autorização
- Não depende de RLS do Supabase (que pode ser complexo de debugar)
- Permite operações administrativas quando necessário

### 2. **Testes E2E Simplificados**
- Não precisa mockar autenticação de usuário
- Não precisa passar JWT tokens nos testes
- Testes podem criar/deletar dados livremente

### 3. **Segurança Mantida**
- `service_role` key **NÃO é exposta** ao frontend
- Apenas o backend tem acesso
- Backend valida `userId` antes de qualquer operação

### 4. **Arquitetura Típica de Backend**
- Padrão em aplicações modernas (Node.js, Python, etc.)
- Backend é "trusted environment" com permissões administrativas
- Frontend usa APIs protegidas do backend

## Alternativa Rejeitada: `anon_key`

**Por que não usar `anon_key`?**

1. **Complexidade**: Requer passar JWT do usuário autenticado
2. **Testes**: E2E tests precisariam simular autenticação
3. **Limitações**: RLS pode bloquear operações legítimas do backend
4. **Dependência**: Backend fica dependente do sistema de auth do Supabase

## Implementação

```typescript
// src/config/supabase.ts
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
```

## Validação de Segurança

✅ **Backend valida userId**: Toda operação verifica se o userId é válido  
✅ **service_role não exposta**: Key só existe no backend (.env server-side)  
✅ **RLS opcional**: Podemos ativar RLS como camada extra de segurança  
✅ **Logs de auditoria**: Backend pode logar todas as operações  

## Casos de Uso

### Teste E2E
```typescript
// Sem autenticação, usa service_role diretamente
const result = await createStudyPlan({
  userId: TEST_USER_ID,
  content: editalJSON,
});
```

### API Backend
```typescript
// Backend valida JWT do frontend, extrai userId
app.post('/api/study-plan', authenticateJWT, async (req, res) => {
  const userId = req.user.id; // Extraído do JWT validado
  const result = await createStudyPlan({ userId, content: req.body });
  res.json(result);
});
```

## Revisão Futura

Se o projeto crescer e precisar de:
- Multi-tenancy complexo
- Permissões granulares por linha
- Compartilhamento de dados entre usuários

Então podemos **considerar RLS + anon_key**. Mas para o caso atual, `service_role` é mais simples e seguro.

---

**Decisão tomada por:** Paulo + Copilot  
**Próximos passos:** 
1. Obter `service_role` key do dashboard Supabase
2. Adicionar ao `.env`
3. Rodar testes E2E
