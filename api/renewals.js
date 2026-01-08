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

    // ---- FETCH SUBSCRIPTIONS ----
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: [
        "data.customer",
        "data.items.data.price",
        "data.items.data.price.product",
      ],
      limit: 100,
    });

    // ---- FILTER ELIGIBLE (NEXT 24 DAYS) ----
    const eligibleSubs = subscriptions.data.filter(
      (sub) =>
        sub.current_period_end <= IN_24_DAYS &&
        sub.customer &&
        sub.customer.email
    );

    if (eligibleSubs.length === 0) {
      return res.status(200).json({
        ok: true,
        checked: subscriptions.data.length,
        eligible: 0,
        sent: 0,
        reason: "No renewals within 24 days",
        testMode: true,
      });
    }

    // ---- PICK RANDOM REAL CUSTOMER ----
    const sub =
      eligibleSubs[Math.floor(Math.random() * eligibleSubs.length)];

    const customer = sub.customer;
    const item = sub.items.data[0];
    const price = item.price;
    const product = price.product;

    // ---- INTERVAL TEXT (NO 'återkommande') ----
    let intervalText = "";
    if (price.recurring?.interval === "month") {
      if (price.recurring.interval_count === 1) {
        intervalText = "varje månad";
      } else {
        intervalText = `var ${price.recurring.interval_count}:e månad`;
      }
    }

    // ---- CLEAN PRODUCT NAME ----
    const productTitle =
      product?.name || "Olivkassen prenumeration";

    // ---- TEST SAFE RECIPIENT ----
    const TO_EMAIL = "olivkassen@gmail.com";

    const variables = {
      name: customer.name || "vän",
      product_title: productTitle,
      price: (price.unit_amount / 100).toFixed(0),
      plan_interval: intervalText,
      renewal_date: new Date(sub.current_period_end * 1000)
        .toISOString()
        .split("T")[0],
      portal_url: "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
      logo_url:
        "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png",
    };

    // ---- SEND EMAIL ----
    await sgMail.send({
      to: TO_EMAIL,
      from: {
        email: "kontakt@olivkassen.com",
        name: "Olivkassen",
      },
      templateId: "d-fe01cb7634114535a27600e27d48c5d3",
      dynamicTemplateData: variables,
    });

    return res.status(200).json({
      ok: true,
      checked: subscriptions.data.length,
      eligible: eligibleSubs.length,
      sent: 1,
      testMode: true,
      sourceCustomer: customer.email,
      sentTo: TO_EMAIL,
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
