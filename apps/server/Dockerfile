# Production image for the realtime server (@anonmatch/server).
#
# Build context is the REPO ROOT, not this directory: the pnpm workspace
# lockfile and the @anonmatch/shared workspace package both live outside
# apps/server. Build it with:
#
#   docker build -f apps/server/Dockerfile -t anonmatch-server .

# ---- build stage: install the workspace and compile the server ----
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

# Manifests only, so the dependency layer is cached until the lockfile changes.
# Every workspace manifest listed in pnpm-workspace.yaml must be present for
# --frozen-lockfile to validate, even the ones this image never builds.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @anonmatch/server...

# Sources last: editing code must not invalidate the install layer.
# tsconfig.base.json is the shared root tsconfig that both apps extend.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @anonmatch/server build

# ---- runtime stage: production deps + compiled output only ----
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @anonmatch/server...

COPY --from=build /app/apps/server/dist apps/server/dist

# Matches the default PORT in src/config.ts; override with -e PORT=...
EXPOSE 4000

# tsup bundles @anonmatch/shared, so only the server's own dist is needed.
CMD ["node", "apps/server/dist/index.js"]
