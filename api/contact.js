/**
 * Vercel serverless contact endpoint.
 * Verifies Cloudflare Turnstile server-side, then emails via Resend when configured.
 *
 * Env (set in Vercel project settings — never commit secrets):
 * - TURNSTILE_SECRET_KEY (required for this route)
 * - RESEND_API_KEY (optional — if missing, client falls back to mailto after verify)
 * - CONTACT_TO_EMAIL (optional — defaults to hello@anisafoundation.org)
 * - CONTACT_FROM_EMAIL (optional — must be a verified Resend sender)
 */

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return { ok: false, error: 'Turnstile is not configured on the server.' };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (ip) body.set('remoteip', ip);

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await response.json();
  if (!data.success) {
    return { ok: false, error: 'Security check failed. Please try again.' };
  }
  return { ok: true };
}

async function sendWithResend({ name, email, message }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false };

  const to = process.env.CONTACT_TO_EMAIL || 'hello@anisafoundation.org';
  const from =
    process.env.CONTACT_FROM_EMAIL || 'Anisa Foundation <onboarding@resend.dev>';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `Website message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || 'Email provider rejected the message.');
  }

  return { sent: true };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  try {
    const payload = await readBody(req);
    const name = String(payload.name ?? '').trim();
    const email = String(payload.email ?? '').trim();
    const message = String(payload.message ?? '').trim();
    const token = String(payload.turnstileToken ?? '').trim();

    if (!name || !email || !message) {
      json(res, 400, { ok: false, error: 'Please fill in all of the required fields.' });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      json(res, 400, { ok: false, error: 'Please enter a valid email address.' });
      return;
    }

    if (!token) {
      json(res, 400, {
        ok: false,
        error: 'Please complete the security check before submitting.',
      });
      return;
    }

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      undefined;

    const verification = await verifyTurnstile(token, ip);
    if (!verification.ok) {
      json(res, 400, { ok: false, error: verification.error });
      return;
    }

    const delivery = await sendWithResend({ name, email, message });

    json(res, 200, {
      ok: true,
      delivered: delivery.sent,
      message: delivery.sent
        ? 'Thank you for your message. It has been sent.'
        : 'Security check passed. Opening your email app to finish sending.',
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Something went wrong. Please email us directly.',
    });
  }
}
