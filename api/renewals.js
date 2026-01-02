import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // --- GET = safe test mode ---
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "GET test mode active — no emails sent.",
      howToRun: "POST with Authorization header to send emails."
    });
  }

  // --- Only POST allowed ---
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // --- CRON AUTH ---
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const received = req.headers.authorization;

  if (received !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const ninetyDaysFromNow = now + 90 * 24 * 60 * 60;

    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"]
    });

    const upcoming = subs.data.filter(
      s => s.current_period_end >= now && s.current_period_end <= ninetyDaysFromNow
    );

    let sent = 0;

    for (const sub of upcoming) {
      const customer = sub.customer;

      // 🔒 SEND ONLY TO YOU
      if (customer.email !== "energyze@me.com") continue;

      const priceObj = sub.items.data[0].price;
      const product = await stripe.products.retrieve(priceObj.product);

      const price = `${priceObj.unit_amount / 100} kr`;
      const interval = priceObj.recurring.interval;
      const count = priceObj.recurring.interval_count;
      const intervalMap = { month: "månad", year: "år" };

      const planInterval =
        count === 1
          ? `varje ${intervalMap[interval]}`
          : `var ${count} ${intervalMap[interval]}`;

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

      const name = customer.name || customer.email.split("@")[0];

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
        text
      });

      sent++;
    }

    return res.status(200).json({
      ok: true,
      upcoming: upcoming.length,
      sent
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
