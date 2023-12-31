#!/bin/sh

eval $(minikube -p minikube docker-env)

docker build ./api -t asteroid-api
docker build ./gateway -t asteroid-gateway
docker build ./migrations -t asteroid-migrations
docker build ./reaper -t asteroid-reaper
docker build ./runner -t asteroid-runner

kubectl apply -f ./deployment/000_init.yaml
kubectl apply -f ./deployment/010_storage.yaml
kubectl rollout status deployment asteroid-postgres
kubectl apply -f ./deployment/011_migrations.yaml
kubectl apply -f ./deployment/020_services.yaml
# kubectl rollout status deployment api-deployment
kubectl rollout status deployment gateway-deployment
