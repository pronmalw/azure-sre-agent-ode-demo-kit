param(
  [string]$ResourceGroupName = "rg-sreagent-ode-demo",
  [string]$SubscriptionId = "d095c6c9-21e9-4fec-bfb0-429d1409e8e0",
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
az account set --subscription $SubscriptionId
Write-Host "Subscription: $SubscriptionId"
Write-Host "Resource group: $ResourceGroupName"
if (-not $Force) {
  $confirmation = Read-Host "Type DELETE to confirm resource group cleanup"
  if ($confirmation -ne 'DELETE') {
    Write-Host 'Cleanup cancelled.'
    exit 0
  }
}
az group delete --name $ResourceGroupName --yes --no-wait
Write-Host 'Delete initiated.'
