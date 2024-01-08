'use strict';
const k8s = require('@kubernetes/client-node');
const pg = require('pg');
const kubeconfig = new k8s.KubeConfig();
const kAsteroidNamespace = 'default';
const kAppNamespace = 'apps';

const pgClient = new pg.Client({
  host: 'asteroid-postgres-service.default.svc.cluster.local',
  port: 5432,
  database: 'asteroid',
  user: 'admin',
  password: 'admin',
});

kubeconfig.loadFromDefault();

const client = kubeconfig.makeApiClient(k8s.CoreV1Api);
const activeDeployments = new Map();

// TODO(cjihrig): Add another task that periodically deletes active deployments
// whose k8s resource is null, but the created_at field is past a certain
// threshold. This will delete deployments that have failed to launch.

async function reaper() {
  try {
    const endpoints = await client.readNamespacedEndpoints('gateway-service', kAsteroidNamespace);
    const { subsets } = endpoints.body;
    let promises = [];

    for (let i = 0; i < subsets?.length; ++i) {
      const subset = subsets[i];

      for (let j = 0; j < subset.addresses.length; ++j) {
        promises.push(fetch(`http://${subset.addresses[j].ip}:8000/deployments`));
      }
    }

    const results = await Promise.allSettled(promises);
    for (let i = 0; i < results.length; ++i) {
      const result = results[i];

      if (result.status === 'rejected') {
        console.log(result.reason);
        continue;
      }

      if (result.value.status !== 200) {
        console.log(`Received status code ${result.value.status}`);
        continue;
      }

      const { deployments } = await result.value.json();
      for (let i = 0; i < deployments.length; ++i) {
        const deployment = deployments[i];

        deployment.generation = 0;
        activeDeployments.set(deployment.deployment, deployment);
      }
    }

    const inactiveDeployments = [];

    for (const deployment of activeDeployments.values()) {
      if (deployment.generation > 0) {
        inactiveDeployments.push(deployment);
      } else {
        deployment.generation++;
      }
    }

    promises = [];

    if (inactiveDeployments.length > 0) {
      try {
        // TODO(cjihrig): This may need to be batched if the number of
        // deployments gets too large.
        const ids = inactiveDeployments.map((deployment) => {
          return `'${deployment.deployment}'`;
        }).join(', ');
        const sql = `DELETE FROM active_deployments WHERE id IN (${ids})`;
        const result = await pgClient.query(sql);

        if (result.rowCount !== inactiveDeployments.length) {
          console.warn(`attempted to delete ${inactiveDeployments.length} inactive deployments but only deleted ${result.rowCount}`);
        }
      } catch (err) {
        console.error('error deleting active deployments from database');
        console.error(err);
      }

      for (let i = 0; i < subsets?.length; ++i) {
        const subset = subsets[i];

        for (let j = 0; j < subset.addresses.length; ++j) {
          promises.push(fetch(`http://${subset.addresses[j].ip}:8000/deployments`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ deployments: inactiveDeployments }),
          }));
        }
      }

      for (let i = 0; i < inactiveDeployments.length; ++i) {
        const deployment = inactiveDeployments[i];

        activeDeployments.delete(deployment.deployment);

        try {
          await client.deleteNamespacedPod(deployment.deployment, kAppNamespace);
        } catch (err) {
          console.log(`could not delete deployment '${deployment.deployment}': ${err}`);
        }
      }
    }
  } catch (err) {
    console.log(err);
  }

  setTimeout(reaper, 10 * 1000);
}

async function main() {
  await pgClient.connect();
  reaper();
}

main();
