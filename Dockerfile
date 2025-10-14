# -------------------------------------------------------------------
# 1) Dependencies stage
# -------------------------------------------------------------------
FROM node:20-bullseye-slim AS deps
WORKDIR /app

# Ferramentas necessárias para compilar dependências nativas
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# Instala deps com npm ci (mais rápido e determinístico)
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# -------------------------------------------------------------------
# 2) Build stage
# -------------------------------------------------------------------
FROM node:20-bullseye-slim AS builder
WORKDIR /app

# Ferramentas de build (incluindo para SWC bindings nativos)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# Instala TODAS as dependências (prod + dev) para garantir bindings nativos do SWC
RUN npm ci

COPY . .

# Verifica se o SWC foi instalado e lista arquivos fonte
RUN ls -la node_modules/.bin/swc && \
    ls -la src/ && \
    echo "Iniciando build..." && \
    npm run build

# -------------------------------------------------------------------
# 3) Production stage
# -------------------------------------------------------------------
FROM node:20-bullseye-slim AS production
WORKDIR /app

ENV NODE_ENV=production

# ======== OCR & PDF tools (runtime only) ========
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr tesseract-ocr-por \
    imagemagick \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ======== ENV de performance/estabilidade ========
# Limita threads internas do Tesseract/OpenMP (cada worker = 1 thread de OCR)
ENV OMP_NUM_THREADS=1 \
    OMP_THREAD_LIMIT=1 \
    TESSERACT_NUM_THREADS=1
# Caminho do tessdata (ajuda a evitar lookup extra)
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata
# Desativa libvips global e usa a empacotada do sharp
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
# (Opcional) Ajustar timezone e mem:
# ENV TZ=America/Sao_Paulo
# ENV NODE_OPTIONS=--max-old-space-size=1024

# Cria usuário não-root
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copia apenas o necessário
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY assets-img/ ./assets-img/
COPY --from=builder /app/dist ./dist

# Pastas de trabalho
RUN mkdir -p public temp public/texts && chown -R appuser:appuser /app

USER appuser

EXPOSE 3000

# Healthcheck: evita top-level await no node -e
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "start"]
