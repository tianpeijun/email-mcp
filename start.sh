#!/bin/bash

# Email MCP Server - Startup Script
# This script starts the SuperGateway service on EC2

set -e  # Exit on error

# Change to application directory
cd /opt/email-mcp

# Start SuperGateway with pre-built code
# Don't rebuild - use the compiled dist/ from deployment package
npx supergateway --stdio "node dist/index.js" --port 3200
