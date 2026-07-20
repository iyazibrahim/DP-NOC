# Multi-stage: build React UI + TypeScript API, serve both from one Node process.
FROM node:20-alpine AS ui-build
WORKDIR /ui
COPY frontend/wallboard/package.json frontend/wallboard/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/wallboard/ ./
RUN npm run build

FROM node:20-alpine AS api-build
WORKDIR /api
COPY backend/noc-api/package.json backend/noc-api/package-lock.json* ./
RUN npm ci || npm install
COPY backend/noc-api/tsconfig.json ./
COPY backend/noc-api/src ./src
COPY backend/noc-api/data ./data
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY backend/noc-api/package.json backend/noc-api/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY --from=api-build /api/dist ./dist
COPY --from=api-build /api/data ./data
COPY --from=ui-build /ui/dist ./public

RUN mkdir -p /app/data/layouts /app/data/runtime

EXPOSE 8080
CMD ["node", "dist/index.js"]
