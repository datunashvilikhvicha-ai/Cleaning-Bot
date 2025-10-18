const TELEGRAM_API_BASE = 'https://api.telegram.org';

function assertConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Telegram configuration is missing.');
  }
  const { bot_token: botToken, chat_id: chatId } = config;
  if (!botToken) {
    throw new Error('Telegram bot_token is required.');
  }
  if (!chatId) {
    throw new Error('Telegram chat_id is required.');
  }
  return { botToken, chatId };
}

export async function sendTelegramNotification(config, { message, payload }) {
  const { botToken, chatId } = assertConfig(config);

  const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Telegram API error: ${response.status} ${errorText}`);
  }

  const data = await response.json().catch(() => ({}));
  return {
    ok: data.ok === true,
    messageId: data.result?.message_id,
    channel: 'telegram',
    tenant: payload?.tenant,
  };
}

