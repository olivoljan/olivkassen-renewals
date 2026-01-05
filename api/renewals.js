import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export default async function handler(req, res) {
  try {
    // ---- AUTH ----
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const NOW = Math.floor(Date.now() / 1000);
    const IN_24_DAYS = NOW + 24 * 24 * 60 * 60;

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    let checked = 0;
    let eligible = 0;
    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions.data) {
      checked++;

      if (sub.current_period_end > IN_24_DAYS) continue;
      eligible++;

      const customer = sub.customer;
      if (!customer?.email) continue;

      // 🔒 TEST MODE — real data, safe inbox
      const TO_EMAIL = "olivkassen@gmail.com";

      const item = sub.items.data[0];
      const price = item.price;

      const intervalText =
        price.recurring.interval === "month" && price.recurring.interval_count === 1
          ? "varje månad"
          : price.recurring.interval === "month"
          ? `var ${price.recurring.interval_count} månad`
          : "återkommande";

      const variables = {
        name: customer.name || "vän",
        product_title: price.nickname || "Olivkassen prenumeration",
        price: (price.unit_amount / 100).toFixed(0),
        plan_interval: intervalText,
        renewal_date: new Date(sub.current_period_end * 1000)
          .toISOString()
          .split("T")[0],
        portal_url: "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
        logo_url:
          "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/67a38a8645686cca76b775ec_olivkassen-logo.svg",
      };

      try {
        await sgMail.send({
          to: TO_EMAIL,
          from: {
            email: "kontakt@olivkassen.com",
            name: "Olivkassen",
          },
          templateId: "d-fe01cb7634114535a27600e27d48c5d3",
          dynamicTemplateData: variables,
        });

        sent++;
      } catch (err) {
        console.error("SEND FAILED:", err.response?.body || err.message);
        failed++;
      }
    }

    return res.status(200).json({
      ok: true,
      checked,
      eligible,
      sent,
      failed,
      testMode: true,
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
