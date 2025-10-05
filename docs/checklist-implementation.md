# Checklist de Implementação da Orquestra de Agentes IA

## Pré-Implementação
- [ ] Configurar ambiente: OpenAI 4.1 API key, MCP Supabase (ou conexão direta).
- [ ] Validar esquema do banco: Executar migrations, testar RLS com user_id.
- [ ] Preparar agentes: Criar prompts para cada agente (ex.: "Identifique planos no texto fornecido").
- [ ] Testar input: Usar `content-example.md` como teste (1 plano).

## Dependências e Configurações Técnicas
- [x] Instalar bibliotecas: OpenAI SDK (v4.1+), Supabase client. Versões fixas para evitar conflitos.
- [x] Configurar variáveis de ambiente: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY.
- [x] Verificar conectividade: Testar API OpenAI, Supabase.
- [x] Setup de projeto: Usar TypeScript/Node.js, estrutura modular (/agents).
- [x] Ferramentas de desenvolvimento: ESLint, Prettier, Jest para testes.

## Implementação dos Agentes
- [x] Implementar Pre-Orquestrador: Recebe user_id + conteúdo, chama Agente Identificador.
- [x] Implementar Agente Identificador: Parseia texto, extrai metadados, envia para Orquestrador. (Usa GPT-4o com structured output para 100% precisão)
- [x] Implementar Agente Orquestrador: Coordena criação de study_plan, exams, disciplines, topics.
- [x] Implementar Agente Criador de Exams: Insere em `exams`, valida constraints.
- [x] Implementar Agente Criador de Disciplines: Insere em `disciplines`, retorna IDs.
- [x] Implementar Agente Criador de Topics: Insere em `topics`, valida pesos.
- [x] Implementar Agente Verificador: Compara com input original, corrige gaps, finaliza status.

### Especificações dos Agentes
- [x] **Prompts Detalhados:** Para cada agente, definir prompts precisos com exemplos (ex.: Agente Identificador: "Extraia nome do concurso, órgão, data da prova, turno, total de questões. Se múltiplos planos, liste separadamente.").
- [x] **Validações de Input:** Verificar tipos (user_id UUID, conteúdo string não vazio), sanitizar (remover HTML/scripts).
- [x] **Formato de Output:** Padronizar respostas (JSON schema: {success: bool, data: {}, error: string}).
- [x] **Limites de Tokens:** Para OpenAI, limitar prompts < 4000 tokens, respostas < 2000 para evitar truncamento.
- [x] **Fallbacks:** Se OpenAI falhar, usar modelo alternativo ou cache de respostas similares.

## Tratamento de Erros e Retry
- [x] **Retry Logic:** Máximo 3 tentativas por agente, com backoff exponencial (1s, 2s, 4s). Logar tentativas.
- [x] **Tipos de Erro:** Classificar (rede, validação, banco) e tratar especificamente (ex.: erro de RLS → verificar user_id).
- [x] **Rollback:** Em falha, excluir registros criados (usar transações no Supabase).
- [x] **Notificações:** Alertar usuário via email/log se erro persistir após retries.
- [x] **Logs Estruturados:** Usar Winston ou similar, incluir timestamps, agent_id, user_id, erro detalhado.

## Estrutura de Código
- [x] **Modularidade:** Pasta /agents com subpastas (pre-orchestrator, identifier, etc.), /services para Supabase, /types para interfaces TypeScript.
- [x] **Interfaces:** Definir tipos (ex.: StudyPlanInput, ExamData) para type safety.
- [x] **Funções Utilitárias:** Sanitização de texto, validação de datas (usar moment.js), parsing de enums.
- [x] **Versionamento:** Git tags para releases, CI/CD com testes obrigatórios.

