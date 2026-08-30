FROM node:24-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS development
COPY . .
RUN pnpm install --frozen-lockfile

FROM development AS build
RUN pnpm build

FROM build AS web-production
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@mcp-wallet/web", "start"]

FROM build AS api-production
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "--filter", "@mcp-wallet/api", "start"]

FROM build AS worker-production
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@mcp-wallet/worker", "start"]
