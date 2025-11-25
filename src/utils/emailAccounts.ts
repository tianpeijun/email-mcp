export interface EmailAccount {
  name: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  imap: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
}

export function getEmailAccounts(): Map<string, EmailAccount> {
  const accounts = new Map<string, EmailAccount>();

  // QQ邮箱
  if (process.env.QQ_SMTP_USER && process.env.QQ_SMTP_PASS) {
    accounts.set("qq", {
      name: "qq",
      smtp: {
        host: process.env.QQ_SMTP_HOST || "smtp.qq.com",
        port: parseInt(process.env.QQ_SMTP_PORT || "465"),
        secure: process.env.QQ_SMTP_SECURE !== "false",
        user: process.env.QQ_SMTP_USER,
        pass: process.env.QQ_SMTP_PASS,
      },
      imap: {
        host: process.env.QQ_IMAP_HOST || "imap.qq.com",
        port: parseInt(process.env.QQ_IMAP_PORT || "993"),
        secure: process.env.QQ_IMAP_SECURE !== "false",
        user: process.env.QQ_SMTP_USER,
        pass: process.env.QQ_SMTP_PASS,
      },
    });
  }

  // 163邮箱
  if (process.env["163_SMTP_USER"] && process.env["163_SMTP_PASS"]) {
    accounts.set("163", {
      name: "163",
      smtp: {
        host: process.env["163_SMTP_HOST"] || "smtp.163.com",
        port: parseInt(process.env["163_SMTP_PORT"] || "465"),
        secure: process.env["163_SMTP_SECURE"] !== "false",
        user: process.env["163_SMTP_USER"],
        pass: process.env["163_SMTP_PASS"],
      },
      imap: {
        host: process.env["163_IMAP_HOST"] || "imap.163.com",
        port: parseInt(process.env["163_IMAP_PORT"] || "993"),
        secure: process.env["163_IMAP_SECURE"] !== "false",
        user: process.env["163_SMTP_USER"],
        pass: process.env["163_SMTP_PASS"],
      },
    });
  }

  return accounts;
}

export function getDefaultAccount(): string {
  return process.env.DEFAULT_EMAIL_ACCOUNT || "qq";
}

export function getAccountByEmail(email: string): EmailAccount | undefined {
  const accounts = getEmailAccounts();
  
  // 根据邮箱地址判断账户类型
  if (email.includes("@qq.com")) {
    return accounts.get("qq");
  } else if (email.includes("@163.com")) {
    return accounts.get("163");
  }
  
  // 返回默认账户
  const defaultAccount = getDefaultAccount();
  return accounts.get(defaultAccount);
}

export function getAllAccountEmails(): string[] {
  const accounts = getEmailAccounts();
  const emails: string[] = [];
  
  accounts.forEach((account) => {
    emails.push(account.smtp.user);
  });
  
  return emails;
}
