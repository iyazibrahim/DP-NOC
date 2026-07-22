# Prefer AWS Public ECR mirror of Docker Hub official images (more reliable than registry-1.docker.io).
# Override at build time: --build-arg NODE_IMAGE=node:20-bookworm-slim
#
# Build context MUST be sites/templates/site-box (parent of collector-console)
# so generate-config.sh / validate-config.sh can be baked into the image.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:20-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY collector-console/package.json collector-console/package-lock.json* ./
RUN npm install
COPY collector-console/tsconfig.json ./
COPY collector-console/src ./src
RUN npm run build

FROM ${NODE_IMAGE}
# docker CLI for socket access (restart/logs). Compose binary optional — we prefer `docker restart`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash python3 ca-certificates docker.io \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY collector-console/package.json collector-console/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY collector-console/public ./public
# Toolkit always present even if Dokploy bind-mounts the wrong host path into /data
COPY generate-config.sh validate-config.sh blackbox.yml snmp.yml /opt/sitebox/
RUN chmod +x /opt/sitebox/generate-config.sh /opt/sitebox/validate-config.sh
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV SITEBOX_TOOLKIT_DIR=/opt/sitebox
ENV PORT=8090
EXPOSE 8090
CMD ["node", "dist/index.js"]
