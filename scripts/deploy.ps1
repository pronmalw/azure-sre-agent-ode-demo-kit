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
  [switch]$SkipDeploy,
  [switch]$UseLocalDocker
)

$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot\.."

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

Require-Command az
if (-not $SkipDeploy) { Require-Command kubectl }
if (-not $SkipBuild -and $UseLocalDocker) { Require-Command docker }

az account show | Out-Null
az account set --subscription $SubscriptionId

az group create --name $ResourceGroupName --location $Location | Out-Null

# The password is needed by the k8s secret and the seeder too, not just by the
# infra deployment, so it must be collected even when -SkipInfra is used.
$password = Read-Host "Enter SQL admin password" -AsSecureString
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
if ([string]::IsNullOrWhiteSpace($plainPassword)) { throw "SQL admin password must not be empty" }

if (-not $SkipInfra) {
  az deployment group create --resource-group $ResourceGroupName --template-file infra\main.bicep --parameters "@infra\parameters\dev.json" "sqlAdministratorPassword=$plainPassword"
}

$cosmosAccountName = az resource list -g $ResourceGroupName --resource-type Microsoft.DocumentDB/databaseAccounts --query "[0].name" -o tsv
$cosmosEndpoint = az cosmosdb show -g $ResourceGroupName -n $cosmosAccountName --query documentEndpoint -o tsv
$cosmosKey = az cosmosdb keys list -g $ResourceGroupName -n $cosmosAccountName --query primaryMasterKey -o tsv
$sqlServerName = az sql server list -g $ResourceGroupName --query "[0].name" -o tsv
$sqlServerFqdn = az sql server list -g $ResourceGroupName --query "[0].fullyQualifiedDomainName" -o tsv
$acrName = az acr list -g $ResourceGroupName --query "[0].name" -o tsv
$acrLoginServer = az acr list -g $ResourceGroupName --query "[0].loginServer" -o tsv
$appInsightsName = az resource list -g $ResourceGroupName --resource-type Microsoft.Insights/components --query "[0].name" -o tsv
$appInsightsConnectionString = az monitor app-insights component show -g $ResourceGroupName -a $appInsightsName --query connectionString -o tsv

# Real-chaos wiring. Without these the app silently falls back to simulated
# behaviour even though the Azure resources exist.
$throttleAccountName = (az cosmosdb list -g $ResourceGroupName -o tsv --query "[].name") -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -like 'cosmos-throttle*' } | Select-Object -First 1
$throttleEndpoint = ''
$throttleKey = ''
if ($throttleAccountName) {
  $throttleEndpoint = az cosmosdb show -g $ResourceGroupName -n $throttleAccountName --query documentEndpoint -o tsv
  $throttleKey = az cosmosdb keys list -g $ResourceGroupName -n $throttleAccountName --query primaryMasterKey -o tsv
}
else {
  Write-Warning "No cosmos-throttle account found - real 429 generation will be unavailable."
}

$vpnConnectionName = (az network vpn-connection list -g $ResourceGroupName -o tsv --query "[].name") -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -like '*main-to-onprem*' } | Select-Object -First 1
$vpnGatewayName = (az network vnet-gateway list -g $ResourceGroupName -o tsv --query "[].name") -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -like 'vpngw-main*' } | Select-Object -First 1
$vpnSharedKey = ''
if ($vpnConnectionName) {
  $vpnSharedKey = (az network vpn-connection shared-key show -g $ResourceGroupName --connection-name $vpnConnectionName -o tsv).Trim()
}
else {
  Write-Warning "No VPN connection found - real VPN tunnel chaos will be unavailable."
}

foreach ($pair in @(
  @{ Name = 'Cosmos endpoint'; Value = $cosmosEndpoint },
  @{ Name = 'SQL server FQDN'; Value = $sqlServerFqdn },
  @{ Name = 'ACR login server'; Value = $acrLoginServer },
  @{ Name = 'App Insights connection string'; Value = $appInsightsConnectionString }
)) {
  if ([string]::IsNullOrWhiteSpace($pair.Value)) { throw "Could not resolve $($pair.Name) in $ResourceGroupName. Did the infra deployment succeed?" }
}

if (-not $SkipBuild) {
  if ($UseLocalDocker) {
    az acr login --name $acrName
    docker build -t "$acrLoginServer/contoso-retail-api:latest" src\api
    docker push "$acrLoginServer/contoso-retail-api:latest"
    docker build -t "$acrLoginServer/contoso-retail-web:latest" src\web
    docker push "$acrLoginServer/contoso-retail-web:latest"
  }
  else {
    # ACR Tasks builds server-side, so no local Docker daemon is required.
    az acr build --registry $acrName --image contoso-retail-api:latest src\api
    az acr build --registry $acrName --image contoso-retail-web:latest src\web
  }
}

if (-not $SkipDeploy) {
  az aks get-credentials --resource-group $ResourceGroupName --name $AksClusterName --overwrite-existing
  kubectl apply -f k8s\namespace.yaml
  kubectl apply -f k8s\serviceaccount.yaml
  kubectl apply -f k8s\configmap.yaml
  kubectl delete secret contoso-retail-secrets -n contoso-retail --ignore-not-found
  kubectl create secret generic contoso-retail-secrets -n contoso-retail `
    --from-literal=COSMOS_ENDPOINT=$cosmosEndpoint `
    --from-literal=COSMOS_KEY=$cosmosKey `
    --from-literal=SQL_SERVER=$sqlServerFqdn `
    --from-literal=SQL_DATABASE=contoso-retail-db `
    --from-literal=SQL_USER=sqladmin `
    --from-literal=SQL_PASSWORD=$plainPassword `
    --from-literal=APPINSIGHTS_CONNECTION_STRING=$appInsightsConnectionString `
    --from-literal=THROTTLE_COSMOS_ENDPOINT=$throttleEndpoint `
    --from-literal=THROTTLE_COSMOS_KEY=$throttleKey `
    --from-literal=THROTTLE_COSMOS_DATABASE_ID=throttle-demo `
    --from-literal=THROTTLE_COSMOS_CONTAINER_ID=HotPartition `
    --from-literal=AZURE_SUBSCRIPTION_ID=$SubscriptionId `
    --from-literal=AZURE_RESOURCE_GROUP=$ResourceGroupName `
    --from-literal=VPN_CONNECTION_NAME=$vpnConnectionName `
    --from-literal=VPN_GATEWAY_NAME=$vpnGatewayName `
    --from-literal=VPN_HEALTHY_SHARED_KEY=$vpnSharedKey
  (Get-Content k8s\deployment.yaml -Raw).Replace('<ACR_NAME>', $acrName) | kubectl apply -f -
  kubectl apply -f k8s\service.yaml
  kubectl apply -f k8s\ingress.yaml
  kubectl apply -f k8s\hpa.yaml
  kubectl rollout status deployment/contoso-retail-api -n contoso-retail
  kubectl rollout status deployment/contoso-retail-web -n contoso-retail
}

if (-not $SkipSeed) {
  # The seeder runs from this machine, so the SQL firewall has to let it in.
  $clientIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json').ip
  az sql server firewall-rule create -g $ResourceGroupName -s $sqlServerName -n deploy-client --start-ip-address $clientIp --end-ip-address $clientIp | Out-Null

  Push-Location src\api
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
