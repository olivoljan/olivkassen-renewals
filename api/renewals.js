import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

/*
PRODUCTION CONTROLS
*/
const TEST_MODE = true;        // true = send to test inbox only
const DRY_RUN = false;          // true = no emails sent at all
const MAX_EMAILS_PER_RUN = 25;  // safety cap

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
    targetDate.setDate(today.getDate() + 7);

    const targetDateISO = targetDate.toISOString().split("T")[0];

    let renewalsFound = 0;
    let emailsSent = 0;
    let slackDetails = [];

    for await (const sub of stripe.subscriptions.list({
      status: "active",
      limit: 100,
      expand: [
        "data.customer",
        "data.items.data.price",
        "data.items.data.price.product"
      ]
    }).autoPagingIterable()) {

      const renewalDate = new Date(sub.current_period_end * 1000);
      const renewalDateISO = renewalDate.toISOString().split("T")[0];

      const diffDays = Math.floor(
        (renewalDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays < 6 || diffDays > 7) continue;

      renewalsFound++;

      /*
      DUPLICATE PROTECTION USING STRIPE METADATA
      */
      if (sub.metadata?.renewal_reminder_sent === renewalDateISO) {
        slackDetails.push(
          `• ${sub.customer.email} → already sent`
        );
        continue;
      }

      /*
      SAFETY CAP
      */
      if (emailsSent >= MAX_EMAILS_PER_RUN) {
        throw new Error("Safety stop triggered: max emails reached");
      }

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
      const formattedDate = formatDateSwedish(renewalDateISO);

      const idempotencyKey = `${sub.id}-${renewalDateISO}`;

      const recipientEmail = TEST_MODE
        ? "olivkassen@gmail.com"
        : email;

      if (!DRY_RUN) {
        await resend.emails.send(
          {
            from: "Olivkassen <renewals@olivkassen.com>",
            to: recipientEmail,
            subject: "Snart dags för nästa leverans",
            template: {
              id: process.env.RESEND_TEMPLATE_ID,
              variables: {
                name: firstName,
                product_title: productTitle,
                plan_interval: planInterval,
                renewal_date: formattedDate,
                portal_url: process.env.PORTAL_URL,
              },
            },
          },
          { idempotencyKey }
        );

        /*
        MARK AS SENT IN STRIPE METADATA
        */
        await stripe.subscriptions.update(sub.id, {
          metadata: {
            ...sub.metadata,
            renewal_reminder_sent: renewalDateISO,
          },
        });

        emailsSent++;
      }

      slackDetails.push(
        `• ${customer.name} (${recipientEmail}) → ${renewalDateISO}`
      );
    }

    /*
    SLACK REPORT
    */
    try {
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
Dry run: ${DRY_RUN ? "YES" : "NO"}

${slackDetails.length > 0 ? slackDetails.join("\n") : "No renewals today"}
`,
        }),
      });
    } catch (slackError) {
      console.error("Slack reporting failed:", slackError);
    }

    return res.status(200).json({
      date: today.toISOString().split("T")[0],
      target_date: targetDateISO,
      renewals_found: renewalsFound,
      emails_sent: emailsSent,
      test_mode: TEST_MODE,
      dry_run: DRY_RUN,
    });

  } catch (error) {
    console.error("Renewal error:", error);
    return res.status(500).json({ error: error.message });
  }
}