FROM node:26-alpine
RUN apk upgrade --no-cache
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
