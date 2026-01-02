import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // Allow POST only
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, message: "Use POST" });
  }

  // Auth check
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const received = req.headers.authorization;

  console.log("AUTH:", received);
  console.log("EXPECTED:", expected);

  if (received !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    // 🔥 FASTEST PROOF EMAIL
    await sendEmail({
      to: "energyze@me.com",
      subject: "Olivkassen – proof test email",
      text: `
Hej!

This is a proof test email.

If you received this, then:
- SendGrid works
- Domain auth works
- API key works
- Vercel env vars work

Timestamp: ${new Date().toISOString()}

– Olivkassen
      `.trim(),
    });

    return res.status(200).json({
      ok: true,
      sent: 1,
      message: "Proof email sent",
    });
  } catch (err) {
    console.error("SEND ERROR:", err);
    return res.status(500).json({
      error: err.message,
      details: err?.response?.body || null,
    });
  }
}
