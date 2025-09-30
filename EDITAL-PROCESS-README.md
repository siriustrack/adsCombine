# Edital Processing Endpoint

## POST /api/edital-process

Processa documentos de editais usando Claude AI para extração de informações estruturadas.

### Request Body

```json
{
  "user_id": "98d8b11a-8a32-4f6b-9dae-6e42efa23116",
  "schedule_plan_id": "bca596cc-d484-4df1-8cf2-e9a5ca637eac",
  "url": "https://kqhrhafgnoxbgjtvkomx.supabase.co/storage/v1/object/public/editals/98d8b11a-8a32-4f6b-9dae-6e42efa23116/24dc7e0c-b026-45ea-bd2f-d3a5c20bbc16.txt"
}
```

### Response

```json
{
  "filePath": "/98d8b11a-8a32-4f6b-9dae-6e42efa23116/bca596cc-d484-4df1-8cf2-e9a5ca637eac/abc123-def456.txt",
  "status": "processing"
}
```

### Funcionalidades

1. **Processamento Assíncrono**: Retorna imediatamente com o caminho do arquivo
2. **Criação de Arquivo**: Gera arquivo vazio no path `/user_id/schedule_plan_id/random_name.txt`
3. **Download de Conteúdo**: Faz GET na URL fornecida
4. **Processamento com Claude**: Envia conteúdo para Claude Sonnet 4.5
5. **Atualização do Arquivo**: Salva resultado processado no arquivo criado

### Configurações Claude AI

- **Modelo**: claude-sonnet-4-5-20250929
- **Max Tokens**: 16000
- **Temperature**: 0.0 (para máxima precisão)
- **Top P**: 1.0
- **Top K**: 0

### Exemplo de Uso

```bash
curl -X POST http://localhost:3000/api/edital-process \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "98d8b11a-8a32-4f6b-9dae-6e42efa23116",
    "schedule_plan_id": "bca596cc-d484-4df1-8cf2-e9a5ca637eac",
    "url": "https://example.com/edital.txt"
  }'
```

### Status do Processamento

O arquivo será atualizado automaticamente quando o processamento for concluído. Você pode verificar o conteúdo do arquivo através do `filePath` retornado.