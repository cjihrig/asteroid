# asteroid

Asteroid is a Kubernetes-based platform for deploying applications. The following features are supported:

- Deploying Node.js servers from tarballs.
- Applications scale to zero when they become inactive.

## Deploying to minikube

Ensure that minikube is running:

```
minikube start --cni calico
```

Deploy asteroid to minikube:

```
./minikube.sh
```

To tear the deployment down:

```
kubectl delete -f deployment
```
