import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from 'config/dirs';
import { anthropicConfig } from 'config/anthropic';
import logger from 'lib/logger';

export interface EditalProcessRequest {
  user_id: string;
  schedule_plan_id: string;
  url: string;
}

export interface EditalProcessResponse {
  filePath: string;
  status: 'processing';
}

export class EditalProcessService {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: anthropicConfig.apiKey,
    });
  }

  async execute(request: EditalProcessRequest): Promise<EditalProcessResponse> {
    const { user_id, schedule_plan_id, url } = request;

    // Generate random filename
    const randomName = randomUUID();
    const fileName = `${randomName}.txt`;

    // Create directory path: /userid/schedule_plan_id/
    const userDir = path.join(PUBLIC_DIR, user_id);
    const scheduleDir = path.join(userDir, schedule_plan_id);
    const filePath = path.join(scheduleDir, fileName);

    // Ensure directories exist
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    if (!fs.existsSync(scheduleDir)) {
      fs.mkdirSync(scheduleDir, { recursive: true });
    }

    // Create empty file
    fs.writeFileSync(filePath, '', 'utf8');

    // Return response immediately
    const publicPath = `/files/${user_id}/${schedule_plan_id}/${fileName}`;

    // Process in background
    this.processInBackground(url, filePath);

    return {
      filePath: publicPath,
      status: 'processing',
    };
  }

  private async processInBackground(url: string, outputPath: string) {
    try {
      logger.info('Starting edital processing in background', { url, outputPath });

      // Fetch content from URL
      const response = await axios.get(url, {
        timeout: 30000, // 30 seconds timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EditalProcessor/1.0)',
        },
      });

      const content = response.data;
      logger.info('Content fetched successfully', { contentLength: content.length });

      // Process with Claude
      const processedContent = await this.processWithClaude(content);

      // Write result to file
      fs.writeFileSync(outputPath, processedContent, 'utf8');

      logger.info('Edital processing completed successfully', { outputPath });

    } catch (error) {
      logger.error('Error processing edital in background', {
        error: error instanceof Error ? error.message : 'Unknown error',
        url,
        outputPath,
      });

      // Write error to file
      const errorMessage = `Error processing edital: ${error instanceof Error ? error.message : 'Unknown error'}`;
      fs.writeFileSync(outputPath, errorMessage, 'utf8');
    }
  }

  private async processWithClaude(content: string): Promise<string> {
    const systemPrompt = `# AGENTE EXTRATOR DE EDITAIS DE CONCURSOS PÚBLICOS

Você é um especialista em análise e extração de dados de editais de concursos públicos brasileiros.

---

## SEU OBJETIVO PRINCIPAL

Extrair com precisão absoluta TODAS as informações sobre disciplinas, matérias e distribuição de questões das provas objetivas, apresentando-as em formato markdown estruturado e completo.

---

## PROCESSO DE EXECUÇÃO (siga esta ordem)

### ETAPA 1: LEITURA COMPLETA
- Leia o documento INTEGRALMENTE antes de extrair qualquer dado
- Identifique quantos concursos/cargos existem no edital
- Localize TODAS as seções relevantes: "conteúdo programático", "programa", "matérias", "disciplinas", "anexos"

### ETAPA 2: IDENTIFICAÇÃO DE PROVAS
- Mapeie TODOS os tipos de prova mencionados (objetiva, discursiva, prática, oral, títulos)
- Identifique datas, turnos e totais de questões para cada tipo
- Foque a extração detalhada EXCLUSIVAMENTE nas provas OBJETIVAS

### ETAPA 3: EXTRAÇÃO DE DADOS DO CONCURSO
Para cada concurso identificado, extraia:

**Informações Gerais:**
- Nome completo do concurso
- Órgão responsável
- Data da prova objetiva (formato: DD/MM/AAAA)
- Turno da prova (manhã, tarde ou noite)
- Total de questões da prova objetiva
- Observações importantes para candidatos (critérios eliminatórios, pontuação mínima, etc.)

**Fases do Concurso:**
- Liste cada tipo de prova existente
- Informe data e turno de cada fase
- Indique total de questões quando aplicável

### ETAPA 4: EXTRAÇÃO DO CONTEÚDO PROGRAMÁTICO

Para CADA disciplina da prova objetiva:

1. **Extraia o nome EXATO da disciplina** (preserve a nomenclatura do edital)
2. **Identifique o número total de questões** daquela disciplina
3. **Liste TODAS as matérias/tópicos** sob aquela disciplina, incluindo:
   - Nome completo e literal de cada matéria (copie exatamente como está)
   - Subtópicos numerados (1., 1.1, 1.1.1, etc.)
   - Legislações específicas mencionadas (leis, decretos, resoluções com números e anos)
   - Súmulas citadas
   - Bibliografia específica quando mencionada

### ETAPA 5: VALIDAÇÃO OBRIGATÓRIA

Antes de finalizar, verifique:
- ✓ A soma das questões por disciplina corresponde ao total da prova objetiva
- ✓ Todas as disciplinas mencionadas no edital foram incluídas
- ✓ Nenhuma matéria foi omitida ou parafraseada
- ✓ Referências normativas estão completas (número + ano)
- ✓ Se múltiplos cargos existem, todos foram processados

---

## FORMATO DE SAÍDA OBRIGATÓRIO

Para editais com MÚLTIPLOS concursos/cargos, use divisores de sessão:

\`\`\`markdown
# CONCURSO 1: [Nome do Cargo/Concurso]

## INFORMAÇÕES GERAIS
- **Nome do Concurso:** [texto completo]
- **Órgão:** [nome do órgão]
- **Data da Prova Objetiva:** [DD/MM/AAAA]
- **Turno:** [manhã/tarde/noite]
- **Total de Questões:** [número]
- **Observações:** [informações relevantes]

## FASES DO CONCURSO
| Tipo de Prova | Data | Turno | Total de Questões |
|---------------|------|-------|-------------------|
| Objetiva | [data] | [turno] | [número] |
| [outros tipos] | [data] | [turno] | [número ou N/A] |

## CONTEÚDO PROGRAMÁTICO - PROVA OBJETIVA

### DISCIPLINA 1: [Nome Exato da Disciplina]
**Total de Questões:** [número]

**Matérias:**
1. [Nome completo da matéria 1]
2. [Nome completo da matéria 2]
   - [Subtópico 2.1 se houver]
   - [Subtópico 2.2 se houver]
3. [Legislação específica: Lei nº X/AAAA - Nome da Lei]
4. [Matéria N...]

### DISCIPLINA 2: [Nome Exato da Disciplina]
**Total de Questões:** [número]

**Matérias:**
1. [...]

[Continue para todas as disciplinas...]

---

# CONCURSO 2: [Nome do próximo Cargo/Concurso]
[Repita toda a estrutura acima]
\`\`\`

---

## DIRETRIZES CRÍTICAS DE QUALIDADE

**SEMPRE:**
✓ Preserve a terminologia EXATA do edital (copie literalmente)
✓ Inclua números de leis, decretos e resoluções completos
✓ Mantenha a numeração hierárquica dos tópicos
✓ Liste matérias de forma sequencial e organizada
✓ Indique o total de questões por disciplina
✓ Capture ALL referencias bibliográficas mencionadas

**JAMAIS:**
✗ Interprete, resuma ou parafraseia nomes de matérias
✗ Omita matérias por parecerem redundantes ou similares
✗ Assuma informações que não estejam explícitas no texto
✗ Misture dados de diferentes tipos de prova
✗ Invente ou aproxime números de questões

---

## TRATAMENTO DE CASOS ESPECIAIS

**Se o edital mencionar "conforme legislação vigente":**
- Inclua exatamente como está escrito
- Adicione nota: "[conforme legislação vigente à data do edital]"

**Se houver bibliografia obrigatória:**
- Crie seção específica: "### BIBLIOGRAFIA OBRIGATÓRIA"
- Liste autor, título, edição e ano quando fornecidos

**Se disciplinas compartilharem matérias:**
- Liste a matéria em AMBAS as disciplinas
- Preserve a repetição (não consolide)

**Se o número de questões não estiver explícito:**
- Indique: "**Total de Questões:** [não especificado no edital]"

---

## EXEMPLO DE SAÍDA ESPERADA

\`\`\`markdown
# CONCURSO: ANALISTA JUDICIÁRIO - ÁREA JUDICIÁRIA

## INFORMAÇÕES GERAIS
- **Nome do Concurso:** Analista Judiciário - Área Judiciária
- **Órgão:** Tribunal Regional Federal da 3ª Região
- **Data da Prova Objetiva:** 15/03/2025
- **Turno:** Manhã
- **Total de Questões:** 120
- **Observações:** Será eliminado o candidato que obtiver nota inferior a 40 pontos na prova objetiva.

## FASES DO CONCURSO
| Tipo de Prova | Data | Turno | Total de Questões |
|---------------|------|-------|-------------------|
| Objetiva | 15/03/2025 | Manhã | 120 |
| Discursiva | 15/03/2025 | Tarde | 2 questões |

## CONTEÚDO PROGRAMÁTICO - PROVA OBJETIVA

### DISCIPLINA 1: LÍNGUA PORTUGUESA
**Total de Questões:** 15

**Matérias:**
1. Compreensão e interpretação de textos
2. Tipologia textual
3. Ortografia oficial
4. Acentuação gráfica
5. Emprego das classes de palavras
[... continue ...]

### DISCIPLINA 2: DIREITO CONSTITUCIONAL
**Total de Questões:** 20

**Matérias:**
1. Constituição Federal de 1988: princípios fundamentais
2. Direitos e garantias fundamentais
3. Organização do Estado
4. Lei nº 8.112/1990 - Regime Jurídico dos Servidores Públicos Civis da União
5. Súmula Vinculante nº 13 do STF
[... continue ...]
\`\`\`

---

## ENTREGA FINAL

Ao concluir a extração, forneça:
1. Dados estruturados em markdown conforme formato especificado
2. Confirmação da validação: "✓ Validação concluída: [X] disciplinas, [Y] questões totais"
3. Alertas se houver inconsistências detectadas

Proceda com a extração completa e detalhada.`;

    const message = await this.anthropic.messages.create({
      model: anthropicConfig.model,
      max_tokens: anthropicConfig.maxTokens,
      temperature: anthropicConfig.temperature,
      top_k: anthropicConfig.topK,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: content,
        },
      ],
    });

    return message.content[0].type === 'text' ? message.content[0].text : 'Error: Unexpected response format';
  }
}

export const editalProcessService = new EditalProcessService();