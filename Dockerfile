## Dependencies stage
FROM node:lts-bullseye AS deps

WORKDIR /app

RUN curl -fsSL https://bun.sh/install | bash

ENV PATH="/root/.bun/bin:${PATH}"

COPY package.json bun.lock* ./

RUN bun install --frozen-lockfile

## Build stage
FROM node:lts-bullseye AS builder

WORKDIR /app

COPY --from=deps /root/.bun /root/.bun

ENV PATH="/root/.bun/bin:${PATH}"

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN bun run build

## Production stage
FROM node:lts-slim AS production

WORKDIR /app

ENV NODE_ENV=production
# Environment variables for Sharp in Docker
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
# Install system dependencies including build tools needed for Sharp
RUN apt-get update && apt-get install -y \
    imagemagick \
    ghostscript \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-por \
    python3 \
    make \
    g++ \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN mkdir -p public temp public/texts && \
    chown -R appuser:appuser /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

RUN rm -rf node_modules/sharp && \
    npm install --platform=linux --arch=x64 --ignore-scripts=false --foreground-scripts sharp@0.32.0

COPY assets-img/ ./assets-img/
COPY --from=builder /app/dist ./dist

RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD bun -e "const response = await fetch('http://localhost:3000/api/health'); process.exit(response.ok ? 0 : 1);"

CMD ["npm", "start"]
