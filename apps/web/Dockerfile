FROM oven/bun:1 AS build
WORKDIR /repo

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_LIVEKIT_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL

COPY . .
RUN bun install --frozen-lockfile
RUN bun run --cwd packages/db generate
RUN bun --cwd apps/web run next build

FROM oven/bun:1-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo

EXPOSE 3000
CMD ["bun", "--cwd", "apps/web", "run", "next", "start"]
