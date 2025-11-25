#!/bin/bash

# Email MCP Server - S3 Upload Script
# This script uploads deployment.zip to S3 bucket

set -e  # Exit on error

echo "=========================================="
echo "Uploading Deployment Package to S3"
echo "=========================================="

# Check if deployment.zip exists
if [ ! -f "deployment.zip" ]; then
    echo "❌ Error: deployment.zip not found."
    echo "Please run create-deployment-package.sh first."
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI is not installed."
    echo "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
fi

# Get AWS account ID
echo ""
echo "Step 1: Getting AWS account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)

if [ -z "$ACCOUNT_ID" ]; then
    echo "❌ Error: Failed to get AWS account ID."
    echo "Please configure AWS credentials using 'aws configure'"
    exit 1
fi

echo "AWS Account ID: $ACCOUNT_ID"

# Set bucket name
BUCKET_NAME="email-mcp-deployment-${ACCOUNT_ID}"
echo "S3 Bucket: $BUCKET_NAME"

# Check if bucket exists
echo ""
echo "Step 2: Checking if S3 bucket exists..."
if aws s3 ls "s3://${BUCKET_NAME}" 2>/dev/null; then
    echo "✅ Bucket exists: $BUCKET_NAME"
else
    echo "⚠️  Bucket does not exist yet."
    echo "It will be created by CloudFormation stack."
    echo ""
    read -p "Do you want to create the bucket now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Creating bucket..."
        aws s3 mb "s3://${BUCKET_NAME}" --region us-east-1
        
        # Enable versioning
        echo "Enabling versioning..."
        aws s3api put-bucket-versioning \
            --bucket "${BUCKET_NAME}" \
            --versioning-configuration Status=Enabled \
            --region us-east-1
        
        # Enable encryption
        echo "Enabling encryption..."
        aws s3api put-bucket-encryption \
            --bucket "${BUCKET_NAME}" \
            --server-side-encryption-configuration '{
                "Rules": [{
                    "ApplyServerSideEncryptionByDefault": {
                        "SSEAlgorithm": "AES256"
                    }
                }]
            }' \
            --region us-east-1
        
        echo "✅ Bucket created successfully"
    else
        echo "Skipping bucket creation. Make sure to deploy CloudFormation stack first."
    fi
fi

# Upload deployment.zip
echo ""
echo "Step 3: Uploading deployment.zip to S3..."
aws s3 cp deployment.zip "s3://${BUCKET_NAME}/deployment.zip" --region us-east-1

# Get file size and version
FILE_SIZE=$(du -h deployment.zip | cut -f1)
VERSION_ID=$(aws s3api head-object \
    --bucket "${BUCKET_NAME}" \
    --key deployment.zip \
    --query VersionId \
    --output text \
    --region us-east-1 2>/dev/null || echo "N/A")

echo ""
echo "=========================================="
echo "✅ Upload completed successfully!"
echo "=========================================="
echo "Bucket: $BUCKET_NAME"
echo "File: deployment.zip"
echo "Size: $FILE_SIZE"
echo "Version ID: $VERSION_ID"
echo "Region: us-east-1"
echo ""
echo "S3 URI: s3://${BUCKET_NAME}/deployment.zip"
echo ""
echo "Next step: Deploy CloudFormation stack using deploy-stack.sh"
echo "=========================================="
