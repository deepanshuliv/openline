FROM oven/bun:1 AS build
WORKDIR /repo

COPY . .
RUN bun install --frozen-lockfile
RUN bun run --cwd packages/db generate
RUN bun run --cwd apps/agent build

FROM oven/bun:1-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo

CMD ["bun", "run", "--cwd", "apps/agent", "start"]
