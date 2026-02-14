import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  try {
    const today = new Date();
    const todayISO = today.toISOString().split("T")[0];

    const testMode = process.env.TEST_MODE === "true";

    let renewals = [];
    let emailsSent = 0;

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      expand: ["data.customer", "data.items.data.price.product"],
    });

    for (const sub of subscriptions.data) {
      const renewalDate = new Date(sub.current_period_end * 1000);
      const renewalISO = renewalDate.toISOString().split("T")[0];

      if (renewalISO !== todayISO) continue;

      const customer = sub.customer;

      // -------------------------
      // FORCE CLEAN FIRST NAME
      // -------------------------
      const firstNameRaw = customer.name || "";
      const firstName =
        firstNameRaw
          .trim()
          .split(/\s+/)[0]
          .replace(/\s/g, "") || "Kund";

      // -------------------------
      // CLEAN PRODUCT TITLE
      // -------------------------
      const rawTitle =
        sub.items.data[0].price.product.name || "";

      const productTitle = rawTitle
        .split(/[-–—]/)[0]
        .trim();

      // -------------------------
      // PLAN INTERVAL (SWEDISH)
      // -------------------------
      const intervalCount =
        sub.items.data[0].price.recurring.interval_count;

      let planInterval = "";
      if (intervalCount === 1) {
        planInterval = "varje månad";
      } else if (intervalCount === 3) {
        planInterval = "var tredje månad";
      } else if (intervalCount === 6) {
        planInterval = "var sjätte månad";
      } else {
        planInterval = `var ${intervalCount}:e månad`;
      }

      // -------------------------
      // SWEDISH DATE FORMAT
      // -------------------------
      const renewalDateReadable =
        renewalDate.toLocaleDateString("sv-SE", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });

      // -------------------------
      // IDEMPOTENCY PROTECTION
      // -------------------------
      const metadataKey = `renewal_email_${todayISO}`;

      if (sub.metadata?.[metadataKey]) {
        continue; // already sent today
      }

      // -------------------------
      // SEND EMAIL
      // -------------------------
      const recipient = testMode
        ? process.env.TEST_EMAIL
        : customer.email;

      await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: recipient,
        subject: "Snart dags för nästa leverans",
        template: {
          id: process.env.RESEND_TEMPLATE_ID,
          variables: {
            name: firstName,
            product_title: productTitle,
            plan_interval: planInterval,
            renewal_date: renewalDateReadable,
            portal_url: process.env.PORTAL_LINK,
          },
        },
      });

      emailsSent++;
      renewals.push(`${firstName} (${customer.email})`);

      // Mark as sent
      await stripe.subscriptions.update(sub.id, {
        metadata: {
          ...sub.metadata,
          [metadataKey]: "sent",
        },
      });
    }

    return res.status(200).json({
      date: todayISO,
      renewals_found: renewals.length,
      emails_sent: emailsSent,
      test_mode: testMode,
      renewals,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
