# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS tooling
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@12.5.1
WORKDIR /app
RUN chown node:node /app
USER node

FROM tooling AS dependencies
COPY --chown=node:node package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
COPY --chown=node:node apps/worker/package.json ./apps/worker/package.json
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node packages/contracts/package.json ./packages/contracts/package.json
COPY --chown=node:node packages/database/package.json ./packages/database/package.json
COPY --chown=node:node packages/platform/package.json ./packages/platform/package.json
COPY --chown=node:node packages/stellar/package.json ./packages/stellar/package.json
COPY --chown=node:node packages/application/package.json ./packages/application/package.json
RUN --mount=type=cache,id=clarix-pnpm-store,target=/home/node/.local/share/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --store-dir /home/node/.local/share/pnpm/store

FROM dependencies AS development
COPY --chown=node:node . .
RUN pnpm db:generate && pnpm --filter './packages/*' -r build

FROM development AS backend
RUN pnpm build
ENV NODE_ENV=production
CMD ["node", "apps/api/dist/main.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=backend /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
