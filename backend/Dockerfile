# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14-alpine AS dependencies

WORKDIR /app/backend

COPY backend/package.json backend/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    BACKEND_PORT=4111

COPY --from=dependencies --chown=bun:bun /app/backend/node_modules ./backend/node_modules
COPY --chown=bun:bun backend/package.json ./backend/package.json
COPY --chown=bun:bun backend/src ./backend/src
COPY --chown=bun:bun game-data-parsed ./game-data-parsed

RUN mkdir -p /archives && chown bun:bun /archives

USER bun
WORKDIR /app/backend

EXPOSE 4111

CMD ["bun", "run", "start"]
