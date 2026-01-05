import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ---- Helpers ----
function formatSwedishDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getPlanInterval(price) {
  if (price.recurring?.interval === "month") {
    if (price.recurring.interval_count === 1) return "varje månad";
    if (price.recurring.interval_count === 3) return "var tredje månad";
    if (price.recurring.interval_count === 6) return "var sjätte månad";
  }
  return "enligt abonnemang";
}

export default async function handler(req, res) {
  try {
    // ---- AUTH ----
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // ---- FETCH SUBSCRIPTIONS ----
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 50,
    });

    let sent = 0;

    for (const sub of subscriptions.data) {
      const customer = sub.customer;
      if (!customer?.email) continue;

      // 🔒 ONLY CHECK THIS REAL SUBSCRIPTION
      if (customer.email !== "cristina.coloman@gmail.com") continue;

      const item = sub.items.data[0];
      const price = item.price;

      const templateData = {
        name: customer.name || "vän",
        product_title: price.nickname || "Olivkassen",
        price: (price.unit_amount / 100).toFixed(0),
        plan_interval: getPlanInterval(price),
        renewal_date: formatSwedishDate(sub.current_period_end),
        portal_url:
          "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
        logo_url:
          "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/67a38a8645686cca76b775ec_olivkassen-logo.svg",
      };

      await sgMail.send({
        to: "olivkassen@gmail.com", // ✅ TEST INBOX
        from: {
          email: "kontakt@olivkassen.com",
          name: "Olivkassen",
        },
        templateId: "d-fe01cb7634114535a27600e27d48c5d3",
        dynamicTemplateData: templateData,
      });

      sent++;
    }

    return res.status(200).json({
      ok: true,
      sent,
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
