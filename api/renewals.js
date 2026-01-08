import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// 🔧 CONFIG — CHANGE THESE WHEN TESTING
const SOURCE_EMAIL = "ewa_nilsson@hotmail.com"; // 👈 customer to pull data from
const TO_EMAIL = "olivkassen@gmail.com";        // 👈 always send here (test)
const DAYS_AHEAD = 25;

export default async function handler(req, res) {
  try {
    // ---- AUTH ----
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const NOW = Math.floor(Date.now() / 1000);
    const CUTOFF = NOW + DAYS_AHEAD * 24 * 60 * 60;

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    let checked = 0;
    let sent = 0;

    for (const sub of subscriptions.data) {
      checked++;

      const customer = sub.customer;
      if (!customer?.email) continue;

      // 🎯 ONLY pull data for this customer
      if (customer.email !== SOURCE_EMAIL) continue;

      // optional: only upcoming renewals
      if (sub.current_period_end > CUTOFF) continue;

      const item = sub.items.data[0];
      const price = item.price;

      // Fetch product safely (no deep expand)
      const product = await stripe.products.retrieve(price.product);

      const intervalText =
        price.recurring.interval === "month" && price.recurring.interval_count === 1
          ? "varje månad"
          : price.recurring.interval === "month"
          ? `var ${price.recurring.interval_count}:e månad`
          : "återkommande";

      const variables = {
        name: customer.name || "vän",
        product_title: product.name,
        price: (price.unit_amount / 100).toFixed(0),
        plan_interval: intervalText,
        renewal_date: new Date(sub.current_period_end * 1000)
          .toISOString()
          .split("T")[0],
        portal_url: "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
        logo_url:
          "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png",
      };

      await sgMail.send({
        to: TO_EMAIL, // ✅ ALWAYS test inbox
        from: {
          email: "kontakt@olivkassen.com",
          name: "Olivkassen",
        },
        templateId: "d-fe01cb7634114535a27600e27d48c5d3",
        dynamicTemplateData: variables,
      });

      sent++;
    }

    return res.status(200).json({
      ok: true,
      checked,
      sent,
      sourceEmail: SOURCE_EMAIL,
      testRecipient: TO_EMAIL,
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
