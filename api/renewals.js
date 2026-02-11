import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const resend = new Resend(process.env.RESEND_API_KEY);

const TEST_MODE = true;
const TEST_RECIPIENT = "olivkassen@gmail.com";
const NOTICE_DAYS = 7;
const MAX_EMAILS_PER_RUN = 20;

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

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const targetDate = new Date(today);
  targetDate.setDate(targetDate.getDate() + NOTICE_DAYS);

  const targetStart = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    7,
    0,
    0
  ).getTime() / 1000;

  const targetEnd = targetStart + 24 * 60 * 60;

  return { targetStart, targetEnd };
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { targetStart, targetEnd } = getTargetWindow();

  let eligible = 0;
  let sent = 0;
  let failed = 0;
  const preview = [];

  try {
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      // Skip paused subscriptions
      if (sub.pause_collection) continue;

      if (
        sub.current_period_end < targetStart ||
        sub.current_period_end >= targetEnd
      ) {
        continue;
      }

      eligible++;

      if (sent >= MAX_EMAILS_PER_RUN) break;

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

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toISOString().split("T")[0];

      preview.push(
        `• ${customer.email} | ${price.nickname || "Subscription"} | ${renewalDate} | ${intervalText}`
      );

      try {
        if (!TEST_MODE) {
          await resend.emails.send({
            from: "Olivkassen <kontakt@olivkassen.com>",
            to: customer.email,
            subject: "Your upcoming Olivkassen renewal",
            html: `
              <p>Hello ${customer.name || "friend"},</p>
              <p>Your subscription <strong>${price.nickname}</strong> will renew on <strong>${renewalDate}</strong>.</p>
              <p>If you need to update anything, visit your customer portal.</p>
              <p>Warm regards,<br/>Olivkassen</p>
            `,
          });
        } else {
          await resend.emails.send({
            from: "Olivkassen <kontakt@olivkassen.com>",
            to: TEST_RECIPIENT,
            subject: `[TEST] Renewal preview – ${customer.email}`,
            html: `
              <p>Customer: ${customer.email}</p>
              <p>Product: ${price.nickname}</p>
              <p>Renewal date: ${renewalDate}</p>
              <p>Interval: ${intervalText}</p>
            `,
          });
        }

        sent++;
      } catch (err) {
        console.error("EMAIL FAILED:", err);
        failed++;
      }
    }
  } catch (err) {
    console.error("RENEWAL ERROR:", err);
    return res.status(500).json({ error: err.message });
  }

  const dateStr = new Date().toISOString().split("T")[0];

  let slackMessage = `
Olivkassen – Daily Renewal Report (TEST)

Date: ${dateStr}
Renewals on target date: ${eligible}
Emails sent: ${sent}
Failed: ${failed}
`;

  if (preview.length > 0) {
    slackMessage += `\n---\n${preview.join("\n")}`;
  }

  await sendSlack(slackMessage);

  return res.status(200).json({
    ok: true,
    eligible,
    sent,
    failed,
    testMode: TEST_MODE,
  });
}
