import { getEmailAccounts, getAllAccountEmails } from "../utils/emailAccounts.js";

export function createListAccountsTool() {
  return async () => {
    try {
      const accounts = getEmailAccounts();
      const emails = getAllAccountEmails();

      if (accounts.size === 0) {
        return {
          content: [
            {
              type: "text",
              text: "❌ 未配置任何邮箱账户",
            },
          ],
        };
      }

      const accountList = Array.from(accounts.entries())
        .map(([name, account], index) => {
          return `${index + 1}. **${name.toUpperCase()}邮箱**\n` +
                 `   邮箱地址: ${account.smtp.user}\n` +
                 `   SMTP: ${account.smtp.host}:${account.smtp.port}\n` +
                 `   IMAP: ${account.imap.host}:${account.imap.port}\n`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `📧 已配置 ${accounts.size} 个邮箱账户:\n\n${accountList}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: `❌ 获取账户列表失败: ${errorMessage}`,
          },
        ],
      };
    }
  };
}
