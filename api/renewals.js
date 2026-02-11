import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const resend = new Resend(process.env.RESEND_API_KEY);

const NOTICE_DAYS = 7;
const TARGET_HOUR = 7; // 07:00 local time
const MAX_EMAILS_PER_RUN = 50;

const TEST_MODE = true; // 🔒 keep true for now
const TEST_RECIPIENT = "olivkassen@gmail.com";

async function sendSlack(message) {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

function getTargetWindow() {
  const now = new Date();

  const target = new Date();
  target.setDate(now.getDate() + NOTICE_DAYS);
  target.setHours(TARGET_HOUR, 0, 0, 0);

  const start = Math.floor(target.getTime() / 1000);
  const end = start + 86400;

  return { start, end };
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { start, end } = getTargetWindow();

  let eligible = 0;
  let sent = 0;
  let failed = 0;
  let previewLines = [];

  try {
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      if (
        sub.current_period_end < start ||
        sub.current_period_end >= end
      ) {
        continue;
      }

      eligible++;

      const customer = sub.customer;
      if (!customer?.email) continue;

      const item = sub.items.data[0];
      const price = item.price;

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toISOString().split("T")[0];

      let intervalText = "recurring";

      if (price.recurring?.interval === "month") {
        intervalText =
          price.recurring.interval_count === 1
            ? "every month"
            : `every ${price.recurring.interval_count} months`;
      }

      previewLines.push(
        `• ${customer.email} | ${price.nickname || "Subscription"} | ${renewalDate}`
      );

      if (sent >= MAX_EMAILS_PER_RUN) break;

      try {
        await resend.emails.send({
          from: "Olivkassen <renewals@olivkassen.com>",
          to: TEST_MODE ? TEST_RECIPIENT : customer.email,
          subject:
            "Din olivoljeabonnemang levereras snart",
          templateId: process.env.RESEND_TEMPLATE_ID,
          dynamicTemplateData: {
            name: customer.name || "vän",
            product_title:
              price.nickname || "Olivkassen prenumeration",
            plan_interval: intervalText,
            renewal_date: renewalDate,
            portal_url: process.env.PORTAL_LINK,
          },
        });

        sent++;
      } catch (err) {
        console.error("RESEND ERROR:", err);
        failed++;
      }
    }

    const dateStr = new Date().toISOString().split("T")[0];

    await sendSlack(`
*Olivkassen – Daily Renewal Report (TEST)*

Date: ${dateStr}
Renewals exactly in ${NOTICE_DAYS} days: ${eligible}
Emails sent: ${sent}
Failed: ${failed}

---
${previewLines.length ? previewLines.join("\n") : "No renewals"}
`);

    return res.status(200).json({
      ok: true,
      eligible,
      sent,
      failed,
    });
  } catch (err) {
    console.error("FATAL ERROR:", err);

    await sendSlack(
      "🚨 Renewal system crashed. Check Vercel logs."
    );

    return res.status(500).json({ error: err.message });
  }
}
