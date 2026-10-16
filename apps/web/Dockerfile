# Static image for the browser app (@anonmatch/web): the Vite build served by
# nginx. Build context is the REPO ROOT because of the pnpm workspace:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_GOOGLE_CLIENT_ID=... \
#     --build-arg VITE_SERVER_URL=https://api.example.com \
#     -t anonmatch-web .

# ---- build stage ----
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

# Manifests only, so the dependency layer is cached until the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @anonmatch/web...

# Sources last: editing code must not invalidate the install layer.
# tsconfig.base.json is the shared root tsconfig that both apps extend; the
# web build's `tsc --noEmit` step needs it.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# Vite inlines import.meta.env at build time, so these are not runtime-config.
# VITE_GOOGLE_CLIENT_ID must equal the server's GOOGLE_CLIENT_ID.
ARG VITE_SERVER_URL=""
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_SERVER_URL=$VITE_SERVER_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN pnpm --filter @anonmatch/web build

# ---- runtime stage: nginx serving the static bundle ----
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
