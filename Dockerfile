# ── Build stage: instalar solo dependencias de producción ──
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Production stage ──
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/uploads

ENV NODE_ENV=production
EXPOSE 3000

# Correr migraciones pendientes y luego iniciar el server
CMD ["sh", "-c", "npx sequelize-cli db:migrate --env production && node index.js"]
