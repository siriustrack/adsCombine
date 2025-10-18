# Troubleshooting da Orquestra de Agentes

## Erros Comuns e Soluções

### 1. Erro de Validação de Input
**Sintomas:** "userId inválido", "Conteúdo inválido"
**Causa:** Input malformado ou vazio.
**Solução:** Verificar se userId é UUID válido, conteúdo é string não vazia <100k chars.

### 2. Erro de Rede (OpenAI)
**Sintomas:** Timeout, rate limit exceeded.
**Causa:** Problemas de conectividade ou quota excedida.
**Solução:** Sistema automaticamente tenta fallback para GPT-3.5-turbo. Verificar logs para detalhes.

### 3. Erro de Validação (Banco)
**Sintomas:** "Erro de RLS", constraint violation.
**Causa:** userId não autorizado ou dados duplicados.
**Solução:** Verificar se userId existe e tem permissões. Para RLS, confirmar autenticação no Supabase.

### 4. Erro de Parsing JSON
**Sintomas:** "Formato de resposta inválido"
**Causa:** OpenAI retornou texto não-JSON.
**Solução:** Prompt reforçado com structured output. Sistema tenta novamente com retry.

### 5. Falha na Verificação
**Sintomas:** "Contagem não corresponde"
**Causa:** Dados não inseridos corretamente no banco.
**Solução:** Verificar logs do orquestrator. Possível rollback manual se necessário.

### 6. Erro Geral
**Sintomas:** "Erro geral: [mensagem]"
**Causa:** Exceção não tratada.
**Solução:** Verificar logs estruturados em `logs/error.log` para stack trace completo.

## Monitoramento
- **Logs:** Arquivos em `/logs/` (error.log, combined.log).
- **Alertas:** Console errors para notificações críticas (ex.: falha persistente).
- **Métricas:** Implementar APM (New Relic) para latência >30s.

## Recuperação
- **Retry Automático:** Até 3 tentativas com backoff.
- **Rollback:** Exclusão de registros criados em falha.
- **Notificações:** Logs detalhados para intervenção manual.

## Prevenção
- Testes unitários e de integração obrigatórios.
- Validações rigorosas em todas as entradas.
- Limites de rate e tokens para evitar overload.