# -------------------------------------------------------------------
# 1) Dependencies stage (com ferramentas de build p/ nativos)
# -------------------------------------------------------------------
FROM node:lts-bullseye-slim AS deps
WORKDIR /app

# Ferramentas necessárias para compilar dependências nativas (ex.: sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates curl git unzip \
    && rm -rf /var/lib/apt/lists/*

# Bun para instalar deps rapidamente
RUN curl -fsSL https://bun.com/install | bash -s "bun-v1.2.19"
ENV PATH="/root/.bun/bin:${PATH}"

COPY package.json bun.lock* ./
# Instala deps já compilando nativos para bullseye
RUN bun install --frozen-lockfile

# -------------------------------------------------------------------
# 2) Build stage (reaproveita node_modules do deps)
# -------------------------------------------------------------------
FROM node:lts-bullseye-slim AS builder
WORKDIR /app

COPY --from=deps /root/.bun /root/.bun
ENV PATH="/root/.bun/bin:${PATH}"

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build com Bun
RUN bun run build

# -------------------------------------------------------------------
# 3) Production stage (runtime mínimo + binários OCR)
# -------------------------------------------------------------------
FROM node:lts-bullseye-slim AS production
WORKDIR /app

ENV NODE_ENV=production

# ======== OCR & PDF tools (runtime only) ========
# poppler-utils -> pdftoppm/pdfinfo | tesseract + por | imagemagick (mogrify)
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
