import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// CONFIG
const TEST_RECIPIENT = "olivkassen@gmail.com";
const NOTICE_DAYS = 7;
const MAX_EMAILS_PER_RUN = 3; // hard abuse guard

export default async function handler(req, res) {
  try {
    /* ───────────────────────── AUTH GUARD ───────────────────────── */
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { sourceEmail, debug = false } = req.body || {};

    if (!sourceEmail) {
      return res.status(400).json({ error: "sourceEmail is required" });
    }

    /* ───────────────────── FIND CUSTOMER (SAFE) ─────────────────── */
    const customers = await stripe.customers.search({
      query: `email:'${sourceEmail}'`,
      limit: 1,
    });

    if (!customers.data.length) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const customer = customers.data[0];

    /* ───────────────── FETCH CUSTOMER SUBSCRIPTIONS ─────────────── */
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      expand: ["data.items.data.price"],
    });

    if (!subscriptions.data.length) {
      return res.status(200).json({
        ok: true,
        message: "No active subscriptions for customer",
        customer: debug ? customer : undefined,
      });
    }

    let sent = 0;
    let failed = 0;
    const debugPayload = [];

    for (const sub of subscriptions.data) {
      if (sent >= MAX_EMAILS_PER_RUN) break;

      const item = sub.items.data[0];
      const price = item.price;

      if (!price?.recurring) continue;

      /* ───────────── INTERVAL TEXT (svenska) ───────────── */
      let intervalText = "återkommande";
      if (price.recurring.interval === "month") {
        intervalText =
          price.recurring.interval_count === 1
            ? "varje månad"
            : `var ${price.recurring.interval_count}:e månad`;
      }

      /* ───────────── REAL STRIPE RENEWAL DATE ───────────── */
      const renewalDate = new Date(sub.current_period_end * 1000);
      const renewalDateISO = renewalDate.toISOString().split("T")[0];

      /* ───────────── PRODUCT NAME (CLEAN) ───────────── */
      const productName =
        price.nickname ||
        price.product?.name ||
        "Olivkassen prenumeration";

      const variables = {
        name: customer.name || "vän",
        product_title: productName,
        price: (price.unit_amount / 100).toFixed(0),
        plan_interval: intervalText,
        renewal_date: renewalDateISO,
        portal_url: "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
        logo_url:
          "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/67a38a8645686cca76b775ec_olivkassen-logo.svg",
      };

      if (debug) {
        debugPayload.push({
          customer: customer.email,
          subscriptionId: sub.id,
          renewalDate: renewalDateISO,
          intervalText,
          productName,
        });
      }

      try {
        await sgMail.send({
          to: TEST_RECIPIENT, // 🔒 always test inbox
          from: {
            email: "kontakt@olivkassen.com",
            name: "Olivkassen",
          },
          templateId: process.env.SENDGRID_TEMPLATE_ID,
          dynamicTemplateData: variables,
        });

        sent++;
      } catch (err) {
        console.error("SEND FAILED:", err.response?.body || err.message);
        failed++;
      }
    }

    /* ───────────────────── FINAL RESPONSE ───────────────────── */
    return res.status(200).json({
      ok: true,
      testMode: true,
      sourceCustomer: customer.email,
      subscriptionsFound: subscriptions.data.length,
      sent,
      failed,
      noticeDays: NOTICE_DAYS,
      debug: debug ? debugPayload : undefined,
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
