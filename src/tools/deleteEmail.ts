import { google } from "googleapis";
import ImapOriginal from "imap";
// @ts-ignore
import ImapMkl from "imap-mkl";
import { getEmailAccounts, getDefaultAccount } from "../utils/emailAccounts.js";

interface DeleteEmailArgs {
  messageId: string;
}

function getEmailProvider(): string {
  return process.env.EMAIL_PROVIDER || "smtp";
}

function getImapConfig() {
  const accounts = getEmailAccounts();
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
  
  return {
    user: process.env.IMAP_USER || process.env.SMTP_USER!,
    password: process.env.IMAP_PASS || process.env.SMTP_PASS!,
    host: process.env.IMAP_HOST || "imap.qq.com",
    port: parseInt(process.env.IMAP_PORT || "993"),
    tls: process.env.IMAP_SECURE !== "false",
    tlsOptions: { rejectUnauthorized: false },
  };
}

async function deleteEmailViaImap(messageId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const config = getImapConfig();
    
    // 检查是否是 163 邮箱
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

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err: any, box: any) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        const seqno = parseInt(messageId);
        if (isNaN(seqno)) {
          imap.end();
          return reject(new Error("Invalid message ID"));
        }

        // 标记为删除
        imap.addFlags([seqno], '\\Deleted', (err: any) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          // 执行删除
          imap.expunge((err: any) => {
            imap.end();
            if (err) {
              return reject(err);
            }
            resolve();
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

export function createDeleteEmailTool() {
  return async (args: DeleteEmailArgs) => {
    try {
      const provider = getEmailProvider();
      
      if (provider === "gmail") {
        const config = {
          clientId: process.env.GMAIL_CLIENT_ID!,
          clientSecret: process.env.GMAIL_CLIENT_SECRET!,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN!,
          accessToken: process.env.GMAIL_ACCESS_TOKEN,
        };
        
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

        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        await gmail.users.messages.delete({
          userId: "me",
          id: args.messageId,
        });
      } else {
        // 使用 IMAP 删除
        await deleteEmailViaImap(args.messageId);
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ 邮件删除成功！\n\n消息ID: ${args.messageId}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: `❌ 删除邮件失败: ${errorMessage}`,
          },
        ],
      };
    }
  };
} 