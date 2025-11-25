import { google } from "googleapis";
import nodemailer from "nodemailer";
import Imap from "imap";
import { simpleParser } from "mailparser";

interface ReplyEmailArgs {
  messageId: string;
  body: string;
  replyAll: boolean;
  html: boolean;
}

function getEmailProvider(): string {
  return process.env.EMAIL_PROVIDER || "smtp";
}

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  };
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

async function getOriginalEmailViaImap(messageId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const config = getImapConfig();
    const imap = new Imap(config);

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // Convert messageId to sequence number
        const seqno = parseInt(messageId);
        if (isNaN(seqno)) {
          imap.end();
          return reject(new Error("Invalid message ID"));
        }

        const fetch = imap.fetch([seqno], {
          bodies: "",
          struct: true,
        });

        fetch.on("message", (msg: any, seqno: number) => {
          msg.on("body", (stream: any) => {
            simpleParser(stream, async (err: any, parsed: any) => {
              if (err) {
                imap.end();
                return reject(err);
              }

              imap.end();
              resolve({
                from: parsed.from?.text || "",
                to: parsed.to?.text || "",
                cc: parsed.cc?.text || "",
                subject: parsed.subject || "",
                messageId: parsed.messageId || "",
                references: parsed.references || [],
              });
            });
          });
        });

        fetch.once("error", (err: any) => {
          imap.end();
          reject(err);
        });
      });
    });

    imap.once("error", (err: any) => {
      reject(err);
    });

    imap.connect();
  });
}

async function replyViaSmtp(args: ReplyEmailArgs, originalEmail: any): Promise<string> {
  const config = getSmtpConfig();
  const transporter = nodemailer.createTransport(config);

  const replySubject = originalEmail.subject.startsWith("Re:") 
    ? originalEmail.subject 
    : `Re: ${originalEmail.subject}`;

  let toAddresses = originalEmail.from;
  if (args.replyAll) {
    const allRecipients = [originalEmail.from, originalEmail.to, originalEmail.cc]
      .filter(addr => addr)
      .join(", ");
    toAddresses = allRecipients;
  }

  const mailOptions = {
    from: process.env.DEFAULT_FROM_EMAIL || process.env.SMTP_USER,
    to: toAddresses,
    subject: replySubject,
    text: args.html ? undefined : args.body,
    html: args.html ? args.body : undefined,
    inReplyTo: originalEmail.messageId,
    references: [...(originalEmail.references || []), originalEmail.messageId].filter(Boolean),
  };

  const info = await transporter.sendMail(mailOptions);
  return info.messageId;
}

async function replyViaGmail(args: ReplyEmailArgs): Promise<any> {
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

  const originalMessage = await gmail.users.messages.get({
    userId: "me",
    id: args.messageId,
  });

  const payload = originalMessage.data.payload;
  if (!payload?.headers) {
    throw new Error("Could not find original message headers");
  }

  const headers = payload.headers.reduce((acc: any, header: any) => {
    acc[header.name.toLowerCase()] = header.value;
    return acc;
  }, {});

  const originalSubject = headers.subject || "";
  const replySubject = originalSubject.startsWith("Re:") ? originalSubject : `Re: ${originalSubject}`;
  const originalFrom = headers.from || "";
  
  let toAddresses = originalFrom;
  if (args.replyAll) {
    const originalTo = headers.to || "";
    const originalCc = headers.cc || "";
    toAddresses = [originalFrom, originalTo, originalCc].filter(addr => addr).join(", ");
  }

  const emailLines = [
    `To: ${toAddresses}`,
    `Subject: ${replySubject}`,
    `In-Reply-To: ${headers["message-id"] || ""}`,
    `References: ${headers.references || headers["message-id"] || ""}`,
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
      threadId: originalMessage.data.threadId,
    },
  });

  return {
    toAddresses,
    replySubject,
    messageId: result.data.id,
  };
}

export function createReplyEmailTool() {
  return async (args: ReplyEmailArgs) => {
    try {
      const provider = getEmailProvider();
      let result: any;

      if (provider === "gmail") {
        result = await replyViaGmail(args);
      } else {
        // Use SMTP for reply
        const originalEmail = await getOriginalEmailViaImap(args.messageId);
        const messageId = await replyViaSmtp(args, originalEmail);
        
        const replySubject = originalEmail.subject.startsWith("Re:") 
          ? originalEmail.subject 
          : `Re: ${originalEmail.subject}`;
        
        let toAddresses = originalEmail.from;
        if (args.replyAll) {
          toAddresses = [originalEmail.from, originalEmail.to, originalEmail.cc]
            .filter(addr => addr)
            .join(", ");
        }

        result = {
          toAddresses,
          replySubject,
          messageId,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ 回复邮件发送成功！\n\n详情:\n- 收件人: ${result.toAddresses}\n- 主题: ${result.replySubject}\n- 消息ID: ${result.messageId}\n- 回复全部: ${args.replyAll ? "是" : "否"}\n- 格式: ${args.html ? "HTML" : "纯文本"}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: `❌ 回复邮件失败: ${errorMessage}`,
          },
        ],
      };
    }
  };
} 