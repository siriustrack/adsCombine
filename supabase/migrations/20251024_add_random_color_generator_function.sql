-- Migration: Add Random Color Generator Function
-- Date: 2025-10-24
-- Description: Adiciona funções para gerar cores HEX aleatórias e atualizar disciplinas sem cor

-- Função para gerar cor HEX aleatória
CREATE OR REPLACE FUNCTION generate_random_hex_color()
RETURNS TEXT AS $$
DECLARE
  r INTEGER;
  g INTEGER;
  b INTEGER;
BEGIN
  -- Gerar valores RGB aleatórios (0-255)
  r := floor(random() * 256)::INTEGER;
  g := floor(random() * 256)::INTEGER;
  b := floor(random() * 256)::INTEGER;
  
  -- Retornar no formato #RRGGBB
  RETURN '#' || 
         lpad(to_hex(r), 2, '0') || 
         lpad(to_hex(g), 2, '0') || 
         lpad(to_hex(b), 2, '0');
END;
$$ LANGUAGE plpgsql;

-- Função para atualizar disciplinas sem cor
CREATE OR REPLACE FUNCTION update_disciplines_without_color()
RETURNS TABLE(id BIGINT, name TEXT, new_color TEXT) AS $$
BEGIN
  RETURN QUERY
  UPDATE disciplines
  SET color = generate_random_hex_color()
  WHERE color IS NULL
  RETURNING disciplines.id, disciplines.name, disciplines.color;
END;
$$ LANGUAGE plpgsql;

-- Comentários
COMMENT ON FUNCTION generate_random_hex_color() IS 'Gera uma cor HEX aleatória no formato #RRGGBB';
COMMENT ON FUNCTION update_disciplines_without_color() IS 'Atualiza todas as disciplinas com color NULL, gerando cores HEX aleatórias únicas para cada uma';
