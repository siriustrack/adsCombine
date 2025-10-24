# Supabase Migrations

Este diretório contém as migrations SQL para o banco de dados Supabase do projeto adsCombine.

## 📋 Lista de Migrations

### `20251024_add_random_color_generator_function.sql`
**Data:** 24/10/2025  
**Descrição:** Adiciona funções para gerar cores HEX aleatórias para disciplinas

**Funções criadas:**
- `generate_random_hex_color()` - Gera cor HEX aleatória (#RRGGBB)
- `update_disciplines_without_color()` - Atualiza disciplinas existentes sem cor

**Uso:**
```sql
-- Gerar cor aleatória
SELECT generate_random_hex_color();

-- Atualizar todas disciplinas sem cor
SELECT * FROM update_disciplines_without_color();
```

---

### `20251024_add_auto_color_trigger_on_discipline_insert.sql`
**Data:** 24/10/2025  
**Descrição:** Adiciona trigger automático para gerar cores em novas disciplinas

**Componentes criados:**
- `auto_assign_discipline_color()` - Função trigger
- `trigger_auto_assign_discipline_color` - Trigger BEFORE INSERT

**Comportamento:**
- ✅ Se `color IS NULL` → Gera cor automática
- ✅ Se cor especificada → Mantém a cor

---

## 🚀 Como Aplicar

### Via MCP Supabase (Recomendado)
As migrations já foram aplicadas via MCP durante o desenvolvimento.

### Via Supabase CLI
```bash
supabase db push
```

### Manualmente via SQL Editor
1. Acesse o Supabase Dashboard
2. Vá em SQL Editor
3. Cole o conteúdo de cada migration na ordem
4. Execute

---

## 🔍 Verificação

Para verificar se as migrations foram aplicadas:

```sql
-- Verificar se as funções existem
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_name IN (
  'generate_random_hex_color',
  'update_disciplines_without_color',
  'auto_assign_discipline_color'
);

-- Verificar se o trigger existe
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'trigger_auto_assign_discipline_color';

-- Testar geração de cor
SELECT generate_random_hex_color();
```

---

## 📊 Status das Disciplinas

Para verificar o status atual das cores:

```sql
SELECT 
  COUNT(*) as total_disciplinas,
  COUNT(color) as com_cor,
  COUNT(*) - COUNT(color) as sem_cor,
  COUNT(DISTINCT color) as cores_unicas
FROM disciplines;
```

---

## 🎨 Paleta de Cores Atual

```sql
SELECT id, name, color 
FROM disciplines 
ORDER BY id;
```

---

## ⚠️ Rollback

Se precisar reverter as migrations:

```sql
-- Remover trigger
DROP TRIGGER IF EXISTS trigger_auto_assign_discipline_color ON disciplines;

-- Remover funções
DROP FUNCTION IF EXISTS auto_assign_discipline_color();
DROP FUNCTION IF EXISTS update_disciplines_without_color();
DROP FUNCTION IF EXISTS generate_random_hex_color();
```

---

## 📝 Notas

- As cores são geradas aleatoriamente no espectro RGB completo (0-255)
- O formato é sempre `#RRGGBB` (6 dígitos hexadecimais)
- A probabilidade de cores duplicadas é extremamente baixa (1 em 16.777.216)
- As cores são compatíveis com CSS/HTML padrão
