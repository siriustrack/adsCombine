import { createStudyPlan } from '../src/agents/index';
import * as fs from 'fs';
import * as path from 'path';

async function testPlanCreation() {
  try {
    const content = fs.readFileSync(path.join(__dirname, '../../docs/content-example.md'), 'utf-8');

    const result = await createStudyPlan({
      userId: 'test-user-id', // Substituir por um UUID real
      content,
    });

    if (result.success) {
      console.log('Plano criado com sucesso! ID:', result.data);
    } else {
      console.error('Erro:', result.error);
    }
  } catch (error) {
    console.error('Erro no teste:', error);
  }
}

testPlanCreation();