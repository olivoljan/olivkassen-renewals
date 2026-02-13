import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const TEST_MODE = true;
const TEST_EMAIL = "olivkassen@gmail.com";
const NOTICE_DAYS = 7;

/**
 * Format Stripe timestamp to ISO date (YYYY-MM-DD)
 */
const formatDateISO = (timestamp) =>
  new Date(timestamp * 1000).toISOString().split("T")[0];

/**
 * Format ISO date to Swedish readable format
 * Example: 20 februari 2026
 */
const formatDateReadable = (isoDate) => {
  const date = new Date(isoDate);

  return date.toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

/**
 * Idempotency protection:
 * Prevents sending twice same day for same subscription
 */
const alreadySentToday = (subscription, todayISO) => {
  const lastSent = subscription.metadata?.renewal_notice_sent;
  return lastSent === todayISO;
};

async function markAsSent(subscriptionId, todayISO) {
  await stripe.subscriptions.update(subscriptionId, {
    metadata: {
      renewal_notice_sent: todayISO,
    },
  });
}

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
    const todayISO = today.toISOString().split("T")[0];

    const targetDateObj = new Date();
    targetDateObj.setUTCDate(today.getUTCDate() + NOTICE_DAYS);

    const targetDate = targetDateObj.toISOString().split("T")[0];

    let renewals = [];
    let startingAfter = null;

    // Pagination
    while (true) {
      const subscriptions = await stripe.subscriptions.list({
        status: "active",
        limit: 100,
        starting_after: startingAfter || undefined,
      });

      for (const subscription of subscriptions.data) {
        if (subscription.pause_collection) continue;
        if (subscription.cancel_at_period_end) continue;

        if (alreadySentToday(subscription, todayISO)) continue;

        let upcomingInvoice;

        try {
          upcomingInvoice = await stripe.invoices.retrieveUpcoming({
            subscription: subscription.id,
          });
        } catch {
          continue;
        }

        if (!upcomingInvoice?.period_end) continue;

        const invoiceDate = formatDateISO(upcomingInvoice.period_end);

        if (invoiceDate === targetDate) {
          renewals.push({
            subscription,
            customerId: subscription.customer,
            invoiceDate,
          });
        }
      }

      if (!subscriptions.has_more) break;

      startingAfter =
        subscriptions.data[subscriptions.data.length - 1].id;
    }

    let emailsSent = 0;
    let slackDetails = [];

    for (const renewal of renewals) {
      const subscription = renewal.subscription;

      const customer = await stripe.customers.retrieve(
        renewal.customerId
      );

      if (!customer?.email) continue;

      const recipient = TEST_MODE ? TEST_EMAIL : customer.email;

      /**
       * Clean product title
       * "3 liter – var 3:e månad" → "3 liter"
       */
      const rawTitle =
        subscription.items.data[0]?.price?.nickname ||
        "Olivkassen";

      const productTitle =
        rawTitle.split("–")[0].trim();

      /**
       * Swedish delivery interval
       */
      const intervalCount =
        subscription.items.data[0]?.price?.recurring
          ?.interval_count || 1;

      let planInterval = "varje månad";

      if (intervalCount === 3)
        planInterval = "var tredje månad";

      if (intervalCount === 6)
        planInterval = "var sjätte månad";

      /**
       * Swedish readable date
       */
      const renewalDateReadable =
        formatDateReadable(renewal.invoiceDate);

      const portalUrl =
        "https://olivkassen.com/mina-sidor";

      const name =
        customer.name?.trim() || "Kund";

      await resend.emails.send({
        from: "Olivkassen <renewals@olivkassen.com>",
        to: recipient,
        subject: `Snart dags för nästa leverans`,
        template: {
          id: process.env.RESEND_TEMPLATE_ID,
          variables: {
            name,
            product_title: productTitle,
            plan_interval: planInterval,
            renewal_date: renewalDateReadable,
            portal_url: portalUrl,
          },
        },
      });

      await markAsSent(subscription.id, todayISO);

      slackDetails.push(
        `• ${name} (${customer.email}) → ${renewal.invoiceDate}`
      );

      emailsSent++;
    }

    await sendSlack(`
Olivkassen Renewal Report

Date: ${todayISO}
Target renewal date: ${targetDate}
Renewals found: ${renewals.length}
Emails sent: ${emailsSent}
Test mode: ${TEST_MODE ? "YES" : "NO"}

${
  slackDetails.length
    ? slackDetails.join("\n")
    : "No renewals today"
}
`);

    return res.status(200).json({
      date: todayISO,
      target_date: targetDate,
      renewals_found: renewals.length,
      emails_sent: emailsSent,
      test_mode: TEST_MODE,
    });
  } catch (error) {
    console.error("RENEWAL ERROR:", error);

    await sendSlack(
      `🚨 Renewal job crashed: ${error.message}`
    );

    return res.status(500).json({
      error: "Renewal job failed",
    });
  }
}
