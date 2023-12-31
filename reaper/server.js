'use strict';
const k8s = require('@kubernetes/client-node');
const kubeconfig = new k8s.KubeConfig();
const kAsteroidNamespace = 'default';
const kAppNamespace = 'apps';

kubeconfig.loadFromDefault();

const client = kubeconfig.makeApiClient(k8s.CoreV1Api);
const activeDeployments = new Map();


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

      console.dir(await Promise.allSettled(promises), { depth: 5 });

      for (let i = 0; i < inactiveDeployments.length; ++i) {
        const deployment = inactiveDeployments[i];

        activeDeployments.delete(deployment.deployment);

        try {
          // TODO(cjihrig): Let the rest of the system know this is going away first.
          // TODO(cjihrig): Until this is implemented, the system is broken.
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

reaper();
