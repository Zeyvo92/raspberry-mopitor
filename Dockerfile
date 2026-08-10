# ---- build the React SPA ----
FROM node:22-alpine AS client-build
WORKDIR /build
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- build the server ----
FROM node:22-alpine AS server-build
WORKDIR /build
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- minimal runtime ----
FROM node:22-alpine
# set from the git tag by the release workflow; shown in the dashboard header
ARG VERSION=dev
ENV NODE_ENV=production \
    STATIC_DIR=/app/public \
    APP_VERSION=$VERSION
WORKDIR /app
COPY --from=server-build /build/node_modules ./node_modules
COPY --from=server-build /build/dist ./dist
COPY --from=server-build /build/package.json ./package.json
COPY --from=client-build /build/dist ./public
EXPOSE 8585
USER node
CMD ["node", "dist/server.js"]
