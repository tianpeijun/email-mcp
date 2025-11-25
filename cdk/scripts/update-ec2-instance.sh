#!/bin/bash

# Script to update the application on EC2 instance

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

STACK_NAME="email-mcp-stack"
REGION="us-east-1"

# Get Elastic IP from CloudFormation outputs
print_info "Getting EC2 Elastic IP from CloudFormation..."
ELASTIC_IP=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --region ${REGION} \
    --query 'Stacks[0].Outputs[?OutputKey==`ElasticIPAddress`].OutputValue' \
    --output text)

if [ -z "${ELASTIC_IP}" ]; then
    print_error "Could not retrieve Elastic IP from CloudFormation stack"
    exit 1
fi

print_info "EC2 Elastic IP: ${ELASTIC_IP}"
print_info "Connecting to EC2 instance..."

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET_NAME="email-mcp-deployment-${ACCOUNT_ID}"

# SSH commands to update the application
ssh ec2-user@${ELASTIC_IP} << 'ENDSSH'
set -e

echo "Stopping email-mcp service..."
sudo systemctl stop email-mcp

echo "Downloading new deployment package..."
cd /opt/email-mcp
aws s3 cp s3://EMAIL_BUCKET_PLACEHOLDER/deployment.zip . --region us-east-1

echo "Extracting deployment package..."
unzip -o deployment.zip
rm deployment.zip

echo "Setting permissions..."
sudo chown -R ec2-user:ec2-user /opt/email-mcp
chmod +x /opt/email-mcp/start.sh

echo "Starting email-mcp service..."
sudo systemctl start email-mcp

echo "Waiting for service to start..."
sleep 5

echo "Checking service status..."
sudo systemctl status email-mcp

echo "Update complete!"
ENDSSH

# Replace placeholder with actual bucket name
ssh ec2-user@${ELASTIC_IP} "sed -i 's|EMAIL_BUCKET_PLACEHOLDER|${BUCKET_NAME}|g' /tmp/update-script.sh" 2>/dev/null || true

print_info "Application updated successfully on EC2 instance!"
print_info "You can check logs with: ssh ec2-user@${ELASTIC_IP} 'sudo journalctl -u email-mcp -f'"
