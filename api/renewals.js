import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // --- Allow GET for manual testing ---
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "GET test mode active — no emails sent.",
      howToRun: "Send a POST request with Authorization header to run cron."
    });
  }

  // --- Only POST allowed ---
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // --- DEBUG LOGS ---
  console.log("AUTH HEADER:", req.headers.authorization);
  console.log("EXPECTED:", `Bearer ${process.env.CRON_SECRET}`);

  // --- Cron auth ---
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysFromNow = now + 7 * 24 * 60 * 60;

    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"]
    });

    const upcoming = subs.data.filter(s =>
      s.current_period_end >= now &&
      s.current_period_end <= sevenDaysFromNow
    );

    for (const sub of upcoming) {
      const customer = sub.customer;
      const item = sub.items.data[0];
      const priceObj = item.price;

      const product = await stripe.products.retrieve(priceObj.product);

      const name = customer.name || customer.email.split("@")[0];
      const price = priceObj.unit_amount / 100 + " kr";

      const interval = priceObj.recurring.interval;
      const count = priceObj.recurring.interval_count;
      const map = { month: "månad", year: "år" };

      const planInterval =
        count === 1 ? `varje ${map[interval]}` : `var ${count} ${map[interval]}`;

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

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
`;

      await sendEmail({
        to: customer.email,
        subject: "Din kommande Olivkassen-leverans",
        text
      });
    }

    return res.status(200).json({ ok: true, sent: upcoming.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
