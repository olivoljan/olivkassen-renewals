import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const TEST_MODE = true;
const TEST_INBOX = "olivkassen@gmail.com";

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const NOW = Math.floor(Date.now() / 1000);
  const IN_24_DAYS = NOW + 24 * 24 * 60 * 60;

  let checked = 0;
  let eligible = 0;
  let sent = 0;
  let failed = 0;
  const errors = [];

  try {
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      checked++;

      if (
        sub.current_period_end < NOW ||
        sub.current_period_end > IN_24_DAYS
      ) {
        continue;
      }

      eligible++;

      const customer = sub.customer;
      if (!customer?.email) continue;

      const item = sub.items.data[0];
      const price = item.price;

      const variables = {
        name: customer.name || "vän",
        product_title: price.nickname || "Olivkassen",
        price: (price.unit_amount / 100).toFixed(0),
        plan_interval:
          price.recurring.interval === "month"
            ? "månad"
            : "period",
        renewal_date: new Date(
          sub.current_period_end * 1000
        ).toLocaleDateString("sv-SE"),
        portal_url:
          "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
      };

      try {
        await sgMail.send({
          to: TEST_MODE ? TEST_INBOX : customer.email,
          from: {
            email: "kontakt@olivkassen.com",
            name: "Olivkassen",
          },
          templateId: "d-fe01cb7634114535a27600e27d48c5d3",
          dynamicTemplateData: variables,
        });

        sent++;
      } catch (err) {
        failed++;
        errors.push(err.message);
      }
    }

    // 🚨 ALERT if something is wrong
    if (eligible > 0 && (sent === 0 || failed > 0)) {
      await sgMail.send({
        to: "olivkassen@gmail.com",
        from: "kontakt@olivkassen.com",
        subject: "🚨 Renewal email issue detected",
        text: `
Checked: ${checked}
Eligible: ${eligible}
Sent: ${sent}
Failed: ${failed}

Errors:
${errors.join("\n")}
        `,
      });
    }

    return res.status(200).json({
      ok: true,
      checked,
      eligible,
      sent,
      failed,
      testMode: TEST_MODE,
    });
  } catch (err) {
    console.error("RENEWALS FATAL ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
