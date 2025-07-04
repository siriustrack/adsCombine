# Rota DELETE para arquivos de texto

## Endpoint: DELETE /api/delete-texts

Esta rota permite excluir arquivos `.txt` da pasta `public/texts` com autenticação via Bearer token.

### Autenticação

A rota requer autenticação via Bearer token no header:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

### Parâmetros opcionais no body:

```json
{
  "filename": "arquivo-especifico.txt",    // Opcional: nome específico do arquivo
  "conversationId": "conv-123"             // Opcional: excluir arquivos de uma conversa
}
```

### Casos de uso:

#### 1. Excluir arquivo específico
```bash
curl -X DELETE http://localhost:3000/api/delete-texts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "test-file.txt"}'
```

#### 2. Excluir arquivos de uma conversa específica
```bash
curl -X DELETE http://localhost:3000/api/delete-texts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "conv-123"}'
```

#### 3. Excluir todos os arquivos txt
```bash
curl -X DELETE http://localhost:3000/api/delete-texts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### Respostas:

#### Sucesso (200)
```json
{
  "message": "Successfully deleted 2 file(s)",
  "deletedFiles": ["file1.txt", "file2.txt"],
  "deletedCount": 2
}
```

#### Nenhum arquivo encontrado (404)
```json
{
  "message": "No txt files found to delete",
  "deletedFiles": [],
  "deletedCount": 0
}
```

#### Não autorizado (401)
```json
{
  "error": "Unauthorized"
}
```

#### Erro interno (500)
```json
{
  "error": "Internal server error",
  "message": "Error details"
}
```

### Teste

Para testar a rota, execute:
```bash
# Primeiro, inicie o servidor
npm start

# Em outro terminal, execute o teste
node test/test-delete-route.js
```

Certifique-se de configurar a variável de ambiente `TOKEN` antes de executar os testes.
