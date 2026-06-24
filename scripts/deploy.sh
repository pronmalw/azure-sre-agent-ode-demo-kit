#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP_NAME=${RESOURCE_GROUP_NAME:-rg-sreagent-ode-demo}
LOCATION=${LOCATION:-westeurope}
ENVIRONMENT_NAME=${ENVIRONMENT_NAME:-dev}
CUSTOMER_NAME=${CUSTOMER_NAME:-Contoso Retail}
WORKLOAD_NAME=${WORKLOAD_NAME:-sre-agent-ode-demo}
HOSTING_MODE=${HOSTING_MODE:-aks}
SUBSCRIPTION_ID=${SUBSCRIPTION_ID:-d095c6c9-21e9-4fec-bfb0-429d1409e8e0}
AKS_CLUSTER_NAME=${AKS_CLUSTER_NAME:-aks-contoso-sreagent-demo}
AKS_NODE_COUNT=${AKS_NODE_COUNT:-2}
AKS_VM_SIZE=${AKS_VM_SIZE:-Standard_D2s_v3}

cd "$(dirname "$0")/.."
az account show >/dev/null
az account set --subscription "$SUBSCRIPTION_ID"
az group create --name "$RESOURCE_GROUP_NAME" --location "$LOCATION" >/dev/null
read -rsp "Enter SQL admin password for deployment: " SQL_PASSWORD
printf '
'
az deployment group create --resource-group "$RESOURCE_GROUP_NAME" --template-file infra/main.bicep --parameters @infra/parameters/dev.json sqlAdministratorPassword="$SQL_PASSWORD"
COSMOS_ACCOUNT_NAME=$(az resource list -g "$RESOURCE_GROUP_NAME" --resource-type Microsoft.DocumentDB/databaseAccounts --query "[0].name" -o tsv)
COSMOS_ENDPOINT=$(az cosmosdb show -g "$RESOURCE_GROUP_NAME" -n "$COSMOS_ACCOUNT_NAME" --query documentEndpoint -o tsv)
COSMOS_KEY=$(az cosmosdb keys list -g "$RESOURCE_GROUP_NAME" -n "$COSMOS_ACCOUNT_NAME" --query primaryMasterKey -o tsv)
SQL_SERVER_FQDN=$(az sql server list -g "$RESOURCE_GROUP_NAME" --query "[0].fullyQualifiedDomainName" -o tsv)
ACR_NAME=$(az acr list -g "$RESOURCE_GROUP_NAME" --query "[0].name" -o tsv)
ACR_LOGIN_SERVER=$(az acr list -g "$RESOURCE_GROUP_NAME" --query "[0].loginServer" -o tsv)
az acr login --name "$ACR_NAME"
docker build -t "$ACR_LOGIN_SERVER/contoso-retail-api:latest" src/api
docker push "$ACR_LOGIN_SERVER/contoso-retail-api:latest"
docker build -t "$ACR_LOGIN_SERVER/contoso-retail-web:latest" src/web
docker push "$ACR_LOGIN_SERVER/contoso-retail-web:latest"
az aks get-credentials --resource-group "$RESOURCE_GROUP_NAME" --name "$AKS_CLUSTER_NAME" --overwrite-existing
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl delete secret contoso-retail-secrets -n contoso-retail --ignore-not-found
kubectl create secret generic contoso-retail-secrets -n contoso-retail   --from-literal=COSMOS_ENDPOINT="$COSMOS_ENDPOINT"   --from-literal=COSMOS_KEY="$COSMOS_KEY"   --from-literal=SQL_SERVER="$SQL_SERVER_FQDN"   --from-literal=SQL_DATABASE=contoso-retail-db   --from-literal=SQL_USER=sqladmin   --from-literal=SQL_PASSWORD="$SQL_PASSWORD"   --from-literal=APPINSIGHTS_CONNECTION_STRING=''
sed "s/<ACR_NAME>/${ACR_NAME}/g" k8s/deployment.yaml | kubectl apply -f -
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml
kubectl rollout status deployment/contoso-retail-api -n contoso-retail
kubectl rollout status deployment/contoso-retail-web -n contoso-retail
(
  cd src/api
  export COSMOS_ENDPOINT COSMOS_KEY COSMOS_DATABASE_ID=contoso-retail SQL_SERVER="$SQL_SERVER_FQDN" SQL_DATABASE=contoso-retail-db SQL_USER=sqladmin SQL_PASSWORD
  npm install
  npx ts-node src/data/seed.ts all
)
kubectl exec deployment/contoso-retail-api -n contoso-retail -- sh -c "wget -qO- http://localhost:3001/health"
echo "App URL: kubectl get svc -n contoso-retail contoso-retail-web-public"
