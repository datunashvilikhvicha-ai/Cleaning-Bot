FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN npm run build || echo "No build step configured"

ENV NODE_ENV=production
CMD ["node", "server.js"]
