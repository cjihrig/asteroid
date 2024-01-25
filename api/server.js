'use strict';
const { randomUUID } = require('node:crypto');
const { mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  CreateBucketCommand,
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
const objectKey = randomUUID();

async function uploadTarFile() {
  let tmpDir;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), 'asteroid'));
  } catch (err) {
    console.error('could not create temp directory');
    console.error(err);
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

    await s3.send(putCmd);
  } catch (err) {
    console.error('failed to upload tar file');
    console.error(err);
    process.exit(1);
  }
}

async function createBucket() {
  try {
    const createBucketCmd = new CreateBucketCommand({ Bucket: bucketName });
    await s3.send(createBucketCmd);
  } catch (err) {
    if (err.Code !== 'BucketAlreadyOwnedByYou') {
      console.error('could not create bucket');
      console.error(err);
      process.exit();
    }
  }
}

async function main() {
  try {
    await createBucket();
    await uploadTarFile();

    try {
      await pgClient.connect();
      // TODO(cjihrig): This needs to be a transaction/sproc to ensure only a single deployment per host is current.
      const sql = 'SELECT * FROM create_deployment($1, $2, $3, $4, $5, TRUE)';
      const values = [objectKey, 'foobar.com', bucketName, 'source.js', 'handler'];
      const result = await pgClient.query(sql, values);

      console.log('CREATED RECORD IN DATABASE');
      console.log(result.rows[0]);
      // console.log('PUSHING NOTIFICATION');
      // const { id, host } = result.rows[0];
      // const msg = JSON.stringify({ action: 'new_deployment', id, host });
      // console.log(msg);
      // await pgClient.query(`NOTIFY asteroid_notifications, '${msg}'`);
    } catch (err) {
      console.error('failed to create deployment in database');
      console.error(err);
      process.exit(1);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

// Give the gateway time to start.
setTimeout(main, 5000);
