FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/route-worker/package.json apps/route-worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json

RUN npm ci --omit=dev \
    --workspace @evacuva/route-worker \
    --workspace @evacuva/contracts \
    --workspace @evacuva/core

COPY apps/route-worker/src apps/route-worker/src
COPY packages/contracts/src packages/contracts/src
COPY packages/core/src packages/core/src

USER node

CMD ["node", "apps/route-worker/src/runRouteWorker.js"]
