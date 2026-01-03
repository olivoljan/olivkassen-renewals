import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

function intervalToSwedish(interval, count) {
  if (interval === "month" && count === 1) return "månad";
  if (interval === "month" && count === 2) return "varannan månad";
  if (interval === "month" && count === 3) return "kvartal";
  if (interval === "year") return "år";
  return "period";
}

export default async function handler(req, res) {
  // GET = health check
  if (req.method === "GET") {
    return res.status(200).json({ ok: true });
  }

  // Only POST
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Auth
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const ninetyDays = now + 90 * 24 * 60 * 60;

    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    const upcoming = subs.data.filter(
      s => s.current_period_end >= now && s.current_period_end <= ninetyDays
    );

    let sent = 0;

    for (const sub of upcoming) {
      const customer = sub.customer;

      // 🔒 HARD LOCK — ONLY YOUR EMAIL
      if (customer.email !== "energyze@me.com") continue;

      const item = sub.items.data[0];
      const price = item.price;

      const product = await stripe.products.retrieve(price.product);

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

      const intervalText = intervalToSwedish(
        price.recurring.interval,
        price.recurring.interval_count
      );

      const text = `
Hej ${customer.name || ""},

Det börjar bli dags för nästa leverans av din beställning hos oss:

${product.name} – ${price.unit_amount / 100} kr

Leveransen sker var ${intervalText}.
Din nästa förnyelse sker automatiskt den ${renewalDate}.

Hantera ditt abonnemang:
https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288

Tack för att du låter oss vara en del av ditt kök.
Vi är stolta över att få leverera vår olivolja till dig.

Frågor? Kontakta oss på kontakt@olivkassen.com

Varma hälsningar,  
Olivkassen
`.trim();

      await sendEmail({
        to: customer.email,
        subject: "Snart dags för nästa leverans",
        text,
      });

      sent++;
    }

    return res.status(200).json({
      ok: true,
      upcoming: upcoming.length,
      sent,
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
