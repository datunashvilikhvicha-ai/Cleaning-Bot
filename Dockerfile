FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN npm run build || echo "No build step configured"

ENV NODE_ENV=production
CMD ["node", "dist/server/app.js"]
