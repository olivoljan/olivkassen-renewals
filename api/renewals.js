import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const TEST_MODE = true;
const TEST_RECIPIENT = "olivkassen@gmail.com";

const NOTICE_DAYS = 7;
const MAX_EMAILS_PER_RUN = 50;

/* ---------------- SLACK ---------------- */

async function sendSlack(message) {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

/* -------------- DATE HELPERS -------------- */

// Convert unix timestamp -> Stockholm date string (YYYY-MM-DD)
function toStockholmDateString(unix) {
  return new Date(unix * 1000).toLocaleDateString("sv-SE", {
    timeZone: "Europe/Stockholm",
  });
}

// Get today's Stockholm date string
function todayStockholm() {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Europe/Stockholm",
  });
}

// Add N days to Stockholm date
function addDaysStockholm(days) {
  const now = new Date();
  const stockholmNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Stockholm" })
  );
  stockholmNow.setDate(stockholmNow.getDate() + days);

  return stockholmNow.toLocaleDateString("sv-SE");
}

/* -------------- MAIN HANDLER -------------- */

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const today = todayStockholm();
  const targetDate = addDaysStockholm(NOTICE_DAYS);

  let eligible = 0;
  let sent = 0;
  let failed = 0;

  const matchedSubscriptions = [];

  try {
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      // Skip paused
      if (sub.pause_collection) continue;

      const renewalDate = toStockholmDateString(sub.current_period_end);

      // EXACT DATE MATCH (calendar based)
      if (renewalDate !== targetDate) continue;

      eligible++;

      const customer = sub.customer;
      if (!customer?.email) continue;

      const item = sub.items.data[0];
      const price = item.price;

      const intervalText =
        price.recurring?.interval === "month"
          ? `every ${price.recurring.interval_count} month(s)`
          : price.recurring?.interval;

      matchedSubscriptions.push(
        `• ${customer.email} | ${price.nickname || "Subscription"} | ${renewalDate} | ${intervalText}`
      );

      if (sent >= MAX_EMAILS_PER_RUN) continue;

      try {
        // TEST MODE: do not send to real customer
        if (TEST_MODE) {
          console.log("TEST MODE — email skipped for:", customer.email);
        } else {
          // Email logic will be inserted here (Resend later)
        }

        sent++;
      } catch (err) {
        console.error("SEND FAILED:", err.message);
        failed++;
      }
    }

    /* -------- SLACK REPORT -------- */

    let previewBlock =
      matchedSubscriptions.length > 0
        ? matchedSubscriptions.join("\n")
        : "No renewals";

    await sendSlack(`
🫒 *Olivkassen – Daily Renewal Report (TEST)*

Date: ${today}
Renewals exactly in ${NOTICE_DAYS} days: ${eligible}
Emails sent: ${sent}
Failed: ${failed}

---
${previewBlock}
`);

    return res.status(200).json({
      ok: true,
      targetDate,
      eligible,
      sent,
      failed,
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    await sendSlack("🚨 Renewal function crashed.");
    return res.status(500).json({ error: err.message });
  }
}
