import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const TEST_MODE = true; // KEEP TRUE during testing
const TEST_EMAIL = "olivkassen@gmail.com";
const NOTICE_DAYS = 0; // change to 0 for today testing

const formatDateUTC = (timestamp) =>
  new Date(timestamp * 1000).toISOString().split("T")[0];

async function sendSlack(message) {
  if (!process.env.SLACK_WEBHOOK_URL) return;
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

export default async function handler(req, res) {
  try {
    const today = new Date();
    const target = new Date();
    target.setUTCDate(today.getUTCDate() + NOTICE_DAYS);
    const targetDate = target.toISOString().split("T")[0];

    let renewals = [];
    let startingAfter = null;

    while (true) {
      const subscriptions = await stripe.subscriptions.list({
        status: "active",
        limit: 100,
        starting_after: startingAfter || undefined,
      });

      for (const sub of subscriptions.data) {
        if (sub.pause_collection) continue;
        if (sub.cancel_at_period_end) continue;

        let upcoming;
        try {
          upcoming = await stripe.invoices.retrieveUpcoming({
            subscription: sub.id,
          });
        } catch {
          continue;
        }

        if (!upcoming?.period_end) continue;

        const invoiceDate = formatDateUTC(upcoming.period_end);

        if (invoiceDate === targetDate) {
          renewals.push({
            subscriptionId: sub.id,
            customerId: sub.customer,
            invoiceDate,
          });
        }
      }

      if (!subscriptions.has_more) break;
      startingAfter =
        subscriptions.data[subscriptions.data.length - 1].id;
    }

    let sent = 0;
    let slackDetails = [];

    for (const renewal of renewals) {
      const customer = await stripe.customers.retrieve(
        renewal.customerId
      );
      if (!customer?.email) continue;

      const recipient = TEST_MODE ? TEST_EMAIL : customer.email;

      await resend.emails.send({
        from: "Olivkassen <renewals@olivkassen.com>",
        to: recipient,
        subject: "Snart dags för nästa leverans",
        template_id: process.env.RESEND_TEMPLATE_ID,
        variables: {
          name: customer.name || "",
          renewal_date: renewal.invoiceDate,
        },
      });

      slackDetails.push(
        `• ${customer.name || "No name"} (${customer.email}) → ${renewal.invoiceDate}`
      );

      sent++;
    }

    // Always send Slack report
    await sendSlack(`
🫒 Olivkassen Renewal Report

Date: ${formatDateUTC(Date.now() / 1000)}
Target renewal date: ${targetDate}
Renewals found: ${renewals.length}
Emails sent: ${sent}
Test mode: ${TEST_MODE ? "YES" : "NO"}

${slackDetails.length ? slackDetails.join("\n") : "No renewals today"}
`);

    return res.status(200).json({
      date: formatDateUTC(Date.now() / 1000),
      target_date: targetDate,
      renewals_found: renewals.length,
      emails_sent: sent,
      test_mode: TEST_MODE,
    });
  } catch (err) {
    console.error("RENEWAL ERROR:", err);
    await sendSlack(`🚨 Renewal job crashed: ${err.message}`);
    return res.status(500).json({ error: "Renewal job failed" });
  }
}
