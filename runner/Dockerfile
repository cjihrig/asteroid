FROM node:20-alpine
WORKDIR /runner
EXPOSE 7000
EXPOSE 8000
ENV NODE_ENV=production
RUN apk --no-cache add -X http://dl-cdn.alpinelinux.org/alpine/edge/testing tini
ENTRYPOINT ["tini", "--"]
COPY --chown=node:node runner.js runner.js
COPY --chown=node:node init.sh init.sh
USER node
WORKDIR /src
CMD ["/runner/init.sh"]
