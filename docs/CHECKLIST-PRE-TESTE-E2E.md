# 🔍 CHECKLIST PRÉ-TESTE E2E

## 📋 DADOS FORNECIDOS

```json
{
  "url": "https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/98d8b11a-8a32-4f6b-9dae-6e42efa23116/2ef9fdbd-1f1e-4133-8247-45e761de15c6.txt",
  "user_id": "98d8b11a-8a32-4f6b-9dae-6e42efa23116",
  "edital_bucket_path": "98d8b11a-8a32-4f6b-9dae-6e42efa23116/06cc87e8-48b4-4f8a-bc4a-cc9e2344839f.pdf"
}
```

## ❌ FALTANDO:

### 1. **schedule_plan_id** (OBRIGATÓRIO)
```typescript
interface EditalProcessRequest {
  user_id: string;
  schedule_plan_id: string;  // ❌ FALTA!
  url: string;
  edital_bucket_path: string;
}
```

**Usado para:**
- Criar diretório: `/public/{user_id}/{schedule_plan_id}/`
- Organizar JSONs por plano de estudos
- Associar edital ao plano correto

**Solução:** Você precisa fornecer um UUID do plano de estudos

---

## 🎯 DADOS COMPLETOS NECESSÁRIOS

```typescript
{
  // ✅ Fornecido
  "user_id": "98d8b11a-8a32-4f6b-9dae-6e42efa23116",
  "url": "https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/98d8b11a-8a32-4f6b-9dae-6e42efa23116/2ef9fdbd-1f1e-4133-8247-45e761de15c6.txt",
  "edital_bucket_path": "98d8b11a-8a32-4f6b-9dae-6e42efa23116/06cc87e8-48b4-4f8a-bc4a-cc9e2344839f.pdf",
  
  // ❌ FALTANDO
  "schedule_plan_id": "???",  // Precisa fornecer
  
  // ✅ Opcionais (podem ficar vazios)
  "file_name": "edital-exemplo.pdf",  // Opcional
  "file_size": 1024000,  // Opcional
  "mime_type": "application/pdf",  // Opcional
  "options": {
    "maxRetries": 3,
    "validateSchema": true
  }
}
```

---

## 📊 ESTRUTURA GERADA

Com `schedule_plan_id = "abc-123-xyz"`:

```
public/
└── 98d8b11a-8a32-4f6b-9dae-6e42efa23116/  ← user_id
    └── abc-123-xyz/  ← schedule_plan_id
        └── random-uuid.json  ← Resultado processado
```

---

## 🔍 VERIFICAÇÃO NO SUPABASE

Precisamos verificar se existe `schedule_plan_id` no banco:

```sql
-- Buscar planos do usuário
SELECT id, name, created_at 
FROM schedule_plans 
WHERE user_id = '98d8b11a-8a32-4f6b-9dae-6e42efa23116'
LIMIT 5;
```

**Ou criar um novo:**
```sql
INSERT INTO schedule_plans (id, user_id, name)
VALUES (gen_random_uuid(), '98d8b11a-8a32-4f6b-9dae-6e42efa23116', 'Plano Teste E2E')
RETURNING id;
```

---

## 🎯 PRÓXIMOS PASSOS

### Opção 1: Você fornece schedule_plan_id existente
```bash
# Eu crio o teste e2e com os dados completos
```

### Opção 2: Criamos um schedule_plan_id de teste
```typescript
// Teste cria schedule_plan antes de processar edital
const schedulePlanId = await createTestSchedulePlan(user_id);
```

### Opção 3: Usamos UUID aleatório (não recomendado)
```typescript
// Teste usa UUID fake (não existe no banco)
const schedulePlanId = randomUUID();
// ⚠️ Problema: orchestrator pode falhar ao buscar plan
```

---

## 🚀 TESTE E2E COMPLETO

Quando tiver `schedule_plan_id`, o fluxo será:

```
1. POST /api/edital-process
   ├─ Retorna 200 com estimativa
   └─ Processa em background

2. Aguardar processamento (~8min)
   └─ Polling no arquivo JSON

3. JSON pronto → Chamar Orchestrator
   ├─ StudyPlanAgent
   ├─ ExamsAgent  
   ├─ DisciplinesAgent
   └─ TopicsAgent

4. Validar no Supabase
   ├─ SELECT FROM exams
   ├─ SELECT FROM disciplines
   ├─ SELECT FROM topics
   └─ Verificar dados inseridos
```

---

## ❓ PERGUNTA

**Você tem um `schedule_plan_id` existente ou quer que eu:**
- A) Busque um do banco de dados?
- B) Crie um novo no teste?
- C) Use um UUID fake (arriscado)?

Ou **forneça o `schedule_plan_id`** que deseja usar.
