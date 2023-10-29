'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const stream = require('node:stream');
const tar = require('tar');
const kControlPort = 7000;
const kDataPort = 8000;
let readyCode = 500;
let handler = function(req, res) {
  res.writeHead(500);
  res.end('uninitialized\n');
};

const promises = [
  new Promise((resolve, reject) => {
    try {
      const server = http.createServer((req, res) => {
        handler(req, res);
      });

      server.listen(kDataPort);
      resolve();
    } catch (err) {
      reject(err);
    }
  }),
  new Promise((resolve, reject) => {
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
  new Promise(async (resolve, reject) => {
    try {
      console.log(`Downloading '${process.env.ASTEROID_DEPLOYMENT_PACKAGE_URL}'`);
      const response = await fetch(process.env.ASTEROID_DEPLOYMENT_PACKAGE_URL);
      const destination = '/tmp/deployment.tar.gz';
      await response.body.pipeTo(stream.Writable.toWeb(fs.createWriteStream(destination)));
      await tar.extract({ cwd: '/src', file: destination, strip: 2 });
      process.chdir('/src');
      const entryPath = path.resolve(
        process.env.ASTEROID_DEPLOYMENT_PACKAGE_ENTRY
      );
      const entry = require(entryPath);
      handler = entry[process.env.ASTEROID_DEPLOYMENT_PACKAGE_EXPORT];
      resolve();
    } catch (err) {
      console.log(err);
      reject(err);
    }
  }),
];

Promise.allSettled(promises).then((results) => {
  if (results[0].status === 'rejected' ||
      results[1].status === 'rejected' ||
      results[2].status === 'rejected') {
    process.exit(1);
  }

  readyCode = 200;
});
