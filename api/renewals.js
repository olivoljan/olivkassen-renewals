import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const resend = new Resend(process.env.RESEND_API_KEY);

// ===============================
// CONFIG
// ===============================

const NOTICE_DAYS = 7;
const TEST_MODE = true; // 🔒 keep TRUE for now
const TEST_RECIPIENT = "olivkassen@gmail.com";
const MAX_EMAILS_PER_RUN = 50;

// ===============================
// SLACK HELPER
// ===============================

async function sendSlack(message) {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

// ===============================
// DATE HELPERS (SWEDEN SAFE)
// ===============================

function toSwedenDateString(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString("sv-SE", {
    timeZone: "Europe/Stockholm",
  });
}

function todayPlusDaysSweden(days) {
  const now = new Date();
  const swedenNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Stockholm" })
  );
  swedenNow.setDate(swedenNow.getDate() + days);

  return swedenNow.toLocaleDateString("sv-SE");
}

// ===============================
// MAIN HANDLER
// ===============================

export default async function handler(req, res) {
  let eligible = 0;
  let sent = 0;
  let failed = 0;
  const previewLines = [];

  try {
    // ===============================
    // CRON AUTH GUARD
    // ===============================
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const targetDateStr = todayPlusDaysSweden(NOTICE_DAYS);

    // ===============================
    // FETCH ACTIVE SUBSCRIPTIONS
    // ===============================
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      if (sent >= MAX_EMAILS_PER_RUN) break;

      // Skip paused subscriptions
      if (sub.pause_collection) continue;

      const renewalDateStr = toSwedenDateString(sub.current_period_end);

      // 🔥 Exact +7 days match
      if (renewalDateStr !== targetDateStr) continue;

      eligible++;

      const customer = sub.customer;
      if (!customer?.email) continue;

      const item = sub.items.data[0];
      const price = item.price;

      let intervalText = "recurring";
      if (price.recurring?.interval === "month") {
        intervalText =
          price.recurring.interval_count === 1
            ? "every month"
            : `every ${price.recurring.interval_count} months`;
      }

      const variables = {
        name: customer.name || "",
        product_title: price.nickname || "Olivkassen subscription",
        plan_interval: intervalText,
        renewal_date: renewalDateStr,
        portal_url: process.env.PORTAL_LINK,
      };

      previewLines.push(
        `• ${customer.email} | ${variables.product_title} | ${renewalDateStr} | ${intervalText}`
      );

      try {
        await resend.emails.send({
          from: "Olivkassen <renewals@olivkassen.com>",
          to: TEST_MODE ? TEST_RECIPIENT : customer.email,
          subject:
            TEST_MODE
              ? `[TEST] Snart dags för nästa leverans – ${renewalDateStr}`
              : `Snart dags för nästa leverans – ${renewalDateStr}`,
          template: process.env.RESEND_TEMPLATE_ID,
          templateData: variables,
        });

        sent++;
      } catch (err) {
        console.error("SEND FAILED:", err);
        failed++;
      }
    }
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }

  // ===============================
  // SLACK REPORT
  // ===============================

  const dateStr = new Date().toLocaleDateString("sv-SE");

  let statusLine = "All good";
  if (failed > 0) statusLine = "Some emails failed";
  if (eligible === 0) statusLine = "No renewals";

  await sendSlack(`
Olivkassen – Daily Renewal Report (${TEST_MODE ? "TEST" : "LIVE"})

Date: ${dateStr}
Renewals exactly in ${NOTICE_DAYS} days: ${eligible}
Emails sent: ${sent}
Failed: ${failed}

---

${previewLines.length ? previewLines.join("\n") : "No renewals"}

${statusLine}
  `);

  return res.status(200).json({
    ok: true,
    eligible,
    sent,
    failed,
  });
}
