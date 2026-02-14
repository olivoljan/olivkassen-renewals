import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const TEST_MODE = true; // ✅ KEEP TRUE UNTIL LIVE

function formatSwedishDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function getFirstName(fullName) {
  if (!fullName) return "Kund";
  return fullName.trim().split(" ")[0];
}

function extractLiters(productName) {
  if (!productName) return "";
  const match = productName.match(/\d+/);
  return match ? `${match[0]} liter` : productName;
}

export default async function handler(req, res) {
  try {
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + 7);

    const targetDateISO = targetDate.toISOString().split("T")[0];

    let renewalsFound = 0;
    let emailsSent = 0;
    const slackDetails = [];

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      expand: ["data.customer", "data.items.data.price"], // ✅ SAFE EXPAND
    });

    for (const sub of subscriptions.data) {
      const renewalDate = new Date(sub.current_period_end * 1000);
      const renewalISO = renewalDate.toISOString().split("T")[0];

      if (renewalISO !== targetDateISO) continue;

      renewalsFound++;

      const customer = sub.customer;
      const firstName = getFirstName(customer?.name);
      const recipient = TEST_MODE
        ? "olivkassen@gmail.com"
        : customer?.email;

      if (!recipient) continue;

      const price = sub.items.data[0].price;

      // ✅ SAFE PRODUCT FETCH (NO DEEP EXPAND)
      const product =
        typeof price.product === "string"
          ? await stripe.products.retrieve(price.product)
          : price.product;

      const rawTitle = product?.name || "";
      const productTitle = extractLiters(rawTitle);

      const formattedDate = formatSwedishDate(renewalDate);

      const idempotencyKey = `renewal-${sub.id}-${targetDateISO}`;

      await resend.emails.send(
        {
          from: "Olivkassen <renewals@olivkassen.com>",
          to: recipient,
          subject: "Snart dags för nästa leverans",
          template: {
            id: process.env.RESEND_TEMPLATE_ID,
            variables: {
              name: firstName,
              product_title: productTitle,
              renewal_date: formattedDate,
              portal_url: process.env.PORTAL_LINK,
            },
          },
        },
        {
          idempotencyKey,
        }
      );

      emailsSent++;

      slackDetails.push(
        `• ${customer?.name || "No name"} (${customer?.email}) → ${renewalISO}`
      );
    }

    // Slack report
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Olivkassen Renewal Report

Date: ${today.toISOString().split("T")[0]}
Target renewal date: ${targetDateISO}
Renewals found: ${renewalsFound}
Emails sent: ${emailsSent}
Test mode: ${TEST_MODE ? "YES" : "NO"}

${slackDetails.length ? slackDetails.join("\n") : "No renewals today"}
`,
      }),
    });

    return res.status(200).json({
      success: true,
      renewalsFound,
      emailsSent,
      testMode: TEST_MODE,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
