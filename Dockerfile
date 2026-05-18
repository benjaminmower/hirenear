FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY client/package*.json ./client/
RUN cd client && npm ci

COPY client ./client
RUN cd client && npm run build

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server
RUN cp -R client/dist server/public

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app/server

CMD ["node", "index.js"]
