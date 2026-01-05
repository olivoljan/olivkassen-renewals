import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export default async function handler(req, res) {
  try {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 50,
    });

    let sent = 0;

    for (const sub of subscriptions.data) {
      const customer = sub.customer;
      if (!customer?.email) continue;

      // TEST MODE — real data, safe inbox
      if (customer.email !== "cristina.coloman@gmail.com") continue;

      const price = sub.items.data[0].price;

      const intervalMap = {
        1: "varje månad",
        3: "var tredje månad",
        6: "var sjätte månad",
      };

      const interval =
        intervalMap[price.recurring.interval_count] || "regelbundet";

      const renewalDate = new Date(sub.current_period_end * 1000)
        .toLocaleDateString("sv-SE");

      await sgMail.send({
        to: "olivkassen@gmail.com",
        from: {
          email: "kontakt@olivkassen.com",
          name: "Olivkassen",
        },
        templateId: "d-fe01cb7634114535a27600e27d48c5d3",
        dynamicTemplateData: {
          name: customer.name || "vän",
          product_title: "3L premium olivolja",
          price: (price.unit_amount / 100).toFixed(0),
          interval,
          renewal_date: renewalDate,
          portal_url:
            "https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288",
          logo_url:
            "https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/67a38a8645686cca76b775ec_olivkassen-logo.svg",
        },
      });

      sent++;
    }

    res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
