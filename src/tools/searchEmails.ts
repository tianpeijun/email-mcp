import { google } from "googleapis";
import ImapOriginal from "imap";
// @ts-ignore
import ImapMkl from "imap-mkl";
import { simpleParser } from "mailparser";

interface SearchEmailsArgs {
  query: string;
  limit: number;
  folder: string;
}

function getEmailProvider(): string {
  return process.env.EMAIL_PROVIDER || "smtp";
}

function getImapConfig() {
  return {
    user: process.env.IMAP_USER || process.env.SMTP_USER!,
    password: process.env.IMAP_PASS || process.env.SMTP_PASS!,
    host: process.env.IMAP_HOST || "imap.qq.com",
    port: parseInt(process.env.IMAP_PORT || "993"),
    tls: process.env.IMAP_SECURE !== "false",
    tlsOptions: { rejectUnauthorized: false },
  };
}

async function searchEmailsViaImap(args: SearchEmailsArgs): Promise<any[]> {
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
    const emails: any[] = [];

    imap.once("ready", () => {
      imap.openBox(args.folder, true, (err: any, box: any) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // Search all emails first
        imap.search(["ALL"], (err: any, results: any) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          if (!results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          const fetch = imap.fetch(results, {
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
                const body = textBody || htmlBody.toString();

                // Filter by query (simple text search in from, subject, body)
                const queryLower = args.query.toLowerCase();
                const fromMatch = queryLower.includes("from:") 
                  ? from.toLowerCase().includes(queryLower.replace("from:", "").trim())
                  : true;
                const textMatch = !queryLower.includes("from:") 
                  ? (from.toLowerCase().includes(queryLower) ||
                     subject.toLowerCase().includes(queryLower) ||
                     body.toLowerCase().includes(queryLower))
                  : true;

                if (fromMatch && textMatch) {
                  emails.push({
                    id: seqno.toString(),
                    from,
                    to,
                    subject,
                    snippet: body.substring(0, 150),
                    date,
                  });
                }
              });
            });
          });

          fetch.once("error", (err: any) => {
            imap.end();
            reject(err);
          });

          fetch.once("end", () => {
            imap.end();
            // Wait for all messages to be parsed
            setTimeout(() => {
              // Limit results and sort by date (newest first)
              const limitedEmails = emails.slice(-args.limit);
              resolve(limitedEmails);
            }, 1000);
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

async function searchEmailsViaGmail(args: SearchEmailsArgs): Promise<any[]> {
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
  
  let searchQuery = args.query;
  if (args.folder !== "INBOX") {
    searchQuery += ` in:${args.folder}`;
  }

  const messagesResponse = await gmail.users.messages.list({
    userId: "me",
    q: searchQuery,
    maxResults: args.limit,
  });

  const messages = messagesResponse.data.messages || [];
  const emails = [];

  for (const message of messages) {
    if (!message.id) continue;

    const messageDetail = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
    });

    const payload = messageDetail.data.payload;
    if (!payload?.headers) continue;

    const headers = payload.headers.reduce((acc: any, header: any) => {
      acc[header.name.toLowerCase()] = header.value;
      return acc;
    }, {});

    emails.push({
      id: message.id,
      from: headers.from || "",
      to: headers.to || "",
      subject: headers.subject || "",
      snippet: messageDetail.data.snippet || "",
      date: headers.date || "",
    });
  }

  return emails;
}

export function createSearchEmailsTool() {
  return async (args: SearchEmailsArgs) => {
    try {
      const provider = getEmailProvider();
      let emails: any[] = [];

      if (provider === "gmail") {
        emails = await searchEmailsViaGmail(args);
      } else {
        emails = await searchEmailsViaImap(args);
      }

      const resultText = emails.length > 0 
        ? `🔍 Found ${emails.length} email(s) matching "${args.query}":\n\n` + 
          emails.map((email, index) => 
            `${index + 1}. **${email.subject}**\n` +
            `   From: ${email.from}\n` +
            `   Date: ${email.date}\n` +
            `   Snippet: ${email.snippet}\n` +
            `   Message ID: ${email.id}\n` +
            `   ---\n`
          ).join("\n")
        : `🔍 No emails found matching "${args.query}" in ${args.folder}`;

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
            text: `❌ Failed to search emails: ${errorMessage}`,
          },
        ],
      };
    }
  };
} 