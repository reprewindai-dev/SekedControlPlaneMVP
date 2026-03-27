# Use Node.js 22 Alpine for smaller image size (required by Prisma Accelerate)
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat

# Install dependencies once for the engine workspace
FROM base AS deps
WORKDIR /app/ecobe-engine
COPY package.json ./package.json
COPY package-lock.json* ./package-lock.json
RUN npm install --legacy-peer-deps

# Build the application with Prisma client generation
FROM base AS builder
WORKDIR /app/ecobe-engine
ARG BUILDTIME_DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"
ENV DATABASE_URL=${BUILDTIME_DATABASE_URL}
ENV DIRECT_DATABASE_URL=${BUILDTIME_DATABASE_URL}
COPY --from=deps /app/ecobe-engine/node_modules ./node_modules
COPY . ./
RUN npx prisma generate
RUN npm run build

# Production runtime image
FROM base AS runner
WORKDIR /app/ecobe-engine
ENV NODE_ENV=production

# Harden container by running as non-root
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs ecobe

# Copy built artifacts
COPY --from=builder /app/ecobe-engine/dist ./dist
COPY --from=builder /app/ecobe-engine/node_modules ./node_modules
COPY --from=builder /app/ecobe-engine/package.json ./package.json
COPY --from=builder /app/ecobe-engine/prisma ./prisma
COPY --from=builder /app/ecobe-engine/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/ecobe-engine/scripts ./scripts
COPY --from=builder /app/ecobe-engine/data ./data
COPY --from=builder /app/ecobe-engine/node_modules/.prisma ./node_modules/.prisma

RUN chown -R ecobe:nodejs /app
USER ecobe

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.setTimeout(5000, () => process.exit(1));"

CMD ["sh", "-c", "npx prisma migrate deploy || echo 'Migration failed, continuing...'; node dist/server.js"]
