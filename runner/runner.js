'use strict';
const http = require('node:http');
const path = require('node:path');
const kControlPort = 7000;
const kDataPort = 8000;
const {
  ASTEROID_DEPLOYMENT_PACKAGE_ENTRY,
  ASTEROID_DEPLOYMENT_PACKAGE_EXPORT,
} = process.env;
let readyCode = 500;

const promises = [
  new Promise((resolve, reject) => {
    try {
      const entryPath = path.resolve(ASTEROID_DEPLOYMENT_PACKAGE_ENTRY);
      const entry = require(entryPath);
      const handler = entry[ASTEROID_DEPLOYMENT_PACKAGE_EXPORT];
      const server = http.createServer(handler);

      server.listen(kDataPort);
      resolve();
    } catch (err) {
      reject(err);
    }
  }),
  new Promise((resolve, reject) => {
    // TODO(cjihrig): Move this out of process.
    try {
      const server = http.createServer((req, res) => {
        res.writeHead(readyCode);
        res.end();
      });

      server.listen(kControlPort);
      resolve();
    } catch (err) {
      reject(err);
    }
  }),
];

Promise.allSettled(promises).then((results) => {
  if (results[0].status === 'rejected' || results[1].status === 'rejected') {
    process.exit(1);
  }

  readyCode = 200;
});
