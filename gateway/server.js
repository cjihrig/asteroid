'use strict';
const { EventEmitter, once } = require('node:events');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const hapi = require('@hapi/hapi');
const h2o2 = require('@hapi/h2o2');
const k8s = require('@kubernetes/client-node');
const pg = require('pg');
const kubeconfig = new k8s.KubeConfig();
const kAppNamespace = 'apps';
const kPodWatchPath = `/api/v1/namespaces/${kAppNamespace}/pods`;
const kPodWatchOptions = { allowWatchBookmarks: true };
const k8sEvents = new EventEmitter();
const kControlPort = 7000;
const kDataPort = 8000;

// TODO(cjihrig): Move this tracking to database.
const activeDeployments = new Map();

const s3 = new S3Client({
  credentials: {
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  },
  region: 'us-east-1',
  endpoint: 'http://asteroid-minio-service.default.svc.cluster.local:9000',
  forcePathStyle: true,
});

function podWatchHandler(type, apiObj, watchObj) {
  const status = watchObj?.object?.status;

  if (status?.phase === 'Running' && status.containerStatuses?.[0]?.ready) {
    k8sEvents.emit('pod', apiObj);
  }
}

function podWatchExit(err) {
  console.log(err);
}

kubeconfig.loadFromDefault();

const client = kubeconfig.makeApiClient(k8s.CoreV1Api);
const watcher = new k8s.Watch(kubeconfig);
const pgClient = new pg.Client({
  host: 'asteroid-postgres-service.default.svc.cluster.local',
  port: 5432,
  database: 'asteroid',
  user: 'admin',
  password: 'admin',
});

// watch() returns an object with an 'abort()' method.
watcher.watch(kPodWatchPath, kPodWatchOptions, podWatchHandler, podWatchExit);

// TODO(cjihrig): Move the reaper to its own process.
async function reaper() {
  for (const deployment of activeDeployments.values()) {
    deployment.generation++;

    if (deployment.generation > 1) {
      await client.deleteNamespacedPod(deployment.deployment, kAppNamespace);
      activeDeployments.delete(deployment.host);
    }
  }
}

setInterval(reaper, 60 * 1000);

async function lookupHostConfig(host) {
  const sql = 'SELECT id, bucket_name, entry_file, handler FROM deployments WHERE host = $1';
  const result = await pgClient.query(sql, [host]);

  if (result.rowCount !== 1) {
    return null;
  }

  const {
    id: deployment,
    bucket_name: bucketName,
    entry_file: entry,
    handler,
  } = result.rows[0];
  const getCmd = new GetObjectCommand({
    Bucket: bucketName,
    Key: deployment,
  });
  const url = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 3 });

  return {
    deployment,
    entry,
    generation: 0,
    handler,
    host,
    pod: null,
    url,
  };
}

async function createFunctionPod(config) {
  try {
    const podDefinition = {
      metadata: {
        name: config.deployment,
        namespace: kAppNamespace,
      },
      spec: {
        hostIPC: false,
        hostNetwork: false,
        hostPID: false,
        containers: [
          {
            name: 'asteroid-runner',
            image: 'asteroid-runner',
            imagePullPolicy: 'IfNotPresent',
            env: [
              {
                name: 'ASTEROID_DEPLOYMENT_PACKAGE_URL',
                value: config.url,
              },
              {
                name: 'ASTEROID_DEPLOYMENT_PACKAGE_ENTRY',
                value: config.entry,
              },
              {
                name: 'ASTEROID_DEPLOYMENT_PACKAGE_EXPORT',
                value: config.handler,
              },
            ],
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: {
                drop: ['ALL'],
                add: ['NET_BIND_SERVICE'],
              },
              privileged: false,
              runAsNonRoot: true,
              runAsUser: 1000,
              seccompProfile: {
                type: 'RuntimeDefault',
              },
            },
            readinessProbe: {
              httpGet: {
                path: '/',
                port: kControlPort,
              },
              periodSeconds: 1,
            },
          },
        ],
        ports: [
          {
            name: 'http-control',
            containerPort: kControlPort,
            hostPort: kControlPort,
          },
          {
            name: 'http-data',
            containerPort: kDataPort,
            hostPort: kDataPort,
          },
        ],
        restartPolicy: 'Never',
      },
    };
    await client.createNamespacedPod(kAppNamespace, podDefinition);
    // TODO(cjihrig): This is a bug. The event might be for a different pod.
    const [result] = await once(k8sEvents, 'pod');
    return result;
  } catch (err) {
    console.error(err);
  }
}

async function main() {
  const server = hapi.server({ port: kDataPort });

  await server.register(h2o2);

  server.route({
    method: '*',
    path: '/{path*}',
    config: {
      payload: {
        output: 'stream',
        parse: false,
      },
      async handler(request, h) {
        const host = request.headers.host;
        const config = await lookupHostConfig(host);

        if (config === null) {
          return h.response().code(404);
        }

        let deployment = activeDeployments.get(host);

        if (deployment === undefined) {
          const startTime = process.hrtime.bigint();
          const pod = await createFunctionPod(config);
          const endTime = process.hrtime.bigint();
          // console.log(pod);
          console.log(`pod ready in ${endTime - startTime} nanoseconds`);
          config.pod = pod;
          activeDeployments.set(host, config);
          deployment = config;
        }

        deployment.generation = 0;
        return h.proxy({
          host: deployment.pod.status.podIP,
          port: kDataPort,
          protocol: 'http',
        });
      },
    },
  });

  await pgClient.connect();
  await server.start();
}

main();
