FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app/server

CMD ["node", "index.js"]
