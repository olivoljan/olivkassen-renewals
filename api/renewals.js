import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // --- Allow GET for sanity check ---
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Renewals endpoint alive"
    });
  }

  // --- Only POST ---
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // --- CRON AUTH ---
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const received = req.headers.authorization;

  if (received !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const ninetyDaysFromNow = now + 90 * 24 * 60 * 60;

    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: [
        "data.customer",
        "data.items.data.price.product",
        "data.default_payment_method"
      ]
    });

    const upcoming = subs.data.filter(
      s =>
        s.current_period_end >= now &&
        s.current_period_end <= ninetyDaysFromNow
    );

    let sent = 0;

    for (const sub of upcoming) {
      const customer = sub.customer;
      if (!customer?.email) continue;

      // 🔒 HARD TEST LOCK — REMOVE WHEN GOING LIVE
      if (customer.email !== "energyze@me.com") continue;

      const item = sub.items.data[0];
      const product = item.price.product;
      const price = (item.price.unit_amount / 100).toFixed(0);

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

      const intervalMap = {
        month: "varje månad",
        year: "varje år"
      };

      const planInterval =
        intervalMap[item.price.recurring.interval] ??
        item.price.recurring.interval;

      const html = `
<!doctype html>
<html>
  <body style="margin:0;background:#0f0f0f;color:#ffffff;font-family:Inter,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table width="600" style="max-width:600px;padding:32px">
            <tr>
              <td align="center" style="padding-bottom:24px">
                <img src="https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/67a38a8645686cca76b775ec_olivkassen-logo.svg"
                     width="160"
                     style="display:block" />
              </td>
            </tr>

            <tr>
              <td style="font-size:16px;line-height:1.6">
                <p>Hej ${customer.name || ""},</p>

                <p>Det börjar bli dags för nästa leverans av din beställning hos oss:</p>

                <p style="font-size:18px;font-weight:500;margin:24px 0">
                  ${product.name} – ${price} kr
                </p>

                <p>
                  Leveransen sker ${planInterval}. Din nästa förnyelse sker automatiskt den
                  <strong>${renewalDate}</strong> och levereras till närmaste DHL-ombud.
                </p>

                <p style="margin:32px 0;text-align:center">
                  <a href="https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288"
                     style="
                       background:#ffffff;
                       color:#000000;
                       padding:14px 22px;
                       border-radius:6px;
                       text-decoration:none;
                       font-weight:600;
                       display:inline-block;">
                    Kundportal
                  </a>
                </p>

                <p>
                  Tack för att du låter oss vara en del av ditt kök. Vi är stolta över att få
                  leverera vår olivolja till dig och hoppas att den fortsätter att sätta
                  guldkant på dina måltider.
                </p>

                <p>
                  Frågor? Kontakta oss på
                  <a href="mailto:kontakt@olivkassen.com" style="color:#ffffff">
                    kontakt@olivkassen.com
                  </a>
                </p>

                <p>Varma hälsningar,<br/>Olivkassen</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
      `.trim();

      await sendEmail({
        to: customer.email,
        subject: "Snart dags för nästa Olivkassen-leverans",
        html
      });

      sent++;
    }

    return res.status(200).json({
      ok: true,
      upcoming: upcoming.length,
      sent
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
