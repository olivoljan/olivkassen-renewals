import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const resend = new Resend(process.env.RESEND_API_KEY);

/* ==============================
   CONFIG
============================== */

const NOTICE_DAYS = 7;
const TEST_MODE = true; // keep TRUE for now
const TEST_RECIPIENT = "olivkassen@gmail.com";
const MAX_EMAILS_PER_RUN = 50;

/* ==============================
   SLACK
============================== */

async function sendSlack(message) {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

/* ==============================
   DATE WINDOW (Stockholm Safe)
============================== */

function getTargetWindow() {
  const now = new Date();

  // Convert to Stockholm time
  const stockholmNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Stockholm" })
  );

  // Add 7 days
  stockholmNow.setDate(stockholmNow.getDate() + NOTICE_DAYS);

  // Start 07:00 Stockholm
  const startStockholm = new Date(
    stockholmNow.getFullYear(),
    stockholmNow.getMonth(),
    stockholmNow.getDate(),
    7, 0, 0
  );

  // End 23:59 Stockholm
  const endStockholm = new Date(
    stockholmNow.getFullYear(),
    stockholmNow.getMonth(),
    stockholmNow.getDate(),
    23, 59, 59
  );

  // Convert back to UTC
  const startUTC = Math.floor(
    new Date(startStockholm.toLocaleString("en-US", { timeZone: "UTC" })).getTime() / 1000
  );

  const endUTC = Math.floor(
    new Date(endStockholm.toLocaleString("en-US", { timeZone: "UTC" })).getTime() / 1000
  );

  // ±1 hour tolerance
  return {
    start: startUTC - 3600,
    end: endUTC + 3600,
  };
}

/* ==============================
   MAIN HANDLER
============================== */

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const startedAt = new Date();
  const dateStr = startedAt.toLocaleDateString("sv-SE");

  let eligible = 0;
  let sent = 0;
  let failed = 0;
  let previewLines = [];

  const { start: START_WINDOW, end: END_WINDOW } = getTargetWindow();

  try {
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      if (sent >= MAX_EMAILS_PER_RUN) break;

      // Skip if canceled at period end
      if (sub.cancel_at_period_end) continue;

      // Skip if paused
      if (sub.pause_collection) continue;

      // Must be inside exact target window
      if (
        sub.current_period_end < START_WINDOW ||
        sub.current_period_end > END_WINDOW
      ) {
        continue;
      }

      eligible++;

      const customer = sub.customer;
      if (!customer?.email) continue;

      const item = sub.items.data[0];
      const price = item.price;

      // Interval text
      let intervalText = "recurring";
      if (price.recurring?.interval === "month") {
        intervalText =
          price.recurring.interval_count === 1
            ? "every month"
            : `every ${price.recurring.interval_count} months`;
      }

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

      const templateData = {
        name: customer.name || "",
        product_title: price.nickname || "Olivkassen subscription",
        plan_interval: intervalText,
        renewal_date: renewalDate,
        portal_url: process.env.PORTAL_LINK,
      };

      previewLines.push(
        `• ${customer.email} | ${templateData.product_title} | ${renewalDate}`
      );

      try {
        await resend.emails.send({
          from: "Olivkassen <renewals@olivkassen.com>",
          to: TEST_MODE ? TEST_RECIPIENT : customer.email,
          subject: `Din olivoljeleverans kommer snart – ${renewalDate}`,
          html: undefined, // using template
          template: process.env.RESEND_TEMPLATE_ID,
          template_data: templateData,
        });

        sent++;
      } catch (err) {
        console.error("SEND FAILED:", err.message);
        failed++;
      }
    }
  } catch (err) {
    console.error("CRITICAL ERROR:", err);
    await sendSlack(`🚨 Renewal system crashed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }

  /* ==============================
     SLACK REPORT
  ============================== */

  let statusLine = "All good";
  if (failed > 0) statusLine = "Some emails failed";
  if (eligible > 0 && sent === 0) statusLine = "Renewals found but none sent";
  if (eligible === 0) statusLine = "No renewals";

  const slackMessage = `
Olivkassen – Daily Renewal Report (${TEST_MODE ? "TEST" : "LIVE"})

Date: ${dateStr}
Renewals exactly in ${NOTICE_DAYS} days: ${eligible}
Emails sent: ${sent}
Failed: ${failed}

---
${previewLines.length ? previewLines.join("\n") : "No renewals"}

${statusLine}
`;

  await sendSlack(slackMessage);

  return res.status(200).json({
    ok: true,
    eligible,
    sent,
    failed,
  });
}
