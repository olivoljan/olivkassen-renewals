import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const TEST_RECIPIENT = "olivkassen@gmail.com";
const NOTICE_DAYS = 7;

export default async function handler(req, res) {
  try {
    /* ------------------ HARD GUARD ------------------ */
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { sourceEmail, debug = false } = req.body || {};

    /* ------------------ FIND CUSTOMER ------------------ */
    let customer = null;

    if (sourceEmail) {
      const customers = await stripe.customers.search({
        query: `email:"${sourceEmail}"`,
        limit: 1,
      });

      customer = customers.data[0];
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
    }

    /* ------------------ FETCH SUBSCRIPTIONS ------------------ */
    const subs = await stripe.subscriptions.list({
      customer: customer?.id,
      status: "active",
      expand: ["data.items.data.price"],
      limit: 10,
    });

    if (!subs.data.length) {
      return res.status(200).json({
        ok: true,
        message: "No active subscriptions",
        customer: sourceEmail,
      });
    }

    /* ------------------ PROCESS FIRST SUB (TEST MODE) ------------------ */
    const sub = subs.data[0];
    const item = sub.items.data[0];
    const price = item.price;

    const productName =
      price.nickname ||
      price.metadata?.name ||
      "Olivkassen prenumeration";

    /* ---- Interval text ---- */
    let intervalText = "återkommande";
    if (price.recurring?.interval === "month") {
      intervalText =
        price.recurring.interval_count === 1
          ? "varje månad"
          : `var ${price.recurring.interval_count}:e månad`;
    }

    /* ---- REAL renewal date from Stripe ---- */
    const renewalDate = new Date(sub.current_period_end * 1000)
      .toISOString()
      .split("T")[0];

    const variables = {
      name: customer.name || "vän",
      product_title: productName,
      price: (price.unit_amount / 100).toFixed(0),
      plan_interval: intervalText,
      renewal_date: renewalDate,
      portal_url: "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
      logo_url:
        "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png",
    };

    /* ------------------ SEND (TEST SAFE) ------------------ */
    await sgMail.send({
      to: TEST_RECIPIENT,
      from: {
        email: "kontakt@olivkassen.com",
        name: "Olivkassen",
      },
      templateId: "d-fe01cb7634114535a27600e27d48c5d3",
      dynamicTemplateData: variables,
    });

    /* ------------------ RESPONSE ------------------ */
    return res.status(200).json({
      ok: true,
      testMode: true,
      sentTo: TEST_RECIPIENT,
      sourceCustomer: customer.email,
      subscriptionId: sub.id,
      renewalDate,
      intervalText,
      productName,
      ...(debug && {
        debug: {
          customerId: customer.id,
          subscriptionsFound: subs.data.length,
          priceId: price.id,
        },
      }),
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
