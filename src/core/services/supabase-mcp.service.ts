/**
 * Supabase MCP Wrapper
 * 
 * Este serviço encapsula a comunicação com o Supabase, permitindo
 * que os agentes IA executem SQL diretamente no banco de dados.
 * 
 * Usa as variáveis de ambiente configuradas no .env
 */

import { createClient } from '@supabase/supabase-js';
import logger from 'lib/logger';

interface ExecuteSQLParams {
  query: string;
}

interface ExecuteSQLResult {
  rows: any[];
  error?: string;
}

class SupabaseMCPService {
  private supabase;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    logger.info('[SUPABASE-MCP] Service initialized', {
      url: supabaseUrl,
      project_ref: process.env.SUPABASE_PROJECT_REF,
    });
  }

  /**
   * Executa SQL raw convertendo para operações do Supabase SDK
   * 
   * IMPORTANTE: Este método NÃO executa SQL diretamente. 
   * Ele extrai a tabela e operação do SQL e usa o SDK do Supabase.
   * Isso é necessário porque o Supabase não permite SQL raw via API.
   * 
   * Suporta:
   * - INSERT INTO table (...) VALUES (...) RETURNING *;
   * - INSERT INTO table (...) VALUES (...), (...), (...) RETURNING *;
   */
  async execute_sql({ query }: { query: string }): Promise<{ rows?: any[]; error?: string }> {
    try {
      logger.debug('[SUPABASE-MCP] Parsing SQL', {
        queryLength: query.length,
        queryPreview: query.substring(0, 100) + '...',
      });

      // Remover comentários SQL (-- comentário)
      const cleanQuery = query
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim();

      // Extrair operação e tabela
      const insertMatch = cleanQuery.match(/INSERT INTO\s+(\w+)\s*\(([\s\S]*?)\)\s*VALUES\s*([\s\S]*?);?$/i);
      
      if (!insertMatch) {
        throw new Error('SQL não suportado. Apenas INSERT é suportado nesta versão.');
      }

      const [, tableName, columnsStr, valuesStr] = insertMatch;
      
      // Extrair colunas
      const columns = columnsStr.split(',').map(c => c.trim());
      
      // Extrair valores (pode ser single ou multi-row)
      const valueRows = this.parseValuesClause(valuesStr);
      
      if (valueRows.length === 0) {
        throw new Error('Nenhum valor encontrado no INSERT');
      }

      // Converter para objetos
      const records = valueRows.map(values => {
        const record: Record<string, any> = {};
        columns.forEach((col, idx) => {
          const value = values[idx];
          record[col] = this.parseValue(value);
        });
        return record;
      });

      logger.debug('[SUPABASE-MCP] Executing INSERT via SDK', {
        table: tableName,
        recordsCount: records.length,
      });

      // Executar INSERT via SDK
      const { data, error } = await this.supabase
        .from(tableName)
        .insert(records)
        .select();

      if (error) {
        logger.error('[SUPABASE-MCP] Insert failed', {
          code: error.code,
          error: error.message,
          details: error.details,
        });
        return { error: error.message };
      }

      logger.info('[SUPABASE-MCP] Insert successful', {
        table: tableName,
        rowsAffected: data?.length || 0,
      });

      return { rows: data || [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[SUPABASE-MCP] Unexpected error', { error: message });
      return { error: message };
    }
  }

  /**
   * Parse VALUES clause para extrair múltiplos rows
   * Ex: "(val1, val2), (val3, val4)" → [["val1", "val2"], ["val3", "val4"]]
   */
  private parseValuesClause(valuesStr: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentValue = '';
    let inQuotes = false;
    let parenDepth = 0;
    
    for (let i = 0; i < valuesStr.length; i++) {
      const char = valuesStr[i];
      const prevChar = i > 0 ? valuesStr[i - 1] : '';
      
      // Handle quotes
      if (char === "'" && prevChar !== '\\') {
        inQuotes = !inQuotes;
        currentValue += char;
        continue;
      }
      
      // Skip processing if inside quotes
      if (inQuotes) {
        currentValue += char;
        continue;
      }
      
      // Handle parentheses
      if (char === '(') {
        parenDepth++;
        if (parenDepth === 1) {
          // Start of a new row - reset
          currentRow = [];
          currentValue = '';
          continue;
        }
      } else if (char === ')') {
        parenDepth--;
        if (parenDepth === 0) {
          // End of current row
          if (currentValue.trim()) {
            currentRow.push(currentValue.trim());
          }
          if (currentRow.length > 0) {
            rows.push([...currentRow]);
          }
          currentRow = [];
          currentValue = '';
          continue;
        }
      } else if (char === ',' && parenDepth === 1) {
        // Column separator within a row
        currentRow.push(currentValue.trim());
        currentValue = '';
        continue;
      } else if (char === ',' && parenDepth === 0) {
        // Row separator - skip
        continue;
      }
      
      // Accumulate value
      currentValue += char;
    }
    
    return rows;
  }

  /**
   * Parse um valor SQL para tipo JavaScript
   * Ex: "'string'" → "string", "123" → 123, "NULL" → null
   */
  private parseValue(value: string): any {
    const trimmed = value.trim();
    
    // NULL
    if (trimmed.toUpperCase() === 'NULL') {
      return null;
    }
    
    // String com aspas simples
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1).replace(/\\'/g, "'"); // Remove aspas e unescape
    }
    
    // Booleano
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
    
    // Número
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return parseFloat(trimmed);
    }
    
    // JSON object/array
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed.replace(/'/g, '"'));
      } catch {
        return trimmed;
      }
    }
    
    return trimmed;
  }  /**
   * Executa INSERT e retorna o ID gerado
   */
  async insert<T = any>(table: string, data: Record<string, any>): Promise<T | null> {
    try {
      logger.debug('[SUPABASE-MCP] Inserting data', { table, data });

      const { data: result, error } = await this.supabase
        .from(table)
        .insert(data)
        .select()
        .single();

      if (error) {
        logger.error('[SUPABASE-MCP] Insert failed', {
          table,
          error: error.message,
        });
        throw error;
      }

      logger.info('[SUPABASE-MCP] ✅ Insert successful', { table, id: result?.id });
      return result;

    } catch (error) {
      logger.error('[SUPABASE-MCP] Insert error', {
        table,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }

  /**
   * Executa múltiplos INSERTs em batch
   */
  async insertMany<T = any>(table: string, data: Record<string, any>[]): Promise<T[]> {
    try {
      logger.debug('[SUPABASE-MCP] Inserting multiple records', { 
        table, 
        count: data.length 
      });

      const { data: result, error } = await this.supabase
        .from(table)
        .insert(data)
        .select();

      if (error) {
        logger.error('[SUPABASE-MCP] Batch insert failed', {
          table,
          error: error.message,
        });
        throw error;
      }

      logger.info('[SUPABASE-MCP] ✅ Batch insert successful', { 
        table, 
        count: result?.length || 0 
      });
      
      return result || [];

    } catch (error) {
      logger.error('[SUPABASE-MCP] Batch insert error', {
        table,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }

  /**
   * Executa query SELECT
   */
  async query<T = any>(table: string, filters?: Record<string, any>): Promise<T[]> {
    try {
      let query = this.supabase.from(table).select('*');

      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      const { data, error } = await query;

      if (error) {
        logger.error('[SUPABASE-MCP] Query failed', {
          table,
          error: error.message,
        });
        throw error;
      }

      return data || [];

    } catch (error) {
      logger.error('[SUPABASE-MCP] Query error', {
        table,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }
}

// Singleton instance
export const supabaseMCP = new SupabaseMCPService();

// Export helper functions para compatibilidade com sintaxe MCP
export const mcp_supabase_execute_sql = (params: ExecuteSQLParams) => 
  supabaseMCP.execute_sql(params);

export const mcp_supabase_insert = <T = any>(table: string, data: Record<string, any>) =>
  supabaseMCP.insert<T>(table, data);

export const mcp_supabase_insert_many = <T = any>(table: string, data: Record<string, any>[]) =>
  supabaseMCP.insertMany<T>(table, data);

export const mcp_supabase_query = <T = any>(table: string, filters?: Record<string, any>) =>
  supabaseMCP.query<T>(table, filters);
