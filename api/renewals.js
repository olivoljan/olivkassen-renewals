import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // Allow GET for sanity check
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "GET ok – endpoint alive",
    });
  }

  // Only POST
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // CRON AUTH
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const received = req.headers.authorization;

  console.log("AUTH:", received);
  console.log("EXPECTED:", expected);

  if (received !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    console.log("SENDING TEST EMAIL NOW");

    await sendEmail({
      to: "energyze@me.com",
      subject: "✅ Olivkassen – proof test email",
      text: `
Hej!

Om du får detta mail fungerar:
- Vercel
- CRON auth
- SendGrid
- DNS
- API-nyckel

Nästa steg är Stripe-logiken.

Mvh
Olivkassen
      `.trim(),
    });

    return res.status(200).json({
      ok: true,
      sent: 1,
    });
  } catch (err) {
    console.error("SEND ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
