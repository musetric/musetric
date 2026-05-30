ARG RUNTIME_IMAGE=musetric-runtime
FROM ${RUNTIME_IMAGE} AS builder
RUN npm install -g corepack@latest
RUN corepack enable
RUN corepack prepare yarn@4.12.0 --activate
COPY . .
RUN yarn install --immutable
RUN yarn project:build
RUN yarn project:init
RUN rm -rf node_modules
RUN yarn workspaces focus @musetric/backend --production

FROM ${RUNTIME_IMAGE} AS runner
ENV PROTOCOL=http
ENV PORT=80

COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/storage ./packages/backend/storage

COPY --from=builder /app/packages/backend-db/package.json ./packages/backend-db/package.json
COPY --from=builder /app/packages/backend-db/dist ./packages/backend-db/dist

COPY --from=builder /app/packages/api/package.json ./packages/api/package.json
COPY --from=builder /app/packages/api/dist ./packages/api/dist

COPY --from=builder /app/packages/resource-utils/package.json ./packages/resource-utils/package.json
COPY --from=builder /app/packages/resource-utils/dist ./packages/resource-utils/dist

COPY --from=builder /app/packages/toolkit/package.json ./packages/toolkit/package.json
COPY --from=builder /app/packages/toolkit/dist ./packages/toolkit/dist

WORKDIR /app/packages/backend
EXPOSE 80

CMD ["node", "./dist/index.js"]
