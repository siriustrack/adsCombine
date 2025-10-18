# API edital-process - Campos Obrigatórios

## Endpoint

```
POST /api/editais/edital-process
```

## Body da Requisição

### Campos Obrigatórios

```typescript
{
  user_id: string;              // UUID do usuário
  schedule_plan_id: string;     // UUID do plano de estudos
  url: string;                  // URL do arquivo PDF do edital
  edital_bucket_path: string;   // Caminho no storage bucket (NOT NULL no banco)
}
```

### Campos Opcionais

```typescript
{
  file_name?: string;           // Nome do arquivo (ex: "edital-tj-sc.pdf")
  file_size?: number;           // Tamanho do arquivo em bytes
  mime_type?: string;           // Tipo MIME (ex: "application/pdf")
}
```

## Exemplo de Requisição

```json
{
  "user_id": "98d8b11a-8a32-4f6b-9dae-6e42efa23116",
  "schedule_plan_id": "550e8400-e29b-41d4-a716-446655440000",
  "url": "https://storage.supabase.co/bucket/editais/edital-tj-sc.pdf",
  "edital_bucket_path": "editais/98d8b11a-8a32-4f6b-9dae-6e42efa23116/edital-tj-sc.pdf",
  "file_name": "edital-tj-sc.pdf",
  "file_size": 2048576,
  "mime_type": "application/pdf"
}
```

## Schema do Banco (edital_file)

### Colunas NOT NULL
- `id` (uuid, auto-generated)
- `user_id` (uuid)
- `edital_file_url` (text) ← mapeado de `url`
- `edital_bucket_path` (text) ← **OBRIGATÓRIO**

### Colunas Opcionais
- `file_name` (text)
- `file_size` (bigint)
- `mime_type` (text)
- `edital_status` (text, default: 'processing')
- `processing_result` (jsonb)
- `transcription_url` (text)
- `json_url` (text)
- `created_at` (timestamp, auto)
- `updated_at` (timestamp, auto)

## Validação com Zod

O body é validado usando Zod no controller:

```typescript
const EditalProcessBodySchema = z.object({
  user_id: z.string().uuid(),
  schedule_plan_id: z.string().uuid(),
  url: z.string().url(),
  edital_bucket_path: z.string().min(1), // NOT NULL
  file_name: z.string().optional(),
  file_size: z.number().int().positive().optional(),
  mime_type: z.string().optional(),
});
```

## Resposta de Sucesso

```json
{
  "filePath": "/files/98d8b11a-8a32-4f6b-9dae-6e42efa23116/550e8400-e29b-41d4-a716-446655440000/uuid.json",
  "status": "processing",
  "jobId": "uuid-do-job"
}
```

## Fluxo de Processamento

1. **Validação**: Zod valida o body da requisição
2. **Download**: Serviço baixa o PDF da URL
3. **Transcrição**: Claude extrai texto do PDF
4. **Processamento**: Claude estrutura dados em JSON
5. **Orquestração**: Agentes IA inserem dados no Supabase
   - EditalFileAgent: Cria registro em `edital_file` (usa `edital_bucket_path`)
   - StudyPlanAgent: Cria registro em `study_plans`
   - ExamsAgent: Cria registros em `exams`
   - DisciplinesAgent: Cria registros em `disciplines`
   - TopicsAgent: Cria registros em `topics`
6. **Resultado**: JSON final salvo no diretório do usuário

## Notas Importantes

- `edital_bucket_path` deve refletir o caminho real no Supabase Storage
- Formato recomendado: `editais/{user_id}/{filename}`
- O campo é usado para rastreabilidade e gestão de arquivos no storage
- Caso não seja fornecido, a API retorna erro 400
