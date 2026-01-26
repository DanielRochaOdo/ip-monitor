FROM node:20-bookworm-slim

WORKDIR /app

# ICMP ping inside containers needs the ping binary.
RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]

