# Email MCP Server - AWS 部署

## 目录结构

```
cdk/
├── cloudformation-minimal.yaml    # 最小化部署（单 EC2）
├── cloudformation-with-alb.yaml   # 带 ALB 的部署（推荐）
├── update.sh                      # 快速更新脚本
└── scripts/
    ├── create-deployment-package.sh  # 创建部署包
    ├── update-ec2-instance.sh        # 更新 EC2 实例
    └── upload-to-s3.sh               # 上传到 S3
```

## 快速开始

### 首次部署

1. 创建部署包并上传：
```bash
./cdk/scripts/create-deployment-package.sh
./cdk/scripts/upload-to-s3.sh
```

2. 部署 CloudFormation stack：
```bash
aws cloudformation create-stack \
  --stack-name email-mcp-stack \
  --template-body file://cdk/cloudformation-with-alb.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

3. 等待部署完成（约 5 分钟）：
```bash
aws cloudformation wait stack-create-complete \
  --stack-name email-mcp-stack \
  --region us-east-1
```

4. 获取服务端点：
```bash
aws cloudformation describe-stacks \
  --stack-name email-mcp-stack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs'
```

### 更新代码

修改代码后，运行：

```bash
./cdk/update.sh
```

这个脚本会自动：
1. 构建项目
2. 创建部署包
3. 上传到 S3
4. 更新 EC2 实例
5. 重启服务

### 查看日志

```bash
aws logs tail /aws/ec2/email-mcp-alb --follow --region us-east-1
```

### SSH 到 EC2

```bash
# 获取公网 IP
PUBLIC_IP=$(aws cloudformation describe-stacks \
  --stack-name email-mcp-stack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`EC2PublicIP`].OutputValue' \
  --output text)

# SSH 连接
ssh ec2-user@${PUBLIC_IP}
```

### 删除部署

```bash
aws cloudformation delete-stack \
  --stack-name email-mcp-stack \
  --region us-east-1
```

## 两种部署方式

### 1. cloudformation-minimal.yaml
- 单个 EC2 实例
- 直接通过公网 IP 访问
- 适合测试和开发

### 2. cloudformation-with-alb.yaml（推荐）
- EC2 + Application Load Balancer
- 通过 ALB 访问，更稳定
- 支持健康检查和自动恢复
- 适合生产环境

## 故障排查

### 服务无法访问

1. 检查服务状态：
```bash
ssh ec2-user@<PUBLIC_IP>
sudo systemctl status email-mcp
```

2. 查看日志：
```bash
sudo journalctl -u email-mcp -f
```

### 健康检查失败

检查 Target Group 健康状态：
```bash
aws elbv2 describe-target-health \
  --target-group-arn <TARGET_GROUP_ARN> \
  --region us-east-1
```
