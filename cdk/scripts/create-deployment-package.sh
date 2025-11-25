#!/bin/bash

# Email MCP Server - Deployment Package Creation Script
# This script builds the project and creates a deployment.zip package

set -e  # Exit on error

echo "=========================================="
echo "Creating Email MCP Deployment Package"
echo "=========================================="

# Check if we're in the project root
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found. Please create .env file with email configuration."
    exit 1
fi

echo ""
echo "Step 1: Installing dependencies..."
npm install

echo ""
echo "Step 2: Building project..."
npm run build

# Check if build was successful
if [ ! -d "dist" ]; then
    echo "❌ Error: Build failed. dist/ directory not found."
    exit 1
fi

echo ""
echo "Step 3: Creating deployment directory..."
rm -rf deployment
mkdir -p deployment

echo ""
echo "Step 4: Copying files to deployment directory..."
cp -r dist deployment/
cp -r node_modules deployment/
cp package.json deployment/
cp .env deployment/

echo ""
echo "Step 5: Copying start.sh script..."
if [ ! -f "start.sh" ]; then
    echo "❌ Error: start.sh not found in project root."
    exit 1
fi
cp start.sh deployment/
chmod +x deployment/start.sh

echo ""
echo "Step 6: Creating deployment.zip..."
cd deployment
zip -r ../deployment.zip . -q
cd ..

# Get zip file size
ZIP_SIZE=$(du -h deployment.zip | cut -f1)

echo ""
echo "Step 7: Cleaning up temporary files..."
rm -rf deployment

echo ""
echo "=========================================="
echo "✅ Deployment package created successfully!"
echo "=========================================="
echo "Package: deployment.zip"
echo "Size: $ZIP_SIZE"
echo ""
echo "Contents:"
echo "  - dist/ (compiled code)"
echo "  - node_modules/ (dependencies)"
echo "  - package.json"
echo "  - .env (email configuration)"
echo "  - start.sh (startup script)"
echo ""
echo "Next step: Upload to S3 using upload-to-s3.sh"
echo "=========================================="
