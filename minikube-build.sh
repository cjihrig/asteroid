eval $(minikube -p minikube docker-env)
cd api
docker build . -t asteroid-api
cd ..
cd gateway
docker build . -t asteroid-gateway
cd ..
cd runner
docker build . -t asteroid-runner
cd ..
