import nodemailer from "nodemailer";
import { gmail_v1, google } from "googleapis";
import fs from "fs/promises";
import { getEmailAccounts, getAccountByEmail, getDefaultAccount } from "../utils/emailAccounts.js";

// 发送邮件参数接口
interface SendEmailArgs {
  to: string;          // 收件人
  subject: string;     // 邮件主题
  body: string;        // 邮件内容
  from?: string;       // 发件人（可选，用于选择账户）
  html?: boolean;      // 是否为HTML格式
  attachments?: Array<{
    filename: string;  // 附件文件名
    path?: string;     // 文件路径
    content?: string;  // 文件内容
  }>;
}

// 邮件配置接口
interface EmailConfig {
  provider: "smtp" | "gmail";  // 邮件提供商
  smtp?: {
    host: string;              // SMTP服务器地址
    port: number;              // 端口号
    secure: boolean;           // 是否使用SSL
    auth: {
      user: string;            // 用户名
      pass: string;            // 密码或授权码
    };
  };
  gmail?: {
    clientId: string;          // Gmail客户端ID
    clientSecret: string;      // Gmail客户端密钥
    refreshToken: string;      // 刷新令牌
    accessToken?: string;      // 访问令牌
  };
  defaultFrom: string;         // 默认发件人
}

// 获取邮件配置
function getEmailConfig(): EmailConfig {
  const provider = (process.env.EMAIL_PROVIDER || "smtp") as "smtp" | "gmail";
  
  if (provider === "gmail") {
    return {
      provider: "gmail",
      gmail: {
        clientId: process.env.GMAIL_CLIENT_ID!,
        clientSecret: process.env.GMAIL_CLIENT_SECRET!,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN!,
        accessToken: process.env.GMAIL_ACCESS_TOKEN,
      },
      defaultFrom: process.env.DEFAULT_FROM_EMAIL!,
    };
  }

  return {
    provider: "smtp",
    smtp: {
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
    },
    defaultFrom: process.env.DEFAULT_FROM_EMAIL!,
  };
}

// 通过Gmail API发送邮件
async function sendViaGmail(args: SendEmailArgs, config: EmailConfig) {
  const oauth2Client = new google.auth.OAuth2(
    config.gmail!.clientId,
    config.gmail!.clientSecret
  );

  oauth2Client.setCredentials({
    refresh_token: config.gmail!.refreshToken,
    access_token: config.gmail!.accessToken,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  // 创建邮件内容
  const emailLines = [
    `To: ${args.to}`,
    `From: ${args.from || config.defaultFrom}`,
    `Subject: ${args.subject}`,
    `Content-Type: ${args.html ? "text/html" : "text/plain"}; charset=utf-8`,
    "",
    args.body,
  ];

  const email = emailLines.join("\n");
  const encodedEmail = Buffer.from(email).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedEmail,
    },
  });

  return {
    success: true,
    messageId: result.data.id,
    provider: "gmail",
  };
}

// 通过SMTP发送邮件（多账户支持）
async function sendViaSMTPMultiAccount(args: SendEmailArgs) {
  const accounts = getEmailAccounts();
  
  // 根据 from 参数选择账户，如果没有指定则使用默认账户
  let account;
  if (args.from) {
    account = getAccountByEmail(args.from);
  } else {
    const defaultAccountName = getDefaultAccount();
    account = accounts.get(defaultAccountName);
  }

  if (!account) {
    throw new Error("未找到可用的邮箱账户配置");
  }

  const transporter = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: {
      user: account.smtp.user,
      pass: account.smtp.pass,
    },
  });

  // 处理附件
  const attachments = [];
  if (args.attachments) {
    for (const attachment of args.attachments) {
      if (attachment.path) {
        attachments.push({
          filename: attachment.filename,
          path: attachment.path,
        });
      } else if (attachment.content) {
        attachments.push({
          filename: attachment.filename,
          content: attachment.content,
        });
      }
    }
  }

  const mailOptions = {
    from: account.smtp.user,
    to: args.to,
    subject: args.subject,
    [args.html ? "html" : "text"]: args.body,
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  const result = await transporter.sendMail(mailOptions);
  return {
    success: true,
    messageId: result.messageId,
    provider: "smtp",
    accountUsed: account.smtp.user,
  };
}

// 通过SMTP发送邮件（旧版单账户）
async function sendViaSMTP(args: SendEmailArgs, config: EmailConfig) {
  const transporter = nodemailer.createTransport({
    host: config.smtp!.host,
    port: config.smtp!.port,
    secure: config.smtp!.secure,
    auth: config.smtp!.auth,
  });

  const attachments = [];
  if (args.attachments) {
    for (const attachment of args.attachments) {
      if (attachment.path) {
        attachments.push({
          filename: attachment.filename,
          path: attachment.path,
        });
      } else if (attachment.content) {
        attachments.push({
          filename: attachment.filename,
          content: attachment.content,
        });
      }
    }
  }

  const mailOptions = {
    from: args.from || config.defaultFrom,
    to: args.to,
    subject: args.subject,
    [args.html ? "html" : "text"]: args.body,
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  const result = await transporter.sendMail(mailOptions);
  return {
    success: true,
    messageId: result.messageId,
    provider: "smtp",
    accountUsed: args.from || config.defaultFrom,
  };
}

// 创建发送邮件工具
export function createSendEmailTool() {
  return async (args: SendEmailArgs) => {
    try {
      const accounts = getEmailAccounts();
      
      // 如果有多账户配置，使用多账户模式
      if (accounts.size > 0) {
        const result = await sendViaSMTPMultiAccount(args);
        return {
          content: [
            {
              type: "text",
              text: `✅ 邮件发送成功！\n\n详情:\n- 发件人: ${result.accountUsed}\n- 收件人: ${args.to}\n- 主题: ${args.subject}\n- 消息ID: ${result.messageId}\n- 格式: ${args.html ? "HTML" : "纯文本"}${args.attachments ? `\n- 附件数量: ${args.attachments.length}` : ""}`,
            },
          ],
        };
      }
      
      // 否则使用旧版单账户模式
      const config = getEmailConfig();
      
      if (config.provider === "gmail") {
        if (!config.gmail?.clientId || !config.gmail?.clientSecret || !config.gmail?.refreshToken) {
          throw new Error("Gmail配置缺失。请设置 GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, 和 GMAIL_REFRESH_TOKEN");
        }
      } else {
        if (!config.smtp?.auth.user || !config.smtp?.auth.pass) {
          throw new Error("SMTP配置缺失。请设置 SMTP_USER 和 SMTP_PASS");
        }
      }

      if (!config.defaultFrom) {
        throw new Error("DEFAULT_FROM_EMAIL 环境变量是必需的");
      }

      let result: any;
      if (config.provider === "gmail") {
        result = await sendViaGmail(args, config);
      } else {
        result = await sendViaSMTP(args, config);
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ 邮件发送成功！\n\n详情:\n- 发件人: ${result.accountUsed || config.defaultFrom}\n- 收件人: ${args.to}\n- 主题: ${args.subject}\n- 提供商: ${result.provider}\n- 消息ID: ${result.messageId}\n- 格式: ${args.html ? "HTML" : "纯文本"}${args.attachments ? `\n- 附件数量: ${args.attachments.length}` : ""}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "发生未知错误";
      return {
        content: [
          {
            type: "text",
            text: `❌ 邮件发送失败: ${errorMessage}`,
          },
        ],
      };
    }
  };
} 