#!/usr/bin/env pwsh
# scripts/setup-sre-agent.ps1
# Run this AFTER creating the Azure SRE Agent at sre.azure.com
# Pass the managed identity principal ID from the newly created agent.
#
# Usage:
#   .\setup-sre-agent.ps1 -SreAgentPrincipalId "<managed-identity-object-id>"

param(
    [Parameter(Mandatory = $true)]
    [string]$SreAgentPrincipalId,

    [string]$ResourceGroup  = "rg-sreagent-ode-demo",
    [string]$Subscription   = "d095c6c9-21e9-4fec-bfb0-429d1409e8e0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "`n=== Azure SRE Agent Post-Creation Setup ===" -ForegroundColor Cyan
Write-Host "Resource group : $ResourceGroup"
Write-Host "Principal ID   : $SreAgentPrincipalId"

# 1. Assign Reader role on the demo resource group
Write-Host "`n[1/4] Assigning Reader role on $ResourceGroup..." -ForegroundColor Yellow
az role assignment create `
    --role "Reader" `
    --assignee-object-id $SreAgentPrincipalId `
    --assignee-principal-type ServicePrincipal `
    --scope "/subscriptions/$Subscription/resourceGroups/$ResourceGroup" `
    --output none 2>&1
Write-Host "      Reader role assigned." -ForegroundColor Green

# 2. Assign Monitoring Reader for deeper metric access
Write-Host "`n[2/4] Assigning Monitoring Reader role..." -ForegroundColor Yellow
az role assignment create `
    --role "Monitoring Reader" `
    --assignee-object-id $SreAgentPrincipalId `
    --assignee-principal-type ServicePrincipal `
    --scope "/subscriptions/$Subscription/resourceGroups/$ResourceGroup" `
    --output none 2>&1
Write-Host "      Monitoring Reader role assigned." -ForegroundColor Green

# 3. Get AKS cluster resource ID (for display / manual connection)
Write-Host "`n[3/4] Fetching AKS resource ID for SRE Agent connection..." -ForegroundColor Yellow
$aksId = az aks show `
    --name "aks-contoso-sreagent-demo" `
    --resource-group $ResourceGroup `
    --query "id" -o tsv 2>&1
Write-Host "      AKS ID: $aksId" -ForegroundColor Green

# 4. Print summary with what to connect in the portal
Write-Host "`n[4/4] Setup complete. Connect these in the SRE Agent portal (sre.azure.com):" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Resource Group to monitor:  $ResourceGroup" -ForegroundColor White
Write-Host "  Log Analytics workspace:    law-euqicty6gdfys" -ForegroundColor White
Write-Host "  App Insights:               appi-euqicty6gdfys" -ForegroundColor White
Write-Host "  AKS cluster:                aks-contoso-sreagent-demo" -ForegroundColor White
Write-Host "  GitHub repo:                https://github.com/pronmalw/azure-sre-agent-ode-demo-kit" -ForegroundColor White
Write-Host ""
Write-Host "  Knowledge file to upload:   docs\sre-agent-knowledge.md" -ForegroundColor Cyan
Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
