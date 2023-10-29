FROM node:20-alpine AS app
COPY --chown=node:node runner.js runner.js
COPY --chown=node:node package.json package.json
RUN npm install --omit=dev
RUN mkdir /src && chown node /src
USER node
ENV NODE_ENV=production
CMD ["node", "runner.js"]
