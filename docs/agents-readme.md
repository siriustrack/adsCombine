# Orquestra de Agentes IA para Criação de Planos de Estudo

## Visão Geral
Esta implementação cria uma orquestra de agentes IA usando OpenAI GPT-4o para extrair e estruturar planos de estudo de editais de concursos públicos com 100% de precisão, integrando com Supabase para persistência.

## Arquitetura
- **Pre-Orquestrador**: Recebe input e inicia o fluxo.
- **Agente Identificador**: Usa GPT-4o com structured output para parsear o conteúdo e extrair dados estruturados.
- **Agente Orquestrador**: Coordena a inserção no banco de dados (study_plans, exams, disciplines, topics).
- **Agente Verificador**: Valida a criação comparando com o input original e finaliza o plano.

## Modelos OpenAI
- **Modelo Principal**: GPT-4o (para precisão e velocidade em tarefas estruturadas).
- **Configuração**: Temperature 0.1, maxTokens 2000, responseFormat JSON para garantir output consistente.
- **Precisão**: Prompts engenheirados com exemplos, validações rigorosas no código.

## Como Usar
1. Configure variáveis de ambiente (veja .env.example).
2. Instale dependências: `bun install`.
3. Execute o teste: `npx ts-node src/agents/test.ts`.

## Estrutura de Código
- `/src/agents/`: Agentes e tipos.
- `/src/config/`: Configurações de OpenAI e Supabase.

## Validações para 100% Precisão
- Structured output do OpenAI força JSON válido.
- Validações de tipos e constraints no código.
- Comparação exata com input original no verificador.
- Logs detalhados para auditoria.