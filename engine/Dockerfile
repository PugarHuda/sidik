# Sidik engine — anvil-backed fork executor.
# Build from the REPO ROOT: `docker build -f engine/Dockerfile .`
# (needs the root pnpm workspace: package.json, pnpm-workspace.yaml, pnpm-lock.yaml, shared/, engine/)

FROM node:24-bookworm-slim

# Non-root user the whole image (Foundry install + app process) runs as —
# anvil doesn't need root, so don't give it root.
RUN useradd --create-home --shell /bin/bash app

# Foundry (anvil) — the only non-npm dependency. foundryup installs into
# $FOUNDRY_DIR/bin; put it on PATH before the actual process runs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
ENV FOUNDRY_DIR=/home/app/.foundry
ENV PATH="${FOUNDRY_DIR}/bin:${PATH}"
# ponytail: piping the official Foundry HTTPS installer is their documented
# install method, not a shortcut we invented — full checksum-pinning of the
# installer script itself is over-engineering for a demo engine. The one
# thing that *does* matter (which binary you end up running) is pinned
# below via `foundryup -i`, and foundryup itself does SHA-verify the
# binaries it downloads. Runs as `app` so ~/.foundry lands in its home,
# no root needed and no chown pass required afterward.
USER app
RUN curl -L https://foundry.paradigm.xyz | bash && foundryup -i v1.7.1
USER root

# pnpm via corepack (matches the pnpm version pinned in web/package.json;
# engine has no packageManager field of its own).
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /app
RUN chown app:app /app

# Manifests first so `pnpm install` is cached independently of source edits.
# web/ is intentionally never copied into this image — it's a separate
# Vercel deploy — so the workspace install only ever resolves shared+engine.
COPY --chown=app:app package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --chown=app:app shared/package.json shared/package.json
COPY --chown=app:app engine/package.json engine/package.json
USER app
# --filter ...@sidik/engine = the engine plus everything it depends on
# (shared) — skips web's next/eslint/tailwind deps entirely.
RUN pnpm install --filter "...@sidik/engine"

COPY --chown=app:app shared shared
COPY --chown=app:app engine engine

EXPOSE 8787
ENV PORT=8787
# Required at runtime (set on the host, e.g. Railway/Fly): BASE_ARCHIVE_RPC,
# AI_GATEWAY_API_KEY. Optional: BASE_FORK_BLOCK (pins the fork for
# reproducible demo runs), PORT (defaults to 8787).
CMD ["pnpm", "--filter", "@sidik/engine", "start"]
