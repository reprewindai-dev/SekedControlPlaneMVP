FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm install --production && npm cache clean --force

COPY tsconfig.json ./
COPY src/ ./src/
COPY ../../SEKED_PLATFORM_SCHEMA.prisma ./SEKED_PLATFORM_SCHEMA.prisma

RUN npm run prisma:generate
RUN npm run build

CMD ["node", "dist/worker.js"]
