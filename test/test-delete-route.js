// test-delete-route.js
// Teste básico para a rota DELETE /api/delete-texts

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';
const TOKEN = process.env.TOKEN || 'your-token-here';

async function testDeleteRoute() {
  try {
    console.log('🧪 Testando rota DELETE /api/delete-texts...\n');

    // Teste 1: Excluir arquivo específico
    console.log('📋 Teste 1: Excluir arquivo específico');
    const response1 = await fetch(`${BASE_URL}/api/delete-texts`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({
        filename: 'test-file.txt'
      })
    });

    const result1 = await response1.json();
    console.log('Status:', response1.status);
    console.log('Response:', JSON.stringify(result1, null, 2));
    console.log('✅ Teste 1 concluído\n');

    // Teste 2: Excluir todos os arquivos
    console.log('📋 Teste 2: Excluir todos os arquivos txt');
    const response2 = await fetch(`${BASE_URL}/api/delete-texts`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      }
    });

    const result2 = await response2.json();
    console.log('Status:', response2.status);
    console.log('Response:', JSON.stringify(result2, null, 2));
    console.log('✅ Teste 2 concluído\n');

    // Teste 3: Teste sem autenticação (deve falhar)
    console.log('📋 Teste 3: Teste sem autenticação (deve retornar 401)');
    const response3 = await fetch(`${BASE_URL}/api/delete-texts`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result3 = await response3.json();
    console.log('Status:', response3.status);
    console.log('Response:', JSON.stringify(result3, null, 2));
    console.log('✅ Teste 3 concluído\n');

  } catch (error) {
    console.error('❌ Erro durante os testes:', error.message);
  }
}

// Executar apenas se chamado diretamente
if (require.main === module) {
  testDeleteRoute();
}

module.exports = testDeleteRoute;
