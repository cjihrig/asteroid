#!/bin/sh

eval $(minikube -p minikube docker-env)

docker build ./api -t asteroid-api
docker build ./gateway -t asteroid-gateway
docker build ./runner -t asteroid-runner

kubectl apply -f ./deployment/00_init.yaml
kubectl apply -f ./deployment/01_storage.yaml
kubectl rollout status deployment asteroid-postgres
kubectl apply -f ./deployment/02_services.yaml
# kubectl rollout status deployment api-deployment
kubectl rollout status deployment gateway-deployment
