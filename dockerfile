FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json gulpfile.js index.js ./
COPY nodes ./nodes

RUN corepack enable && corepack prepare pnpm@9.1.4 --activate
RUN pnpm install --ignore-scripts
RUN pnpm build

RUN mkdir -p /out/n8n-nodes-playwright \
    && cp package.json /out/n8n-nodes-playwright/package.json \
    && cp -R dist /out/n8n-nodes-playwright/dist \
    && cp -R node_modules /out/n8n-nodes-playwright/node_modules

# FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS browsers

FROM n8nio/n8n:2.8.3

USER root

RUN mkdir -p /opt/custom-nodes/n8n-nodes-playwright /opt/playwright-browsers

COPY --from=builder /out/n8n-nodes-playwright/ /opt/custom-nodes/n8n-nodes-playwright/
# COPY --from=browsers /ms-playwright/ /opt/playwright-browsers/

RUN test -d /opt/custom-nodes/n8n-nodes-playwright/node_modules
# RUN test -d /opt/playwright-browsers

USER node

WORKDIR /home/node

CMD ["start"]