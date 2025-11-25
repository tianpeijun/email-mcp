#!/bin/bash
set -e

# 快速更新代码到 AWS
# 使用方法: ./cdk/update.sh

REGION="us-east-1"
BUCKET_NAME="email-mcp-deployment-$(aws sts get-caller-identity --query Account --output text)"
STACK_NAME="email-mcp-stack"

echo "==> 1. 构建项目..."
npm run build

echo "==> 2. 创建部署包..."
zip -r deployment.zip dist package.json package-lock.json start.sh node_modules -q

echo "==> 3. 上传到 S3..."
aws s3 cp deployment.zip s3://${BUCKET_NAME}/deployment.zip --region ${REGION}

echo "==> 4. 更新 EC2 实例..."
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`EC2InstanceId`].OutputValue' \
  --output text)

echo "实例 ID: ${INSTANCE_ID}"

# 在 EC2 上执行更新命令
aws ssm send-command \
  --instance-ids ${INSTANCE_ID} \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=[
    "cd /opt/email-mcp",
    "aws s3 cp s3://'${BUCKET_NAME}'/deployment.zip . --region '${REGION}'",
    "unzip -o deployment.zip",
    "rm deployment.zip",
    "sudo systemctl restart email-mcp",
    "sleep 3",
    "sudo systemctl status email-mcp"
  ]' \
  --region ${REGION} \
  --output text

echo "==> 完成！代码已更新并重启服务"
echo "查看日志: aws logs tail /aws/ec2/email-mcp-alb --follow --region ${REGION}"
