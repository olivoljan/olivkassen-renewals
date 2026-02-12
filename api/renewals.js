import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const TEST_MODE = true; // switch to false in production

const formatDateUTC = (timestamp) => {
  return new Date(timestamp * 1000).toISOString().split("T")[0];
};

export default async function handler(req, res) {
  try {
    const today = new Date();
    const target = new Date();
    target.setUTCDate(today.getUTCDate() + 7);
    const targetDate = target.toISOString().split("T")[0];

    let renewals = [];
    let startingAfter = null;

    // Paginate subscriptions
    while (true) {
      const subscriptions = await stripe.subscriptions.list({
        status: "active",
        limit: 100,
        starting_after: startingAfter || undefined,
      });

      for (const sub of subscriptions.data) {
        // Exclude paused
        if (sub.pause_collection) continue;

        // Exclude cancel at period end
        if (sub.cancel_at_period_end) continue;

        // Get upcoming invoice
        let upcoming;
        try {
          upcoming = await stripe.invoices.retrieveUpcoming({
            subscription: sub.id,
          });
        } catch {
          continue; // no upcoming invoice
        }

        if (!upcoming || !upcoming.next_payment_attempt) continue;

        const invoiceDate = formatDateUTC(upcoming.next_payment_attempt);

        if (invoiceDate === targetDate) {
          renewals.push({
            subscriptionId: sub.id,
            customerId: sub.customer,
            invoiceDate,
          });
        }
      }

      if (!subscriptions.has_more) break;
      startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
    }

    let sent = 0;

    for (const renewal of renewals) {
      const customer = await stripe.customers.retrieve(renewal.customerId);
      if (!customer.email) continue;

      if (!TEST_MODE) {
        await resend.emails.send({
          from: "Olivkassen <renewals@olivkassen.com>",
          to: customer.email,
          subject: "Snart dags för nästa leverans",
          template_id: process.env.RESEND_TEMPLATE_ID,
          variables: {
            name: customer.name || "",
            renewal_date: renewal.invoiceDate,
          },
        });
      }

      sent++;
    }

    res.status(200).json({
      date: today.toISOString().split("T")[0],
      target_date: targetDate,
      renewals_found: renewals.length,
      emails_sent: TEST_MODE ? 0 : sent,
      test_mode: TEST_MODE,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Renewal job failed" });
  }
}
