import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const TEMPLATE_ID = "d-fe01cb7634114535a27600e27d48c5d3";
const TEST_INBOX = "olivkassen@gmail.com";
const DAYS_AHEAD = 24;

export default async function handler(req, res) {
  try {
    // ─── AUTH ─────────────────────────────────────────────
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const now = Math.floor(Date.now() / 1000);
    const cutoff = now + DAYS_AHEAD * 24 * 60 * 60;

    // ─── FETCH SUBSCRIPTIONS ───────────────────────────────
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    let checked = 0;
    let eligible = 0;
    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions.data) {
      checked++;

      // Only upcoming renewals
      if (sub.current_period_end > cutoff) continue;

      const customer = sub.customer;
      if (!customer || !customer.email) continue;

      eligible++;

      const item = sub.items.data[0];
      const price = item.price;

      // Interval text (Swedish)
      let intervalText = "period";
      if (price.recurring?.interval === "month") {
        intervalText =
          price.recurring.interval_count === 1
            ? "månad"
            : `${price.recurring.interval_count} månader`;
      }

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

      const dynamicData = {
        name: customer.name || "vän",
        product_title: price.nickname || "Olivkassen",
        price: (price.unit_amount / 100).toFixed(0),
        plan_interval: intervalText,
        renewal_date: renewalDate,
        portal_url:
          "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
        logo_url:
          "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/67a38a8645686cca76b775ec_olivkassen-logo.png",
      };

      try {
        await sgMail.send({
          to: TEST_INBOX, // 🔒 always test inbox
          from: {
            email: "kontakt@olivkassen.com",
            name: "Olivkassen",
          },
          templateId: TEMPLATE_ID,
          dynamicTemplateData: dynamicData,
        });

        sent++;
      } catch (mailErr) {
        console.error("SENDGRID ERROR:", mailErr);
        failed++;
      }
    }

    return res.status(200).json({
      ok: true,
      checked,
      eligible,
      sent,
      failed,
      testMode: true,
      windowDays: DAYS_AHEAD,
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
