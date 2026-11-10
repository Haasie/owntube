# Build from the repo root (workspace context):
#   docker build -f apps/web/Dockerfile -t owntube .
# Run:  docker compose up
#
# Drie stages: `build` (alles, voor `next build`), `proddeps` (alleen
# productie-afhankelijkheden, native modules gecompileerd) en de runtime.
# Bouwgereedschap (g++, python3), devDependencies en pnpm zelf komen niet in
# het image dat draait.

# 22.23.4: CVE-2026-111497 (zie dfccd30). Digest vastgepind; Dependabot stelt updates voor.
FROM node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS base
WORKDIR /app
# OS_PATCH_DATE (datum, gezet door CI) breekt de buildcache van deze laag één keer per
# dag; anders hergebruikt cache-from type=gha de oude laag en patcht dit niets.
# curl: de playback-hooks (OWNTUBE_HOOKS_DIR) beloven shellscripts toegang tot
# de buitenwereld — zie hooks/README.md.
ARG OS_PATCH_DATE=unset
RUN echo "OS-patches van ${OS_PATCH_DATE}" \
  && apt-get update \
  && apt-get -y upgrade \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS toolchain
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
# Install only the web workspace (and its deps) from the root lockfile.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
# Shared workspace package the web app depends on (@owntube/brand-icon).
COPY packages/brand-icon/package.json packages/brand-icon/package.json

FROM toolchain AS proddeps
RUN pnpm install --frozen-lockfile --prod --filter web...

FROM toolchain AS build
RUN pnpm install --frozen-lockfile --filter web...
COPY packages/brand-icon packages/brand-icon
COPY apps/web apps/web
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so they
# must be declared ARG + re-exposed as ENV before `next build` runs — compose
# passing them via `args:` alone has no effect without this.
ARG NEXT_PUBLIC_MEDIA_BASE_URL=""
ENV NEXT_PUBLIC_MEDIA_BASE_URL=$NEXT_PUBLIC_MEDIA_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web
RUN pnpm run build \
  && rm -rf node_modules .next/cache

FROM base AS runtime
ARG GIT_SHA=dev
ENV OWNTUBE_VERSION=${GIT_SHA} \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=/app/apps/web/data/owntube.db \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# npm/npx/corepack uit het basis-image zijn hier aanvalsoppervlak zonder nut.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/apps/web ./apps/web
COPY --from=proddeps /app/apps/web/node_modules ./apps/web/node_modules
# De commando's van de containers staan in Cosmos (`pnpm exec tsx …`,
# `pnpm run start`, `pnpm warm:cache`); deze shim voert ze uit zonder pnpm zelf.
COPY apps/web/scripts/pnpm-shim.sh /usr/local/bin/pnpm
RUN chmod 0755 /usr/local/bin/pnpm && mkdir -p /app/apps/web/data
WORKDIR /app/apps/web

EXPOSE 3000
CMD ["sh", "-c", "pnpm exec tsx scripts/migrate.ts && pnpm run start"]
