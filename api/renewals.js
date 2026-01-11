import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const TEST_TO_EMAIL = "olivkassen@gmail.com";
const NOTICE_DAYS = 7;

export default async function handler(req, res) {
  try {
    // ---- AUTH ----
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { sourceEmail } = req.body || {};
    if (!sourceEmail) {
      return res.status(400).json({ error: "sourceEmail is required" });
    }

    // ---- FIND CUSTOMER BY EMAIL ----
    const customers = await stripe.customers.list({
      email: sourceEmail,
      limit: 1,
    });

    if (!customers.data.length) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const customer = customers.data[0];

    // ---- FETCH SUBSCRIPTIONS FOR THIS CUSTOMER ONLY ----
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      expand: ["data.items.data.price.product"],
      limit: 5,
    });

    if (!subs.data.length) {
      return res.status(200).json({
        ok: true,
        message: "No active subscriptions for customer",
        testMode: true,
      });
    }

    // Pick the active subscription closest to renewal
    const subscription = subs.data.sort(
      (a, b) => a.current_period_end - b.current_period_end
    )[0];

    const item = subscription.items.data[0];
    const price = item.price;
    const product = price.product;

    // ---- INTERVAL TEXT ----
    let intervalText = "återkommande";
    if (price.recurring?.interval === "month") {
      intervalText =
        price.recurring.interval_count === 1
          ? "varje månad"
          : `var ${price.recurring.interval_count}:e månad`;
    }

    // ---- REAL STRIPE RENEWAL DATE ----
    const renewalDate = new Date(
      subscription.current_period_end * 1000
    ).toISOString().split("T")[0];

    // ---- TEMPLATE VARIABLES ----
    const variables = {
      name: customer.name || "vän",
      product_title: product?.name || "Olivkassen prenumeration",
      price: (price.unit_amount / 100).toFixed(0),
      plan_interval: intervalText,
      renewal_date: renewalDate,
      portal_url: "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
      logo_url:
        "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png",
    };

    // ---- SEND (TEST SAFE) ----
    await sgMail.send({
      to: TEST_TO_EMAIL,
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
      sentTo: TEST_TO_EMAIL,
      renewalDate,
      intervalText,
      product: product?.name,
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
