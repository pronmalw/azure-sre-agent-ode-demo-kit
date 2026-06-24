param(
  [string]$ResourceGroupName = "rg-sreagent-ode-demo",
  [string]$Location = "westeurope",
  [string]$EnvironmentName = "dev",
  [string]$CustomerName = "Contoso Retail",
  [string]$WorkloadName = "sre-agent-ode-demo",
  [string]$HostingMode = "aks",
  [string]$SubscriptionId = "d095c6c9-21e9-4fec-bfb0-429d1409e8e0",
  [string]$AksClusterName = "aks-contoso-sreagent-demo",
  [int]$AksNodeCount = 2,
  [string]$AksVmSize = "Standard_D2s_v3",
  [switch]$SkipInfra,
  [switch]$SkipBuild,
  [switch]$SkipSeed,
  [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot\.."

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

Require-Command az
Require-Command kubectl
Require-Command docker

az account show | Out-Null
az account set --subscription $SubscriptionId

az group create --name $ResourceGroupName --location $Location | Out-Null

if (-not $SkipInfra) {
  $password = Read-Host "Enter SQL admin password for deployment" -AsSecureString
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
  az deployment group create --resource-group $ResourceGroupName --template-file infra\main.bicep --parameters @infra\parameters\dev.json sqlAdministratorPassword=$plainPassword
}

$cosmosAccountName = az resource list -g $ResourceGroupName --resource-type Microsoft.DocumentDB/databaseAccounts --query "[0].name" -o tsv
$cosmosEndpoint = az cosmosdb show -g $ResourceGroupName -n $cosmosAccountName --query documentEndpoint -o tsv
$cosmosKey = az cosmosdb keys list -g $ResourceGroupName -n $cosmosAccountName --query primaryMasterKey -o tsv
$sqlServerFqdn = az sql server list -g $ResourceGroupName --query "[0].fullyQualifiedDomainName" -o tsv
$acrName = az acr list -g $ResourceGroupName --query "[0].name" -o tsv
$acrLoginServer = az acr list -g $ResourceGroupName --query "[0].loginServer" -o tsv

if (-not $SkipBuild) {
  az acr login --name $acrName
  docker build -t "$acrLoginServer/contoso-retail-api:latest" srcpi
  docker push "$acrLoginServer/contoso-retail-api:latest"
  docker build -t "$acrLoginServer/contoso-retail-web:latest" src\web
  docker push "$acrLoginServer/contoso-retail-web:latest"
}

if (-not $SkipDeploy) {
  az aks get-credentials --resource-group $ResourceGroupName --name $AksClusterName --overwrite-existing
  kubectl apply -f k8s
amespace.yaml
  kubectl apply -f k8s\configmap.yaml
  kubectl delete secret contoso-retail-secrets -n contoso-retail --ignore-not-found
  kubectl create secret generic contoso-retail-secrets -n contoso-retail `
    --from-literal=COSMOS_ENDPOINT=$cosmosEndpoint `
    --from-literal=COSMOS_KEY=$cosmosKey `
    --from-literal=SQL_SERVER=$sqlServerFqdn `
    --from-literal=SQL_DATABASE=contoso-retail-db `
    --from-literal=SQL_USER=sqladmin `
    --from-literal=SQL_PASSWORD=$plainPassword `
    --from-literal=APPINSIGHTS_CONNECTION_STRING=''
  (Get-Content k8s\deployment.yaml -Raw).Replace('<ACR_NAME>', $acrName) | kubectl apply -f -
  kubectl apply -f k8s\service.yaml
  kubectl apply -f k8s\ingress.yaml
  kubectl apply -f k8s\hpa.yaml
  kubectl rollout status deployment/contoso-retail-api -n contoso-retail
  kubectl rollout status deployment/contoso-retail-web -n contoso-retail
}

if (-not $SkipSeed) {
  Push-Location srcpi
  $env:COSMOS_ENDPOINT = $cosmosEndpoint
  $env:COSMOS_KEY = $cosmosKey
  $env:COSMOS_DATABASE_ID = 'contoso-retail'
  $env:SQL_SERVER = $sqlServerFqdn
  $env:SQL_DATABASE = 'contoso-retail-db'
  $env:SQL_USER = 'sqladmin'
  $env:SQL_PASSWORD = $plainPassword
  npm install
  npx ts-node src/data/seed.ts all
  Pop-Location
}

kubectl exec deployment/contoso-retail-api -n contoso-retail -- sh -c "wget -qO- http://localhost:3001/health"
Write-Host "App URL: use kubectl get svc -n contoso-retail contoso-retail-web-public"
Write-Host "Ops URL: <app-url>/ops"
Write-Host "SRE Agent URL: <app-url>/sre-agent"
