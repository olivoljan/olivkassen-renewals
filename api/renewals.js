import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const TEST_MODE = true; // 🔒 SAFE MODE

function formatDateSwedish(dateString) {
  return new Date(dateString).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function cleanFirstName(fullName) {
  if (!fullName) return "kund";
  return fullName.trim().split(" ")[0];
}

function extractLiters(title) {
  const match = title?.match(/(\d+)\s*l/i);
  return match ? `${match[1]} liter` : title;
}

function translateInterval(intervalCount) {
  if (intervalCount === 1) return "varje månad";
  if (intervalCount === 3) return "var tredje månad";
  if (intervalCount === 6) return "var sjätte månad";
  return "enligt ditt valda intervall";
}

export default async function handler(req, res) {
  try {
    const today = new Date();
    const targetDate = new Date();
    targetDate.setDate(today.getDate() + 1);

    const targetDateISO = targetDate.toISOString().split("T")[0];

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      expand: [
        "data.customer",
        "data.items.data.price"
      ],
    });

    let renewalsFound = 0;
    let emailsSent = 0;
    let slackDetails = [];

    for (const sub of subscriptions.data) {
      const renewalDate = new Date(sub.current_period_end * 1000)
        .toISOString()
        .split("T")[0];

      if (renewalDate !== targetDateISO) continue;

      renewalsFound++;

      const customer = sub.customer;
      const email = customer.email;
      const firstName = cleanFirstName(customer.name);

      const price = sub.items.data[0].price;
      const intervalCount = price.recurring?.interval_count || 1;

      const productTitleRaw =
        typeof price.product === "object"
          ? price.product.name
          : price.nickname || "Olivolja";

      const productTitle = extractLiters(productTitleRaw);
      const planInterval = translateInterval(intervalCount);
      const formattedDate = formatDateSwedish(renewalDate);

      // 🔒 Idempotency key (unique per subscription + date)
      const idempotencyKey = `${sub.id}-${renewalDate}`;

      if (TEST_MODE) {
        await resend.emails.send(
          {
            from: "Olivkassen <renewals@olivkassen.com>",
            to: "olivkassen@gmail.com", // safe test inbox
            subject: "Snart dags för nästa leverans",
            template: {
              id: process.env.RESEND_TEMPLATE_ID,
              variables: {
                name: firstName,
                product_title: productTitle,
                plan_interval: planInterval,
                renewal_date: formattedDate,
              },
            },
          },
          {
            idempotencyKey,
          }
        );

        emailsSent++;
      }

      slackDetails.push(
        `• ${customer.name} (${email}) → ${renewalDate}`
      );
    }

    // ✅ SLACK RESTORED EXACTLY LIKE BEFORE
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

${slackDetails.length > 0 ? slackDetails.join("\n") : "No renewals today"}
`,
      }),
    });

    return res.status(200).json({
      date: today.toISOString().split("T")[0],
      target_date: targetDateISO,
      renewals_found: renewalsFound,
      emails_sent: emailsSent,
      test_mode: TEST_MODE,
    });
  } catch (error) {
    console.error("Renewal error:", error);
    return res.status(500).json({ error: error.message });
  }
}
