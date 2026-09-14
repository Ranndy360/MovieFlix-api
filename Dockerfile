# syntax=docker/dockerfile:1

###############################################################################
# MovieFlix API
#
# Multi-stage so the shipped image carries the compiled output and production
# dependencies only — no TypeScript, no test suite, no Nest CLI.
#
# Debian slim rather than Alpine on purpose: `bcrypt` and `sharp` are native
# modules. Both publish prebuilt binaries for glibc, while musl either lacks a
# prebuild or needs a compiler in the final image. Alpine would save ~60MB and
# cost a toolchain plus a class of runtime surprises.
###############################################################################

# Pinned to a minor: a moving `node:22` tag turns a reproducible build into a
# lottery the day upstream ships a breaking patch.
FROM node:22.14-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# --- dependencies (all of them, including dev — the build needs the compiler) --
FROM base AS deps
# Only the manifests, so this layer is cached until a dependency actually
# changes. Copying the source first would invalidate the install on every edit.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# --- build -------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN npm run build

# --- production dependencies -------------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
# `--omit=dev` explicitly rather than relying on NODE_ENV: the npm versions
# differ on whether NODE_ENV alone is enough, and this leaves nothing to infer.
RUN npm ci --omit=dev && npm cache clean --force

# --- runtime -----------------------------------------------------------------
FROM base AS runtime

# `node` is an unprivileged user the official image already provides. Running
# as root inside a container is a privilege the process has no use for.
ENV PORT=3001

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

# `database/` and `.sequelizerc` ship too: migrations run from this image, and
# `scripts/deploy-start.js` is what runs them.
COPY --chown=node:node package.json .sequelizerc ./
COPY --chown=node:node database ./database
COPY --chown=node:node scripts ./scripts

USER node

EXPOSE 3001

# Liveness, not readiness: readiness touches the database, and a container is
# not unhealthy because something it depends on is briefly unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/liveness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Serve only. Migrations are a deployment step, not something every replica
# should race to perform on boot — see `command:` in docker-compose.yml for the
# single-instance convenience, and the README for the one-off form.
CMD ["node", "dist/main.js"]
