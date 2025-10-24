-- Migration: Add Auto Color Trigger on Discipline Insert
-- Date: 2025-10-24
-- Description: Adiciona trigger que atribui automaticamente cor HEX aleatória quando uma disciplina é inserida sem cor

-- Trigger function que atribui cor automaticamente
CREATE OR REPLACE FUNCTION auto_assign_discipline_color()
RETURNS TRIGGER AS $$
BEGIN
  -- Se a cor for NULL, gerar uma automaticamente
  IF NEW.color IS NULL THEN
    NEW.color := generate_random_hex_color();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger BEFORE INSERT
DROP TRIGGER IF EXISTS trigger_auto_assign_discipline_color ON disciplines;

CREATE TRIGGER trigger_auto_assign_discipline_color
  BEFORE INSERT ON disciplines
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_discipline_color();

-- Comentário
COMMENT ON TRIGGER trigger_auto_assign_discipline_color ON disciplines IS 'Atribui automaticamente uma cor HEX aleatória quando uma disciplina é inserida sem cor';
COMMENT ON FUNCTION auto_assign_discipline_color() IS 'Trigger function que gera cor automática para disciplinas sem cor no momento da inserção';
