import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/* ================= CONFIG ================= */

const TEST_MODE = true; // 🔒 пока true — письма только тебе
const TEST_RECIPIENT = "olivkassen@gmail.com";

const NOTICE_DAYS = 7;
const MAX_EMAILS_PER_RUN = 50;

/* ========================================== */

async function sendSlack(message) {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

export default async function handler(req, res) {
  const startedAt = new Date();

  let eligible = 0;
  let sent = 0;
  let failed = 0;
  let fatalError = null;

  const debugItems = [];

  try {
    /* ========= AUTH GUARD ========= */
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const NOW = Math.floor(Date.now() / 1000);
    const WINDOW_END = NOW + NOTICE_DAYS * 24 * 60 * 60;

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      /* --- STRICT FILTERS --- */

      // Skip if paused
      if (sub.pause_collection) continue;

      // Skip canceling
      if (sub.cancel_at_period_end) continue;

      // Must renew within 7 days
      if (sub.current_period_end > WINDOW_END) continue;

      eligible++;

      if (sent >= MAX_EMAILS_PER_RUN) break;

      const customer = sub.customer;
      if (!customer?.email) continue;

      const item = sub.items.data[0];
      const price = item.price;

      /* --- INTERVAL TEXT --- */
      let intervalText = "subscription";

      if (price.recurring?.interval === "month") {
        intervalText =
          price.recurring.interval_count === 1
            ? "every month"
            : `every ${price.recurring.interval_count} months`;
      }

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toISOString().split("T")[0];

      debugItems.push({
        email: customer.email,
        product: price.nickname || "Subscription",
        renewal: renewalDate,
        interval: intervalText,
      });

      const variables = {
        name: customer.name || "there",
        product_title: price.nickname || "Olivkassen subscription",
        plan_interval: intervalText,
        renewal_date: renewalDate,
        portal_url:
          "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
        logo_url:
          "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png",
      };

      try {
        await sgMail.send({
          to: TEST_MODE ? TEST_RECIPIENT : customer.email,
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
  } catch (err) {
    fatalError = err;
    console.error("RENEWALS ERROR:", err);
  }

  /* ================= SLACK REPORT ================= */

  const dateStr = new Date().toISOString().split("T")[0];

  let statusLine = "All good";

  if (fatalError) statusLine = "CRITICAL ERROR – execution failed";
  else if (failed > 0) statusLine = "Some emails failed";
  else if (eligible > 0 && sent === 0)
    statusLine = "Renewals found but none sent";
  else if (eligible === 0)
    statusLine = "No renewals today";

  const details =
    debugItems.length > 0
      ? "\n---\n" +
        debugItems
          .map(
            (i) =>
              `• ${i.email} | ${i.product} | ${i.renewal} | ${i.interval}`
          )
          .join("\n")
      : "";

  await sendSlack(`
Olivkassen – Daily Renewal Report (TEST)

Date: ${dateStr}
Renewals within ${NOTICE_DAYS} days: ${eligible}
Emails sent: ${sent}
Failed: ${failed}

${statusLine}
${details}
  `);

  if (fatalError) {
    return res.status(500).json({ error: fatalError.message });
  }

  return res.status(200).json({
    ok: true,
    eligible,
    sent,
    failed,
    testMode: TEST_MODE,
  });
}
