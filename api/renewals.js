import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    // 1️⃣ Fetch ONE known subscription (latest active)
    const subs = await stripe.subscriptions.list({
      status: "active",
      limit: 1,
      expand: ["data.customer", "data.items.data.price"]
    });

    const sub = subs.data[0];
    const customer = sub.customer;
    const item = sub.items.data[0];
    const price = item.price;

    const name = customer.name || "kund";
    const productName = price.nickname || "Olivkassen";
    const amount = (price.unit_amount / 100).toFixed(0);
    const interval =
      price.recurring.interval === "month"
        ? "månad"
        : price.recurring.interval;

    const renewalDate = new Date(
      sub.current_period_end * 1000
    ).toISOString().split("T")[0];

    // 2️⃣ HTML email (dark-mode safe)
    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,sans-serif;color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:32px;">
        <table width="100%" style="max-width:600px;background:#151515;border-radius:12px;padding:32px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <img src="https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/67a38a8645686cca76b775ec_olivkassen-logo.svg"
                   alt="Olivkassen"
                   width="140"
                   style="max-width:140px;height:auto;" />
            </td>
          </tr>

          <tr>
            <td style="font-size:16px;line-height:1.6;">
              <p>Hej ${name},</p>

              <p>Det börjar bli dags för nästa leverans av din beställning hos oss:</p>

              <p style="font-size:17px;font-weight:600;margin:16px 0;">
                ${productName} – ${amount} kr
              </p>

              <p>
                Leveransen sker var ${interval}. Din nästa förnyelse sker automatiskt den
                <strong>${renewalDate}</strong> och levereras till närmaste DHL-ombud.
              </p>

              <p style="margin-top:24px;">
                <a href="https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288"
                   style="display:inline-block;background:#ffffff;color:#000000;
                          padding:14px 22px;border-radius:999px;
                          font-weight:600;text-decoration:none;">
                  Kundportal
                </a>
              </p>

              <p style="margin-top:32px;">
                Tack för att du låter oss vara en del av ditt kök. Vi är stolta över att få
                leverera vår olivolja till dig.
              </p>

              <p>
                Frågor? Kontakta oss på
                <a href="mailto:kontakt@olivkassen.com" style="color:#ffffff;">
                  kontakt@olivkassen.com
                </a>
              </p>

              <p style="margin-top:24px;">
                Varma hälsningar,<br/>
                Olivkassen
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

    // 3️⃣ FORCE SEND (test email only)
    await sgMail.send({
      to: "energyze@me.com",
      from: "kontakt@olivkassen.com",
      subject: "Snart dags för nästa leverans",
      html
    });

    return res.json({ ok: true, sent: 1, mode: "force-test" });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
