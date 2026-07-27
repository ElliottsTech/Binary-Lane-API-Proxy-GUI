# ---- Stage 1: build the React SPA with Vite ----
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
# Use npm install (no committed lockfile yet); generates package-lock.json in image
RUN npm install
COPY client/ ./client/
COPY vite.config.js ./
COPY index.html ./
RUN npm run build

# ---- Stage 2: runtime (Express + better-sqlite3) ----
FROM node:22-slim AS runtime
WORKDIR /app

# better-sqlite3 needs build tooling
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev
COPY server/ ./server/
COPY --from=build /app/server/public ./server/public

ENV NODE_ENV=production
ENV PORT=7100
EXPOSE 7100

# SQLite DB lives in the mounted volume
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
