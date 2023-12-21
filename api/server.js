'use strict';
const { mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  CreateBucketCommand,
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const pg = require('pg');
const tar = require('tar');
const pgClient = new pg.Client({
  host: 'asteroid-postgres-service.default.svc.cluster.local',
  port: 5432,
  database: 'asteroid',
  user: 'admin',
  password: 'admin',
});
const s3 = new S3Client({
  credentials: {
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  },
  region: 'us-east-1',
  endpoint: 'http://asteroid-minio-service.default.svc.cluster.local:9000',
  forcePathStyle: true,
});

const bucketName = 'asteroid-deployments';
let objectKey;

(async () => {
  try {
    let tmpDir;

    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'asteroid'));
    } catch (err) {
      console.log('could not create temp directory');
      console.log(err);
      process.exit(1);
    }

    try {
      const createBucketCmd = new CreateBucketCommand({ Bucket: bucketName });

      console.log(await s3.send(createBucketCmd));
    } catch (err) {
      if (err.Code !== 'BucketAlreadyOwnedByYou') {
        console.log(err);
      }
    }

    try {
      await pgClient.connect();
      const sql = 'INSERT INTO deployments (host, bucket_name, entry_file, handler) VALUES ($1, $2, $3, $4) RETURNING *';
      const values = ['foobar.com', bucketName, 'source.js', 'handler'];
      const result = await pgClient.query(sql, values);

      console.log('CREATED RECORD IN DATABASE');
      console.log(result.rows[0]);
      objectKey = result.rows[0].id;
    } catch (err) {
      console.log('failed to create deployment in database');
      console.log(err);
      process.exit(1);
    }

    try {
      const tarFile = join(tmpDir, objectKey);
      const tmpFile = join(tmpDir, 'source.js');
      const source = `
'use strict';
function handler(req, res) {
  res.writeHead(200);
  res.end('hello deployed app\\n');
}

module.exports = { handler };
      `;
      await writeFile(tmpFile, source);
      await tar.create({
        cwd: tmpDir,
        file: tarFile,
        gzip: true,
      }, [tmpFile]);

      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Body: await readFile(tarFile),
      });

      console.log(await s3.send(putCmd));
    } catch (err) {
      console.log('failed to upload file');
      console.log(err);
      process.exit(1);
    }

    try {
      const listBucketsResult = await s3.send(new ListBucketsCommand({}));
      console.log('ListBucketsResult:', listBucketsResult.Buckets);
    } catch (err) {
      console.log(err);
    }

    try {
      const getCmd = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      });
      const url = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 3 });

      console.log(url);

      const response = await fetch(url);
      // TODO(cjihrig): Verify 200 response.
      console.log(response);
      const buffer = await response.arrayBuffer();
      console.log(buffer);
    } catch (err) {
      console.log(err);
    }
  } catch (err) {
    console.log(err);
  }
})();
