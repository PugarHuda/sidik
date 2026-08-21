# Sidik engine, packaged for a Hugging Face Docker Space.
#
# UNUSABLE ON A FREE ACCOUNT as of 2026-08-21: creating this Space returns
# 402, "hosting Gradio and Docker Spaces on free cpu-basic requires a PRO
# subscription". Only static Spaces are free. Kept because it is correct and
# one PRO subscription away from working.
#
# This Space deliberately holds no source of its own: it clones the repo at
# build time, so engine/ and shared/ exist in exactly one place and cannot
# drift from what is on GitHub. Rebuild the Space to pick up new commits, or
# set SIDIK_REF to a tag or commit to pin one.
#
# Required secret (Space settings -> Variables and secrets): BASE_ARCHIVE_RPC.
# Optional: VENICE_API_KEY (planner + narrator prose; without it both fall
# back to deterministic behaviour and no verdict changes), SIDIK_MODEL,
# BASE_FORK_BLOCK.

FROM node:24-bookworm-slim

ARG SIDIK_REPO=https://github.com/PugarHuda/sidik.git
ARG SIDIK_REF=master

# Foundry is the only non-npm dependency; git is also what fetches the source.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# Spaces run the container as uid 1000, which on this image is the `node`
# user — so install Foundry into its home rather than root's, or the binaries
# land somewhere the running process cannot reach.
ENV FOUNDRY_DIR=/home/node/.foundry
ENV PATH="${FOUNDRY_DIR}/bin:${PATH}"

USER node
# ponytail: piping the official Foundry HTTPS installer is their documented
# install method, not a shortcut invented here. The thing that actually
# matters — which binary ends up running — is pinned by `foundryup -i`, and
# foundryup SHA-verifies what it downloads.
RUN curl -L https://foundry.paradigm.xyz | bash && foundryup -i v1.7.1

USER root
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app
RUN chown node:node /app

USER node
RUN git clone --depth 1 --branch "${SIDIK_REF}" "${SIDIK_REPO}" /app
# --filter ...@sidik/engine = the engine plus what it depends on (shared),
# skipping web's next/eslint/tailwind entirely — web deploys to Vercel.
RUN pnpm install --filter "...@sidik/engine"

# Must match app_port in README.md's front matter.
ENV PORT=8787
EXPOSE 8787
CMD ["pnpm", "--filter", "@sidik/engine", "start"]
