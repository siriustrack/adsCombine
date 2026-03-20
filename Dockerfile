# -------------------------------------------------------------------
# 1) Dependencies stage (com ferramentas de build p/ nativos)
# -------------------------------------------------------------------
FROM oven/bun:slim AS deps
WORKDIR /app

# Ferramentas necessárias para compilar dependências nativas (ex.: sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates curl git unzip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* ./
# Instala deps já compilando nativos para bullseye
RUN bun install --frozen-lockfile

# -------------------------------------------------------------------
# 2) Build stage (reaproveita node_modules do deps)
# -------------------------------------------------------------------
FROM oven/bun:slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Se seu build usa bun:
RUN bun run build
# (ou) RUN npm run build

# -------------------------------------------------------------------
# 3) Production stage (runtime mínimo + binários OCR)
# -------------------------------------------------------------------
FROM oven/bun:slim AS production
WORKDIR /app

ENV NODE_ENV=production

# ======== OCR & PDF tools (runtime only) ========
# poppler-utils -> pdftoppm/pdfinfo | tesseract + por | imagemagick (mogrify)
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr tesseract-ocr-por \
    imagemagick \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
        # Adjust ImageMagick policy permissions and resources
        # Relaxando limites agressivamente para máquina com 32GB RAM
        && if [ -f /etc/ImageMagick-6/policy.xml ]; then \
            sed -i 's/domain="resource" name="disk" value="1GiB"/domain="resource" name="disk" value="16GiB"/g' /etc/ImageMagick-6/policy.xml; \
            sed -i 's/domain="resource" name="memory" value="256MiB"/domain="resource" name="memory" value="8GiB"/g' /etc/ImageMagick-6/policy.xml; \
            sed -i 's/domain="resource" name="map" value="512MiB"/domain="resource" name="map" value="8GiB"/g' /etc/ImageMagick-6/policy.xml; \
            sed -i 's/domain="resource" name="area" value="128MB"/domain="resource" name="area" value="2GB"/g' /etc/ImageMagick-6/policy.xml; \
        fi \
        && if [ -f /etc/ImageMagick-7/policy.xml ]; then \
            sed -i 's/domain="resource" name="disk" value="1GiB"/domain="resource" name="disk" value="16GiB"/g' /etc/ImageMagick-7/policy.xml; \
            sed -i 's/domain="resource" name="memory" value="256MiB"/domain="resource" name="memory" value="8GiB"/g' /etc/ImageMagick-7/policy.xml; \
            sed -i 's/domain="resource" name="map" value="512MiB"/domain="resource" name="map" value="8GiB"/g' /etc/ImageMagick-7/policy.xml; \
            sed -i 's/domain="resource" name="area" value="128MB"/domain="resource" name="area" value="2GB"/g' /etc/ImageMagick-7/policy.xml; \
        fi

# Evitar que o ImageMagick bloqueie operações simples por policy (não vamos ler PDF com IM)
# (normalmente não precisa mexer no policy.xml; usando poppler pra PDF)
# Caso precise fazer convert/mogrify em TIFF/PNG apenas, está ok.

# ======== ENV de performance/estabilidade ========
# Limita threads internas do Tesseract/OpenMP (cada worker = 1 thread de OCR)
ENV OMP_NUM_THREADS=1 \
    OMP_THREAD_LIMIT=1 \
    TESSERACT_NUM_THREADS=1
# Caminho do tessdata (ajuda a evitar lookup extra)
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata
# (Opcional) Ajustar timezone e mem:
# ENV TZ=America/Sao_Paulo
# ENV NODE_OPTIONS=--max-old-space-size=1024

# Cria usuário não-root
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copia apenas o necessário
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Pastas de trabalho
RUN mkdir -p public temp public/texts && chown -R appuser:appuser /app

USER appuser

EXPOSE 3000

# Healthcheck: evita top-level await usando bun -e
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "dist/src/api/server.js"]
