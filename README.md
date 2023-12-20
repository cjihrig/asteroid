# asteroid

Deployer of Node.js

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
