# 🚂 Deploy na Railway - adsCombine

## 📋 Pré-requisitos

- Conta na [Railway](https://railway.app)
- Repositório GitHub conectado
- Variáveis de ambiente configuradas

---

## 🚀 Configuração no Railway

### **1. Criar Novo Projeto**

1. Acesse [railway.app](https://railway.app)
2. Clique em **"New Project"**
3. Selecione **"Deploy from GitHub repo"**
4. Escolha o repositório `siriustrack/adsCombine`
5. Selecione a branch `escola-da-aprovacao`

### **2. Configurar Variáveis de Ambiente**

No painel do Railway, vá em **Variables** e adicione:

#### **Obrigatórias:**

```bash
# Node
NODE_ENV=production
PORT=3000

# OpenAI
OPENAI_API_KEY=sk-proj-...

# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-api...

# Supabase
SUPABASE_URL=https://kqhrhafgnoxbgjtvkomx.supabase.co
SUPABASE_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

#### **Opcionais:**

```bash
# Logs
REQUEST_LOGS_ENABLED=true
LOG_LEVEL=info

# Build
NPM_CONFIG_LOGLEVEL=error
```

### **3. Configurar Build**

Railway detecta automaticamente o Dockerfile. Certifique-se de que:

- ✅ **Build Command:** (automático via Dockerfile)
- ✅ **Start Command:** `npm start` (definido no Dockerfile)
- ✅ **Port:** `3000`

### **4. Deploy**

Railway fará deploy automaticamente ao detectar mudanças na branch.

**Comandos executados:**

```bash
# 1. Install dependencies
npm ci --only=production

# 2. Build
npm run build

# 3. Start
npm start
```

---

## 🐳 Build Local para Teste

### **Teste com Docker:**

```bash
# Build da imagem
docker build -t adscombine:latest .

# Run local
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e OPENAI_API_KEY=your-key \
  -e ANTHROPIC_API_KEY=your-key \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_KEY=your-key \
  adscombine:latest

# Verificar health
curl http://localhost:3000/api/health
```

### **Teste com npm local:**

```bash
# Install
npm install

# Build
npm run build

# Start (com variáveis do .env)
npm start

# Verificar
curl http://localhost:3000/api/health
```

---

## 📊 Monitoramento

### **Health Check:**

```bash
curl https://your-app.railway.app/api/health
```

**Resposta esperada:**

```json
{
  "status": "OK",
  "timestamp": "2025-10-14T10:00:00.000Z"
}
```

### **Logs:**

No painel do Railway:
- **Deployments** → Ver logs de build
- **Logs** → Ver logs de runtime

### **Métricas:**

Railway mostra automaticamente:
- CPU usage
- Memory usage
- Network traffic
- Request rate

---

## 🔧 Troubleshooting

### **Erro: Module not found**

✅ **Solução:** Rebuild limpo

```bash
rm -rf node_modules package-lock.json dist
npm install
npm run build
```

### **Erro: Port already in use**

✅ **Solução:** Railway define PORT automaticamente, certifique-se de usar `process.env.PORT`

```typescript
const PORT = process.env.PORT || 3000;
app.listen(PORT);
```

### **Erro: Out of memory**

✅ **Solução:** Aumentar plano do Railway ou otimizar NODE_OPTIONS

```bash
NODE_OPTIONS=--max-old-space-size=2048
```

### **Build muito lento**

✅ **Solução:** Railway cacheia layers do Docker. Primeira build é lenta, próximas são rápidas.

### **Erro: ECONNREFUSED Supabase**

✅ **Solução:** Verificar variáveis de ambiente:

```bash
railway variables
```

---

## 📦 Estrutura do Build

```
.
├── Dockerfile           ← Multi-stage build
│   ├── deps stage       ← Instala dependências
│   ├── builder stage    ← Compila TypeScript
│   └── production stage ← Runtime mínimo
│
├── package.json         ← Scripts npm
├── package-lock.json    ← Lock file (NÃO COMMITAR bun.lock)
├── .npmrc              ← Config npm
└── dist/               ← Build output (gerado)
    └── src/
        └── api/
            └── server.js
```

---

## ⚡ Performance

### **Tempos de Build:**

| Stage | Tempo | Descrição |
|-------|-------|-----------|
| deps | ~2-3min | Instala node_modules |
| builder | ~30s | Compila TypeScript com SWC |
| production | ~1min | Copia arquivos e configura runtime |
| **Total** | **~4-5min** | Primeira build (cached depois) |

### **Otimizações Aplicadas:**

✅ Multi-stage build (imagem final pequena)  
✅ npm ci --only=production (instalação determinística)  
✅ SWC compiler (muito mais rápido que tsc)  
✅ Layer caching (node_modules cacheia entre builds)  
✅ .dockerignore (ignora arquivos desnecessários)  
✅ Health check (Railway detecta quando app está pronto)  

---

## 🔐 Segurança

### **Imagem Base:**

- `node:20-bullseye-slim` (oficial, segura, atualizada)
- Runtime não-root (`appuser`)
- Apenas dependências de produção

### **Variáveis Sensíveis:**

⚠️ **NUNCA commitar:**
- `.env` (no .gitignore)
- Chaves de API
- Tokens de serviço

✅ **Usar Railway Variables** para todas as secrets

---

## 📞 Suporte

- **Documentação Railway:** https://docs.railway.app
- **Repositório:** https://github.com/siriustrack/adsCombine
- **Branch:** `escola-da-aprovacao`
- **Issues:** https://github.com/siriustrack/adsCombine/issues

---

## 🎯 Checklist de Deploy

- [ ] Variáveis de ambiente configuradas no Railway
- [ ] Branch `escola-da-aprovacao` selecionada
- [ ] Dockerfile validado localmente
- [ ] Health check funcionando (`/api/health`)
- [ ] Logs sendo gerados corretamente
- [ ] Testes E2E passando (5/5)
- [ ] Domínio personalizado configurado (opcional)

---

**✅ Ready to Deploy!**

```bash
git push origin escola-da-aprovacao
# Railway fará deploy automaticamente! 🚀
```
