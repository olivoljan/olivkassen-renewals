import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export default async function handler(req, res) {
  try {
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

    // Only subs renewing within 24 days
    const eligibleSubs = subscriptions.data.filter(
      (sub) => sub.current_period_end <= IN_24_DAYS
    );

    if (!eligibleSubs.length) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    // 🎯 Pick ONE random real subscription
    const sub =
      eligibleSubs[Math.floor(Math.random() * eligibleSubs.length)];

    const customer = sub.customer;
    if (!customer?.email) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    const item = sub.items.data[0];
    const price = item.price;

    // 🔹 Fetch product safely (NO expand)
    const product = await stripe.products.retrieve(price.product);

    // Interval text (clean)
    let intervalText = "varje månad";
    if (price.recurring?.interval === "month") {
      intervalText =
        price.recurring.interval_count === 1
          ? "varje månad"
          : `var ${price.recurring.interval_count} månad`;
    }

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

    // 🔒 TEST SAFE — always send to you
    await sgMail.send({
      to: "cristina.coloman@gmail.com",
      from: {
        email: "kontakt@olivkassen.com",
        name: "Olivkassen",
      },
      templateId: "d-fe01cb7634114535a27600e27d48c5d3",
      dynamicTemplateData: variables,
    });

    return res.status(200).json({
      ok: true,
      testMode: true,
      sourceCustomer: customer.email,
      sentTo: "cristina.coloman@gmail.com",
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
