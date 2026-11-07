FROM node:26-alpine

# Refresh the Alpine index and take the distributor's fixed OS packages
# (e.g. zlib 1.4-r0 for ALPINE-CVE-2026-4738) in the final image.
RUN apk upgrade --no-cache \
 && apk add --no-cache --upgrade zlib libssl3 libcrypto3 \
 && rm -rf /var/cache/apk/*

WORKDIR /app

# Install full dependency tree first so the production bundles can be built.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# The server binds 0.0.0.0:$PORT and serves dist/client plus the /api routes.
CMD ["npm", "start"]
