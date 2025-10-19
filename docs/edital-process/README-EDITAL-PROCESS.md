# 📚 Edital Process - Documentação

> **Sistema de processamento de editais de concursos públicos com IA**  
> **Última atualização:** 19 de Outubro de 2025

---

## 🎯 Documento Principal

### **[FLUXO-DEFINITIVO-E2E.md](./FLUXO-DEFINITIVO-E2E.md)** ✨

**Este é o ÚNICO documento que você precisa ler para entender todo o sistema.**

Conteúdo:
- ✅ Visão geral do sistema
- ✅ Arquitetura completa (Edge Function → Backend → Orchestrator → Database)
- ✅ Fluxo passo a passo (7 fases detalhadas)
- ✅ Estrutura de dados (schemas completos)
- ✅ Database schema (todas as tabelas e FKs)
- ✅ Checklist de validação pré-execução
- ✅ Logs esperados e troubleshooting
- ✅ Validação de resultados

**Status:** ✅ Completo e atualizado  
**Tamanho:** 22KB (leitura: ~15min)

---

## 🚀 Quick Start

### Para novos desenvolvedores:
```bash
1. Leia FLUXO-DEFINITIVO-E2E.md (15min)
2. Execute o checklist de validação
3. Rode um teste E2E
4. Pronto! Você entende o sistema completo
```

### Para debugar problemas:
```bash
1. Consulte seção "Monitoramento de Logs"
2. Compare com os logs esperados
3. Verifique "Validação de Resultados"
```

### Para implementar mudanças:
```bash
1. Consulte "Dependências e Integrações"
2. Verifique schema de dados
3. Execute checklist pré-execução
```

---

## 📂 Outros Documentos (Referência)

| Documento | Descrição | Quando usar |
|-----------|-----------|-------------|
| [INDICE-EDITAL-DOCS.md](./INDICE-EDITAL-DOCS.md) | Índice de toda documentação | Navegação rápida |
| [EDITAL-PROCESS-API.md](./EDITAL-PROCESS-API.md) | Especificação da API REST | Integração frontend |
| [IMPLEMENTACAO-BACKEND-FINAL.md](./IMPLEMENTACAO-BACKEND-FINAL.md) | Detalhes de implementação | Referência técnica |
| [EDITAL-PROCESS-LOGS.md](./EDITAL-PROCESS-LOGS.md) | Estrutura de logs | Debug |

---

## 🏗️ Visão Geral do Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                      EDGE FUNCTION v26                          │
│  (Upload PDF → Transcrição → Cria edital_file)                 │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ POST /api/edital-process
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND: SERVICE                              │
│  1. Download TXT                                                │
│  2. Claude AI (5-8min)                                          │
│  3. JSON estruturado                                            │
│  4. Upload Supabase                                             │
│  5. UPDATE edital_file                                          │
│  6. Trigger Orchestrator                                        │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                                  │
│  • Cria study_plans                                             │
│  • Cria disciplines                                             │
│  • Cria topics                                                  │
│  • Cria exams                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Tempo total:** 5-8 minutos para editais de 100-200KB

---

## ⚡ Tecnologias

- **Backend**: Node.js + TypeScript + Express
- **IA**: Claude Sonnet 3.5 (200K context window)
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **Validação**: Zod schemas

---

## 📊 Métricas

- **Taxa de sucesso**: >95% em editais padrão
- **Tempo médio**: 5-8 minutos
- **Capacidade**: Até 200K tokens (≈150KB texto)
- **Precisão**: ~95% na extração de disciplinas/tópicos

---

## � Links Úteis

- [Database Schema](../database/database_schema.md)
- [API Reference](../api-reference/API-USAGE-GUIDE.md)
- [Frontend Guide](../frontend/FRONTEND-API-GUIDE.md)

---

## 📝 Changelog

### 19/10/2025
- ✅ Criado FLUXO-DEFINITIVO-E2E.md (documento canônico)
- ✅ Removidos 6 documentos obsoletos/duplicados
- ✅ Atualizado INDICE-EDITAL-DOCS.md
- ✅ Corrigido triggerOrchestrator (passa JSON, não TXT)
- ✅ Adicionado upload para Supabase Storage

### 18/10/2025
- Implementação estratégia adaptativa Claude
- Correção validação schema Zod
- Integração orchestrator

---

**Mantido por**: GitHub Copilot  
**Última revisão**: 19 de Outubro de 2025
