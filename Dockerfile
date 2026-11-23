FROM node:20-bookworm-slim

WORKDIR /app

# sqlite3 may need native build tools if a prebuilt binary is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DATABASE_PATH=/data/anime.db
RUN mkdir -p /data
VOLUME ["/data"]

CMD ["npm", "start"]
