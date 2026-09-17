param workloadName string
param location string
param tags object
param resourceToken string
param aksClusterName string
param nodeCount int
param vmSize string
param enableContainerInsights bool
param logAnalyticsWorkspaceId string
@description('Optional subnet resource ID for bring-your-own VNet. Leave empty to keep the AKS-managed VNet. Cannot be changed on an existing cluster.')
param vnetSubnetId string = ''

resource aks 'Microsoft.ContainerService/managedClusters@2024-05-01' = {
  name: aksClusterName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dnsPrefix: '${workloadName}-${resourceToken}'
    kubernetesVersion: ''
    oidcIssuerProfile: {
      enabled: true
    }
    securityProfile: {
      workloadIdentity: {
        enabled: true
      }
    }
    addonProfiles: enableContainerInsights ? {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: logAnalyticsWorkspaceId
        }
      }
    } : {}
    agentPoolProfiles: [
      union({
        name: 'systemnp'
        count: nodeCount
        vmSize: vmSize
        mode: 'System'
        osType: 'Linux'
        osSKU: 'Ubuntu'
        type: 'VirtualMachineScaleSets'
      }, empty(vnetSubnetId) ? {} : {
        vnetSubnetID: vnetSubnetId
      })
    ]
    networkProfile: {
      networkPlugin: 'azure'
      loadBalancerSku: 'standard'
    }
    identityProfile: {}
  }
}

output clusterName string = aks.name
output clusterFqdn string = aks.properties.fqdn
output nodeResourceGroup string = aks.properties.nodeResourceGroup
output principalId string = aks.identity.principalId
