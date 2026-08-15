# Sidik engine — anvil-backed fork executor.
# Build from the REPO ROOT: `docker build -f engine/Dockerfile .`
# (needs the root pnpm workspace: package.json, pnpm-workspace.yaml, pnpm-lock.yaml, shared/, engine/)

FROM node:24-bookworm-slim

# Foundry (anvil) — the only non-npm dependency. foundryup installs into
# $FOUNDRY_DIR/bin; put it on PATH before the actual process runs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
ENV FOUNDRY_DIR=/root/.foundry
ENV PATH="${FOUNDRY_DIR}/bin:${PATH}"
RUN curl -L https://foundry.paradigm.xyz | bash && foundryup

# pnpm via corepack (matches the pnpm version pinned in web/package.json;
# engine has no packageManager field of its own).
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /app

# Manifests first so `pnpm install` is cached independently of source edits.
# web/ is intentionally never copied into this image — it's a separate
# Vercel deploy — so the workspace install only ever resolves shared+engine.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/package.json
COPY engine/package.json engine/package.json
# --filter ...@sidik/engine = the engine plus everything it depends on
# (shared) — skips web's next/eslint/tailwind deps entirely.
RUN pnpm install --filter "...@sidik/engine"

COPY shared shared
COPY engine engine

EXPOSE 8787
ENV PORT=8787
# Required at runtime (set on the host, e.g. Railway/Fly): BASE_ARCHIVE_RPC,
# AI_GATEWAY_API_KEY. Optional: BASE_FORK_BLOCK (pins the fork for
# reproducible demo runs), PORT (defaults to 8787).
CMD ["pnpm", "--filter", "@sidik/engine", "start"]
