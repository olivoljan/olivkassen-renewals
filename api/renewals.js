import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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

export default async function handler(req, res) {
  const startedAt = new Date();

  let checked = 0;
  let eligible = 0;
  let sent = 0;
  let failed = 0;
  let fatalError = null;

  try {
    /* ───── AUTH GUARD ───── */
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const NOW = Math.floor(Date.now() / 1000);
    const WINDOW_END = NOW + NOTICE_DAYS * 24 * 60 * 60;

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      checked++;

      if (sub.current_period_end > WINDOW_END) continue;
      eligible++;

      if (sent >= MAX_EMAILS_PER_RUN) break;

      const customer = sub.customer;
      if (!customer?.email) continue;

      const item = sub.items.data[0];
      const price = item.price;

      let intervalText = "återkommande";
      if (price.recurring?.interval === "month") {
        intervalText =
          price.recurring.interval_count === 1
            ? "varje månad"
            : `var ${price.recurring.interval_count}:e månad`;
      }

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toISOString().split("T")[0];

      const variables = {
        name: customer.name || "vän",
        product_title:
          price.nickname || "Olivkassen prenumeration",
        price: (price.unit_amount / 100).toFixed(0),
        plan_interval: intervalText,
        renewal_date: renewalDate,
        portal_url:
          "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
        logo_url:
          "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png",
      };

      try {
        await sgMail.send({
          to: TEST_RECIPIENT, // 🔒 test-safe
          from: {
            email: "kontakt@olivkassen.com",
            name: "Olivkassen",
          },
          templateId: process.env.SENDGRID_TEMPLATE_ID,
          dynamicTemplateData: variables,
        });

        sent++;
      } catch (err) {
        console.error("SEND FAILED:", err.message);
        failed++;
      }
    }
  } catch (err) {
    fatalError = err;
    console.error("RENEWALS ERROR:", err);
  }

  /* ───── SLACK REPORT (ALWAYS) ───── */
  const dateStr = new Date().toLocaleDateString("sv-SE");

  let statusLine = "✅ Allt ser bra ut";
  if (fatalError) statusLine = "🚨 KRITISKT FEL – körningen avbröts";
  else if (failed > 0) statusLine = "⚠️ Vissa utskick misslyckades";
  else if (eligible > 0 && sent === 0)
    statusLine = "⚠️ Förnyelser hittades men inget skickades";
  else if (eligible === 0)
    statusLine = "ℹ️ Inga förnyelser idag";

  await sendSlack(`
🫒 *Olivkassen – Daglig förnyelserapport*

📅 Datum: ${dateStr}
🔍 Kontrollerade abonnemang: ${checked}
⏰ Förnyelser inom ${NOTICE_DAYS} dagar: ${eligible}
✅ Skickade mejl: ${sent}
❌ Misslyckade: ${failed}

${statusLine}
  `);

  if (fatalError) {
    return res.status(500).json({ error: fatalError.message });
  }

  return res.status(200).json({
    ok: true,
    checked,
    eligible,
    sent,
    failed,
  });
}
