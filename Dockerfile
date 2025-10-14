# -------------------------------------------------------------------
# 1) Dependencies stage
# -------------------------------------------------------------------
FROM oven/bun:1.2-slim AS deps
WORKDIR /app

COPY package.json bun.lockb* ./

# Instala apenas dependências de produção
RUN bun install --production --frozen-lockfile

# -------------------------------------------------------------------
# 2) Build stage
# -------------------------------------------------------------------
FROM oven/bun:1.2-slim AS builder
WORKDIR /app

COPY package.json bun.lockb* ./

# Instala TODAS as dependências (prod + dev)
RUN bun install --frozen-lockfile

COPY . .

# Build com Bun
RUN bun run build

# -------------------------------------------------------------------
# 3) Production stage
# -------------------------------------------------------------------
FROM oven/bun:1.2-slim AS production
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

# Cria usuário não-root
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copia apenas o necessário
COPY --from=builder /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY assets-img/ ./assets-img/
COPY --from=builder /app/dist ./dist

# Pastas de trabalho
RUN mkdir -p public temp public/texts && chown -R appuser:appuser /app

USER appuser

EXPOSE 3000

# Healthcheck com Bun
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun --eval "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", "run", "start"]
