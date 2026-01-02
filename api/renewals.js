import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // --- Allow GET for manual testing (NO AUTH) ---
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "GET test mode active — no emails sent.",
      howToRun: "Send a POST request with Authorization header to process renewals."
    });
  }

  // --- Only allow POST ---
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // --- CRON / AUTH PROTECTION (PUT THIS HERE) ---
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

    const upcoming = subs.data.filter((s) => {
      const renewAt = s.current_period_end;
      return renewAt >= now && renewAt <= sevenDaysFromNow;
    });

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

      const plan_interval =
        count === 1 ? `varje ${map[interval]}` : `var ${count} ${map[interval]}`;

      const renewal_date = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

      const portal = process.env.PORTAL_LINK;

      const text = `
Hej ${name},

Det börjar bli dags för nästa leverans av din beställning hos oss:

${product.name} – ${price}

Leveransen sker ${plan_interval}. Din nästa förnyelse sker automatiskt den ${renewal_date}.

Vill du göra ändringar?
👉 ${portal}

Varma hälsningar,
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
