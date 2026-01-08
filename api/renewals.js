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

    // OPTIONAL: pull data for one specific customer email
    const SOURCE_EMAIL = req.query.sourceEmail || null;

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: [
        "data.customer",
        "data.items.data.price",
        "data.items.data.price.product",
      ],
      limit: 100,
    });

    let checked = 0;
    let sent = 0;
    let skipped = 0;

    for (const sub of subscriptions.data) {
      checked++;

      const customer = sub.customer;
      if (!customer?.email) {
        skipped++;
        continue;
      }

      // 🎯 Only test one real customer if sourceEmail is provided
      if (SOURCE_EMAIL && customer.email !== SOURCE_EMAIL) {
        skipped++;
        continue;
      }

      const item = sub.items.data[0];
      const price = item.price;
      const product = price.product;

      const intervalText =
        price.recurring.interval === "month" &&
        price.recurring.interval_count === 1
          ? "varje månad"
          : price.recurring.interval === "month"
          ? `var ${price.recurring.interval_count} månad`
          : "återkommande";

      const variables = {
        name: customer.name || "vän",
        product_title:
          product?.name ||
          price?.nickname ||
          price?.description ||
          "Olivkassen prenumeration",
        price: (price.unit_amount / 100).toFixed(0),
        plan_interval: intervalText,
        renewal_date: new Date(sub.current_period_end * 1000)
          .toISOString()
          .split("T")[0],
        portal_url: "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
        logo_url:
          "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png",
      };

      // 🔒 TEST MODE — ALWAYS send to test inbox
      await sgMail.send({
        to: "olivkassen@gmail.com",
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
      skipped,
      testMode: true,
      sourceEmail: SOURCE_EMAIL || "ALL",
      testRecipient: "olivkassen@gmail.com",
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
