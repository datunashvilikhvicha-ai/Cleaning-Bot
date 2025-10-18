let transporterPromise;

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || '587');
  const secure =
    process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465' || port === 465;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASSWORD || '').trim();
  const from = (process.env.EMAIL_FROM || process.env.SMTP_FROM || user || '').trim();

  if (!host) {
    throw new Error('SMTP_HOST environment variable is required for email notifications.');
  }

  const auth = user && pass ? { user, pass } : undefined;

  return { host, port, secure, auth, from };
}

async function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const smtpConfig = getSmtpConfig();
      let nodemailer;
      try {
        nodemailer = await import('nodemailer');
      } catch (error) {
        throw new Error(`nodemailer module is required for email notifications: ${error.message}`);
      }

      return nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: smtpConfig.auth,
      });
    })();
  }
  return transporterPromise;
}

function normalizeRecipients(input) {
  if (Array.isArray(input)) {
    return input.map((value) => value.trim()).filter(Boolean);
  }
  if (!input) return [];
  return input
    .toString()
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function assertEmailConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Email configuration is missing.');
  }
  const to = normalizeRecipients(config.to || config.recipients);
  if (!to.length) {
    throw new Error('Email destination (config.to) is required.');
  }
  return { to };
}

export async function sendEmailNotification(config, { subject, text, payload }) {
  const { to } = assertEmailConfig(config);
  const transporter = await getTransporter();
  const smtpConfig = getSmtpConfig();

  const html = `<p>${text.replace(/\n{2,}/g, '\n\n').replace(/\n/g, '<br/>')}</p>`;

  const info = await transporter.sendMail({
    from: smtpConfig.from || smtpConfig.auth?.user,
    to,
    subject,
    text,
    html,
  });

  return {
    messageId: info?.messageId,
    accepted: info?.accepted,
    rejected: info?.rejected,
    channel: 'email',
    tenant: payload?.tenant,
  };
}

