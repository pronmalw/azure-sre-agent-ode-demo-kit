#!/usr/bin/env bash
set -euo pipefail
RESOURCE_GROUP_NAME=${RESOURCE_GROUP_NAME:-rg-sreagent-ode-demo}
SUBSCRIPTION_ID=${SUBSCRIPTION_ID:-d095c6c9-21e9-4fec-bfb0-429d1409e8e0}
az account set --subscription "$SUBSCRIPTION_ID"
echo "Subscription: $SUBSCRIPTION_ID"
echo "Resource group: $RESOURCE_GROUP_NAME"
read -rp "Type DELETE to confirm resource group cleanup: " CONFIRM
if [[ "$CONFIRM" != "DELETE" ]]; then
  echo "Cleanup cancelled."
  exit 0
fi
az group delete --name "$RESOURCE_GROUP_NAME" --yes --no-wait
