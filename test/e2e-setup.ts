/**
 * Setup para testes E2E
 * 
 * IMPORTANTE: Não mocka OpenAI nem Supabase - usa APIs reais!
 * Carrega variáveis de ambiente do arquivo .env
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Carregar .env do diretório raiz
const envPath = resolve(__dirname, '../.env');
console.log(`📦 E2E Setup: Carregando .env de ${envPath}`);

const result = config({ path: envPath });

if (result.error) {
  console.error('❌ Erro ao carregar .env:', result.error);
  throw new Error(`Falha ao carregar .env: ${result.error.message}`);
}

// Validar que as variáveis críticas estão presentes
const requiredVars = ['OPENAI_API_KEY', 'CLAUDE_AI_API_KEY', 'SUPABASE_URL'];
const missing = requiredVars.filter(v => !process.env[v]);

// Para Supabase, aceitar service_role OU anon_key
if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY) {
  missing.push('SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_ANON_KEY');
}

if (missing.length > 0) {
  console.error('❌ Variáveis de ambiente faltando:', missing);
  throw new Error(`Variáveis de ambiente obrigatórias não encontradas: ${missing.join(', ')}`);
}

const supabaseKeyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE' : 'ANON';

console.log('✅ E2E Setup: Variáveis de ambiente carregadas');
console.log('   - OPENAI_API_KEY:', process.env.OPENAI_API_KEY?.substring(0, 10) + '...');
console.log('   - CLAUDE_AI_API_KEY:', process.env.CLAUDE_AI_API_KEY?.substring(0, 10) + '...');
console.log('   - SUPABASE_URL:', process.env.SUPABASE_URL);
console.log(`   - SUPABASE_KEY (${supabaseKeyType}):`, (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)?.substring(0, 10) + '...');