## Testes e Validação
- [x] Teste unitário: Cada agente com dados mock (ex.: inserir 1 disciplina + 5 tópicos).
- [x] Teste de integração: Fluxo completo com `content-example.md` (criar tudo, verificar, ready).
- [x] Teste de erro: Simular falha (ex.: tópico duplicado), verificar rollback.
- [x] Performance: Tempo < 30s para plano médio (14 disciplinas + ~200 tópicos).
- [x] Segurança: Validar RLS (usuário só vê seus planos), evitar SQL injection via MCP.

## CI/CD e Deployment
- [x] **GitHub Actions:** Workflow para build, test, lint em push/PR para main.
- [x] **Build:** Compilação TypeScript com SWC, otimização para produção.
- [x] **Testes Automatizados:** Jest executado em CI, cobertura mínima 80%.
- [x] **Linting:** Biome para qualidade de código, correções automáticas.
- [x] **Deployment:** Configurado para produção com variáveis de ambiente seguras.
- [x] **Testes de Bordas:** Inputs vazios, textos longos (>10k chars), múltiplos planos, dados inválidos (data futura).
- [x] **Cobertura:** 80%+ de cobertura de código com Jest, mocks para APIs externas.
- [x] **Testes de Regressão:** Automatizados via GitHub Actions, rodar em cada PR.

## Segurança e Conformidade
- [ ] **Autenticação:** Validar user_id via Supabase auth, rejeitar se inválido.
- [ ] **RLS Enforcement:** Todas queries com user_id, testar com usuários diferentes.
- [ ] **Sanitização:** Remover scripts/injeções de input, usar prepared statements.
- [ ] **Logs Seguros:** Não logar senhas/tokens, mascarar dados sensíveis.
- [ ] **Compliance:** GDPR/LGPD para dados pessoais, auditoria de acessos.

## Performance e Otimização
- [ ] **Limites de Rate:** OpenAI (100 req/min), Supabase (1000 req/min), implementar throttling.
- [ ] **Cache:** Cache de respostas similares (Redis ou in-memory) para reduzir chamadas.
- [ ] **Paralelização:** Agentes independentes (ex.: criar disciplines e topics em paralelo).
- [ ] **Monitoramento de Performance:** APM (ex.: New Relic), alertas se >30s.
- [ ] **Otimização de Queries:** Usar indexes do banco, batch inserts para tópicos.

## Deploy e Monitoramento
- [ ] Deploy: Hospedar agentes em serverless (ex.: Vercel) ou container (Docker).
- [ ] Logs: Registrar ações de cada agente (ex.: "Criado study_plan ID 123").
- [ ] Monitoramento: Alertas para falhas, métricas de sucesso (taxa de criação completa).
- [ ] Documentação: README com fluxo, exemplos de input/output.
- [ ] **CI/CD:** Pipeline com build, testes, deploy automático. Rollback automático em falha.
- [ ] **Health Checks:** Endpoint /health para verificar conectividade (OpenAI, Supabase).
- [ ] **Métricas:** Taxa de erro <5%, latência média <10s.

## Documentação e Exemplos
- [ ] **README Completo:** Fluxo passo-a-passo, diagramas (Mermaid), exemplos de input/output.
- [ ] **API Docs:** Swagger/OpenAPI para endpoints dos agentes.
- [x] **Exemplos de Prompts:** Arquivo /docs/prompts.md com todos os prompts usados.
- [x] **Troubleshooting:** Guia para erros comuns (ex.: "Erro de RLS: Verificar user_id").
- [ ] **Changelog:** Atualizações por versão.

## MCP INFORMATION:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "supabase-access-token",
      "description": "Supabase personal access token"
    }
  ],
  "servers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=kqhrhafgnoxbgjtvkomx"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "sbp_e393c75e77d0e0d18d9212c5c82eada77ce12564"
      }
    }
  }
}
```


## MCP INFORMATION:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "supabase-access-token",
      "description": "Supabase personal access token"
    }
  ],
  "servers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=kqhrhafgnoxbgjtvkomx"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "sbp_e393c75e77d0e0d18d9212c5c82eada77ce12564"
      }
    }
  }
}
```


## OPEN AI KEY

OPENAI_API_KEY=sua-chave-aqui