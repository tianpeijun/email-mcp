import { google } from "googleapis";
import ImapOriginal from "imap";
// @ts-ignore
import ImapMkl from "imap-mkl";
import { simpleParser } from "mailparser";
import { getEmailAccounts, getAccountByEmail, getDefaultAccount } from "../utils/emailAccounts.js";

interface ReadEmailsArgs {
  limit: number;
  folder: string;
  unreadOnly: boolean;
  account?: string; // 可选：指定账户名称（qq, 163）或邮箱地址
}

interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  body?: string;
}

function getEmailProvider(): string {
  return process.env.EMAIL_PROVIDER || "smtp";
}

function getImapConfig(accountName?: string) {
  const accounts = getEmailAccounts();
  
  // 如果指定了账户，使用指定的账户
  if (accountName) {
    // 先尝试作为账户名称查找
    let account = accounts.get(accountName.toLowerCase());
    
    // 如果没找到，尝试作为邮箱地址查找
    if (!account) {
      account = getAccountByEmail(accountName);
    }
    
    if (account) {
      return {
        user: account.imap.user,
        password: account.imap.pass,
        host: account.imap.host,
        port: account.imap.port,
        tls: account.imap.secure,
        tlsOptions: { rejectUnauthorized: false },
      };
    }
  }
  
  // 使用默认账户
  const defaultAccountName = getDefaultAccount();
  const defaultAccount = accounts.get(defaultAccountName);
  
  if (defaultAccount) {
    return {
      user: defaultAccount.imap.user,
      password: defaultAccount.imap.pass,
      host: defaultAccount.imap.host,
      port: defaultAccount.imap.port,
      tls: defaultAccount.imap.secure,
      tlsOptions: { rejectUnauthorized: false },
    };
  }
  
  // 回退到环境变量配置
  return {
    user: process.env.IMAP_USER || process.env.SMTP_USER!,
    password: process.env.IMAP_PASS || process.env.SMTP_PASS!,
    host: process.env.IMAP_HOST || "imap.qq.com",
    port: parseInt(process.env.IMAP_PORT || "993"),
    tls: process.env.IMAP_SECURE !== "false",
    tlsOptions: { rejectUnauthorized: false },
  };
}

function getGmailConfig() {
  return {
    clientId: process.env.GMAIL_CLIENT_ID!,
    clientSecret: process.env.GMAIL_CLIENT_SECRET!,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN!,
    accessToken: process.env.GMAIL_ACCESS_TOKEN,
  };
}

async function readEmailsViaImap(args: ReadEmailsArgs): Promise<EmailMessage[]> {
  return new Promise((resolve, reject) => {
    const config = getImapConfig(args.account);
    
    // 检查是否是 163 邮箱，如果是则使用 imap-mkl 并添加 ID 信息
    const is163 = config.host.includes('163.com');
    let imap: any;
    
    if (is163) {
      const configWith163Id = {
        ...config,
        id: {
          name: 'email-mcp',
          version: '1.0.0',
          vendor: 'email-mcp-client',
          'support-email': config.user
        }
      };
      imap = new ImapMkl(configWith163Id);
    } else {
      imap = new ImapOriginal(config);
    }
    const emails: EmailMessage[] = [];

    imap.once("ready", () => {
      imap.openBox(args.folder, true, (err: any, box: any) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        const searchCriteria = args.unreadOnly ? ["UNSEEN"] : ["ALL"];
        
        imap.search(searchCriteria, (err: any, results: any) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          if (!results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          // Limit results
          const limitedResults = results.slice(-args.limit);
          
          const fetch = imap.fetch(limitedResults, {
            bodies: "",
            struct: true,
          });

          fetch.on("message", (msg: any, seqno: number) => {
            msg.on("body", (stream: any) => {
              simpleParser(stream, async (err: any, parsed: any) => {
                if (err) return;

                const from = parsed.from?.text || "";
                const to = parsed.to?.text || "";
                const subject = parsed.subject || "";
                const date = parsed.date?.toString() || "";
                const textBody = parsed.text || "";
                const htmlBody = parsed.html || "";
                const body = textBody || htmlBody.toString().substring(0, 1000);

                emails.push({
                  id: seqno.toString(),
                  threadId: parsed.messageId || seqno.toString(),
                  from,
                  to,
                  subject,
                  snippet: body.substring(0, 150),
                  date,
                  isUnread: args.unreadOnly,
                  body: body.substring(0, 1000),
                });
              });
            });
          });

          fetch.once("error", (err: any) => {
            imap.end();
            reject(err);
          });

          fetch.once("end", () => {
            imap.end();
            // Wait a bit for all messages to be parsed
            setTimeout(() => resolve(emails), 500);
          });
        });
      });
    });

    imap.once("error", (err: any) => {
      reject(err);
    });

    imap.connect();
  });
}

