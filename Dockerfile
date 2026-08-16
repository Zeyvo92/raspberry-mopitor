# ---- build the React SPA ----
# The SPA output is plain static files, identical for every target arch:
# build it once on the build host (natively, no QEMU). This also avoids
# lightningcss (Tailwind v4) lacking a prebuilt binary on 32-bit ARM musl.
FROM --platform=$BUILDPLATFORM node:24-alpine AS client-build
WORKDIR /build
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- build the server ----
FROM node:24-alpine AS server-build
WORKDIR /build
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- minimal runtime ----
# Node 24 for node:sqlite (history), which is built in — no native module to
# compile on the Pi, nothing extra in the image.
FROM node:24-alpine
# set from the git tag by the release workflow; shown in the dashboard header
ARG VERSION=dev
ENV NODE_ENV=production \
    STATIC_DIR=/app/public \
    HISTORY_DB=/data/history.db \
    APP_VERSION=$VERSION
WORKDIR /app
COPY --from=server-build /build/node_modules ./node_modules
COPY --from=server-build /build/dist ./dist
COPY --from=server-build /build/package.json ./package.json
COPY --from=client-build /build/dist ./public
# history lives on a named volume; create it here so the volume inherits an
# ownership the unprivileged runtime user can actually write to
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8585
USER node
CMD ["node", "dist/server.js"]
