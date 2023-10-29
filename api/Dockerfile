FROM node:20-alpine AS builder

FROM node:20-alpine AS app
COPY --chown=node:node server.js server.js
COPY --chown=node:node package.json package.json
RUN npm install --omit=dev
ENV NODE_ENV=production
USER node
CMD ["node", "server.js"]
