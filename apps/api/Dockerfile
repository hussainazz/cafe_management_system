# Build from the repository root:
#   docker build -f apps/api/Dockerfile .
FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @cafe/contracts build \
  && pnpm --filter @cafe/api prisma:generate \
  && pnpm --filter @cafe/api build \
  && pnpm deploy --filter @cafe/api --prod /runtime
RUN cp -R apps/api/dist /runtime/dist
RUN cp apps/api/prisma.config.ts /runtime/prisma.config.ts \
  && cp -R apps/api/prisma /runtime/prisma

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /runtime ./

USER node
EXPOSE 3001
CMD ["node", "dist/src/server.js"]