async function getGmailClient() {
  const config = getGmailConfig();
  
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error("Gmail configuration missing. Please set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN");
  }

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret
  );

  oauth2Client.setCredentials({
    refresh_token: config.refreshToken,
    access_token: config.accessToken,
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

function parseEmailHeaders(headers: any[]): { from: string; to: string; subject: string; date: string } {
  const result = { from: "", to: "", subject: "", date: "" };
  
  for (const header of headers) {
    switch (header.name.toLowerCase()) {
      case "from":
        result.from = header.value;
        break;
      case "to":
        result.to = header.value;
        break;
      case "subject":
        result.subject = header.value;
        break;
      case "date":
        result.date = header.value;
        break;
    }
  }
  
  return result;
}

function extractEmailBody(payload: any): string {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    }
    
    // If no plain text, try HTML
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    }
  }
  
  return "";
}

async function readEmailsViaGmail(args: ReadEmailsArgs): Promise<EmailMessage[]> {
  const gmail = await getGmailClient();
  
  let query = "";
  if (args.folder !== "INBOX") {
    query += `in:${args.folder}`;
  }
  if (args.unreadOnly) {
    query += query ? " is:unread" : "is:unread";
  }

  const messagesResponse = await gmail.users.messages.list({
    userId: "me",
    q: query || undefined,
    maxResults: args.limit,
  });

  const messages = messagesResponse.data.messages || [];
  const emails: EmailMessage[] = [];

  for (const message of messages) {
    if (!message.id) continue;

    const messageDetail = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
    });

    const payload = messageDetail.data.payload;
    if (!payload?.headers) continue;

    const headers = parseEmailHeaders(payload.headers);
    const body = extractEmailBody(payload);
    
    const isUnread = messageDetail.data.labelIds?.includes("UNREAD") || false;

    emails.push({
      id: message.id,
      threadId: messageDetail.data.threadId || "",
      from: headers.from,
      to: headers.to,
      subject: headers.subject,
      snippet: messageDetail.data.snippet || "",
      date: headers.date,
      isUnread,
      body: body.length > 1000 ? body.substring(0, 1000) + "..." : body,
    });
  }

  return emails;
}

export function createReadEmailsTool() {
  return async (args: ReadEmailsArgs) => {
    try {
      const provider = getEmailProvider();
      let emails: EmailMessage[] = [];

      if (provider === "gmail") {
        emails = await readEmailsViaGmail(args);
      } else {
        // Use IMAP for SMTP provider
        emails = await readEmailsViaImap(args);
      }

      const resultText = emails.length > 0 
        ? `📧 Found ${emails.length} email(s):\n\n` + 
          emails.map((email, index) => 
            `${index + 1}. ${email.isUnread ? "🔵 " : ""}**${email.subject}**\n` +
            `   From: ${email.from}\n` +
            `   Date: ${email.date}\n` +
            `   Snippet: ${email.snippet}\n` +
            `   Message ID: ${email.id}\n` +
            (email.body ? `   Body Preview: ${email.body.substring(0, 200)}...\n` : "") +
            `   ---\n`
          ).join("\n")
        : `📭 No emails found in ${args.folder}${args.unreadOnly ? " (unread only)" : ""}`;

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to read emails: ${errorMessage}`,
          },
        ],
      };
    }
  };
} 