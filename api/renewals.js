import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // --- GET = health check ---
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Renewals endpoint alive",
    });
  }

  // --- Only POST allowed ---
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // --- AUTH ---
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const received = req.headers.authorization;

  if (received !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }

  let sent = 0;

  try {
    // 🔴 Pull ONE active subscription with real data
    const subs = await stripe.subscriptions.list({
      status: "active",
      limit: 5,
      expand: ["data.customer", "data.items.data.price"],
    });

    for (const sub of subs.data) {
      const customer = sub.customer;

      // 🔒 SAFETY: only send to you
      if (customer.email !== "energyze@me.com") continue;

      const item = sub.items.data[0];
      const priceObj = item.price;
      const product = await stripe.products.retrieve(priceObj.product);

      const name =
        customer.name || customer.email.split("@")[0];

      const price = `${priceObj.unit_amount / 100} kr`;

      const interval = priceObj.recurring.interval;
      const count = priceObj.recurring.interval_count;
      const map = { month: "månad", year: "år" };

      const planInterval =
        count === 1
          ? `varje ${map[interval]}`
          : `var ${count} ${map[interval]}`;

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

      // ✅ ORIGINAL REAL EMAIL TEXT
      const text = `
Hej ${name},

Det börjar bli dags för nästa leverans av din Olivkassen:

${product.name} – ${price}

Leverans: ${planInterval}
Förnyelse: ${renewalDate}

Hantera abonnemang:
${process.env.PORTAL_LINK}

Vänliga hälsningar,
Olivkassen
`.trim();

      await sendEmail({
        to: "energyze@me.com",
        subject: "Din kommande Olivkassen-leverans",
        text,
      });

      sent++;
      break; // 🔒 send ONE email only
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
