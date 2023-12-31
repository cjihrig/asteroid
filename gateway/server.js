'use strict';
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const hapi = require('@hapi/hapi');
const h2o2 = require('@hapi/h2o2');
const k8s = require('@kubernetes/client-node');
const pg = require('pg');
const kubeconfig = new k8s.KubeConfig();
const kAppNamespace = 'apps';
const kControlPort = 7000;
const kDataPort = 8000;

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

kubeconfig.loadFromDefault();

const client = kubeconfig.makeApiClient(k8s.CoreV1Api);
const informer = k8s.makeInformer(kubeconfig, `/api/v1/namespaces/${kAppNamespace}/pods`, () => {
  return client.listNamespacedPod(kAppNamespace);
});

function createDeferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

// TODO(cjihrig): Move this tracking to database.
const activeDeployments = new Map();
const accessedDeployments = new Map();
const pendingDeployments = new Map();

function untrackDeployment(deploymentId, host) {
  accessedDeployments.delete(deploymentId);
  activeDeployments.delete(host);
}


function podInformerHandler(pod) {
  const deployment = pod?.metadata?.annotations?.['asteroid.deployment'];
  if (typeof deployment !== 'string') {
    return;
  }

  const deferred = pendingDeployments.get(deployment);
  if (deferred === undefined) {
    return;
  }

  const status = pod.status;

  if (status?.phase === 'Running' && status.containerStatuses?.[0]?.ready) {
    deferred.resolve(pod);
  }
}

informer.on('add', podInformerHandler);
informer.on('update', podInformerHandler);

informer.on('delete', (pod) => {
  const annotations = pod?.metadata?.annotations;
  const deployment = annotations?.['asteroid.deployment'];

  if (typeof deployment === 'string') {
    untrackDeployment(deployment, 'asteroid.host');
  }
});

informer.on('error', (err) => {
  console.log('informer error');
  console.log(err);
  setImmediate(() => {
    informer.start();
  });
});

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
    handler,
    host,
    pod: null,
    url,
  };
}

async function createFunctionPod(config) {
  // TODO(cjihrig): Incorporate a timeout in this functionality.
  try {
    const podDefinition = {
      metadata: {
        // TODO(cjihrig): Need some random string in the name.
        name: config.deployment,
        namespace: kAppNamespace,
        annotations: {
          'asteroid.deployment': config.deployment,
          'asteroid.host': config.host,
        },
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

    const deferred = createDeferredPromise();
    pendingDeployments.set(config.deployment, deferred);
    await client.createNamespacedPod(kAppNamespace, podDefinition);
    const pod = await deferred.promise;
    return pod;
  } catch (err) {
    console.log('error creating function pod');
    console.error(err);
  } finally {
    pendingDeployments.delete(config.deployment);
  }
}

async function main() {
  const server = hapi.server({ port: kDataPort });

  await server.register(h2o2);

  // TODO(cjihrig): This route needs to be on a non-exposed port.
  server.route({
    method: 'GET',
    // TODO(cjihrig): This is not a great path name for this functionality.
    path: '/deployments',
    config: {
      async handler(request, h) {
        const deployments = Array.from(accessedDeployments.values());
        accessedDeployments.clear();
        return { deployments };
      },
    },
  });

  // TODO(cjihrig): This route needs to be on a non-exposed port.
  server.route({
    method: 'DELETE',
    path: '/deployments',
    config: {
      async handler(request, h) {
        for (let i = 0; i < request.payload.deployments.length; ++i) {
          const deployment = request.payload.deployments[i];

          untrackDeployment(deployment.deployment, deployment.host);
        }

        return 'ok';
      }
    },
  });

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
        let deployment = activeDeployments.get(host);

        if (deployment === undefined) {
          // TODO(cjihrig): The database needs to let us know if there is
          // already a deployment or not. If there was not already one, then
          // this request launches the deployment. If a deployment already
          // exists we need to determine if it is pending or not.
          deployment = await lookupHostConfig(host);

          if (deployment === null) {
            return h.response().code(404);
          }

          const startTime = process.hrtime.bigint();
          const pod = await createFunctionPod(deployment);
          const endTime = process.hrtime.bigint();
          console.log(`pod ready in ${endTime - startTime} nanoseconds`);
          deployment.pod = pod;
          activeDeployments.set(host, deployment);
        }

        let accessedDeployment = accessedDeployments.get(deployment.deployment);
        if (accessedDeployment === undefined) {
          accessedDeployment = {
            deployment: deployment.deployment,
            host,
          };
          accessedDeployments.set(deployment.deployment, accessedDeployment);
        }

        // TODO(cjihrig): If the pod cannot be reached, untrack the deployment and create a new one.
        return h.proxy({
          host: deployment.pod.status.podIP,
          port: kDataPort,
          protocol: 'http',
        });
      },
    },
  });

  await pgClient.connect();
  informer.start();
  await server.start();
}

main();
