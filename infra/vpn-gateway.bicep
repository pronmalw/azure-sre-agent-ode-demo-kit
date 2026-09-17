// infra/vpn-gateway.bicep
// Standalone deployment (separate from main.bicep) because VPN Gateway provisioning
// takes 30-45 minutes. Deploying it independently lets the app/AKS/DB stack go live
// quickly while this keeps provisioning in the background.
//
// Creates a REAL VNet-to-VNet S2S VPN tunnel between the app's VNet (created by
// modules/vnet.bicep in main.bicep) and a second "on-premises simulator" VNet.
// Because we control both ends, the demo can break/restore the tunnel for real by
// rotating the shared key via Azure Resource Manager (see chaos toggle wiring in
// src/api/src/services/azure-vpn-chaos.service.ts) — this produces real Azure Monitor
// VPN Gateway metrics (tunnel status, packet drops, bandwidth) instead of simulated ones.
targetScope = 'resourceGroup'

@description('Azure region — must match the primary VNet region.')
param location string = resourceGroup().location

param tags object = {}
param resourceToken string

@description('Resource ID of the existing GatewaySubnet in the primary app VNet (from modules/vnet.bicep).')
param primaryGatewaySubnetId string

@description('Address space for the simulated on-premises VNet.')
param onPremVnetAddressPrefix string = '10.20.0.0/16'
param onPremGatewaySubnetPrefix string = '10.20.255.0/27'

@secure()
@description('IPsec pre-shared key used when the tunnel is healthy. The chaos toggle rotates this to a mismatched value to break the tunnel, and restores it to reconnect.')
param healthySharedKey string

var vpnGatewaySku = 'VpnGw1'

// --- Simulated on-premises side ---
resource onPremVnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: 'vnet-onprem-sim-${resourceToken}'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        onPremVnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: 'GatewaySubnet'
        properties: {
          addressPrefix: onPremGatewaySubnetPrefix
        }
      }
    ]
  }
}

resource pipOnPrem 'Microsoft.Network/publicIPAddresses@2023-09-01' = {
  name: 'pip-vpngw-onprem-${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource vpnGatewayOnPrem 'Microsoft.Network/virtualNetworkGateways@2023-09-01' = {
  name: 'vpngw-onprem-${resourceToken}'
  location: location
  tags: tags
  properties: {
    gatewayType: 'Vpn'
    vpnType: 'RouteBased'
    sku: {
      name: vpnGatewaySku
      tier: vpnGatewaySku
    }
    ipConfigurations: [
      {
        name: 'vnetGatewayConfig'
        properties: {
          publicIPAddress: {
            id: pipOnPrem.id
          }
          subnet: {
            id: onPremVnet.properties.subnets[0].id
          }
        }
      }
    ]
  }
}

// --- Primary app side ---
resource pipMain 'Microsoft.Network/publicIPAddresses@2023-09-01' = {
  name: 'pip-vpngw-main-${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource vpnGatewayMain 'Microsoft.Network/virtualNetworkGateways@2023-09-01' = {
  name: 'vpngw-main-${resourceToken}'
  location: location
  tags: tags
  properties: {
    gatewayType: 'Vpn'
    vpnType: 'RouteBased'
    sku: {
      name: vpnGatewaySku
      tier: vpnGatewaySku
    }
    ipConfigurations: [
      {
        name: 'vnetGatewayConfig'
        properties: {
          publicIPAddress: {
            id: pipMain.id
          }
          subnet: {
            id: primaryGatewaySubnetId
          }
        }
      }
    ]
  }
}

// --- Local network gateways (each side's view of the other) ---
resource lngOnPremAsSeenByMain 'Microsoft.Network/localNetworkGateways@2023-09-01' = {
  name: 'lng-onprem-${resourceToken}'
  location: location
  tags: tags
  properties: {
    gatewayIpAddress: pipOnPrem.properties.ipAddress
    localNetworkAddressSpace: {
      addressPrefixes: [
        onPremVnetAddressPrefix
      ]
    }
  }
}

resource lngMainAsSeenByOnPrem 'Microsoft.Network/localNetworkGateways@2023-09-01' = {
  name: 'lng-main-${resourceToken}'
  location: location
  tags: tags
  properties: {
    gatewayIpAddress: pipMain.properties.ipAddress
    localNetworkAddressSpace: {
      addressPrefixes: [
        '10.10.0.0/16'
      ]
    }
  }
}

// --- The two halves of the tunnel ---
resource connectionMainToOnPrem 'Microsoft.Network/connections@2023-09-01' = {
  name: 'conn-main-to-onprem-${resourceToken}'
  location: location
  tags: tags
  properties: {
    virtualNetworkGateway1: {
      id: vpnGatewayMain.id
    }
    localNetworkGateway2: {
      id: lngOnPremAsSeenByMain.id
    }
    connectionType: 'IPsec'
    connectionProtocol: 'IKEv2'
    sharedKey: healthySharedKey
    connectionMode: 'Default'
  }
}

resource connectionOnPremToMain 'Microsoft.Network/connections@2023-09-01' = {
  name: 'conn-onprem-to-main-${resourceToken}'
  location: location
  tags: tags
  properties: {
    virtualNetworkGateway1: {
      id: vpnGatewayOnPrem.id
    }
    localNetworkGateway2: {
      id: lngMainAsSeenByOnPrem.id
    }
    connectionType: 'IPsec'
    connectionProtocol: 'IKEv2'
    sharedKey: healthySharedKey
    connectionMode: 'Default'
  }
}

output vpnGatewayMainName string = vpnGatewayMain.name
output vpnGatewayOnPremName string = vpnGatewayOnPrem.name
output connectionMainToOnPremName string = connectionMainToOnPrem.name
output connectionOnPremToMainName string = connectionOnPremToMain.name
output resourceGroupName string = resourceGroup().name
