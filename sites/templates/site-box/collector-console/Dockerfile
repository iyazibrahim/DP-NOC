# Prefer AWS Public ECR mirror of Docker Hub official images (more reliable than registry-1.docker.io).
# Override at build time: --build-arg NODE_IMAGE=node:20-bookworm-slim
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:20-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE}
# docker CLI for socket access (restart/logs). Compose binary optional — we prefer `docker restart`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash python3 ca-certificates docker.io \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8090
EXPOSE 8090
CMD ["node", "dist/index.js"]
