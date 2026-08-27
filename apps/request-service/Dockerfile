FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/request-service/package.json apps/request-service/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json

RUN npm ci --omit=dev --workspace @evacuva/request-service

COPY apps/request-service/src apps/request-service/src
COPY packages/contracts/src packages/contracts/src
COPY packages/core/src packages/core/src

USER node
EXPOSE 3000

CMD ["node", "apps/request-service/src/runRequestService.js"]
