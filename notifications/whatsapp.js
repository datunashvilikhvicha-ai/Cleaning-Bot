function assertConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('WhatsApp configuration is missing.');
  }
  const { api_url: apiUrl, access_token: accessToken } = config;
  const recipient = config.recipient || config.to || config.phone;

  if (!apiUrl) {
    throw new Error('WhatsApp api_url is required.');
  }
  if (!accessToken) {
    throw new Error('WhatsApp access_token is required.');
  }
  if (!recipient) {
    throw new Error('WhatsApp recipient phone is required (config.recipient or config.to).');
  }

  return { apiUrl, accessToken, recipient };
}

export async function sendWhatsappNotification(config, { message, payload }) {
  const { apiUrl, accessToken, recipient } = assertConfig(config);

  const body = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'text',
    text: {
      preview_url: false,
      body: message,
    },
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`WhatsApp API error: ${response.status} ${errorText}`);
  }

  const data = await response.json().catch(() => ({}));
  return {
    messageId: data.messages?.[0]?.id,
    channel: 'whatsapp',
    tenant: payload?.tenant,
  };
}

