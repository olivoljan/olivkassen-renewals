import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // --- Allow GET for manual testing ---
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "GET test mode active — no emails sent.",
      howToRun: "Send a POST request to actually process renewals."
    });
  }

  // --- Block everything except POST ---
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysFromNow = now + 7 * 24 * 60 * 60;

    // Fetch customer + price (not product)
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

      // Get product from Stripe (cannot expand deeper than 4 levels)
      const product = await stripe.products.retrieve(priceObj.product);
      const product_title = product.name;

      const name = customer.name || customer.email.split("@")[0];
      const price = priceObj.unit_amount / 100 + " kr";

      const interval = priceObj.recurring.interval;
      const count = priceObj.recurring.interval_count;
      const map = { month: "månad", year: "år" };

      const plan_interval =
        count === 1 ? `varje ${map[interval]}` : `var ${count} ${map[interval]}`;

      const renewal_date = new Date(sub.current_period_end * 1000).toLocaleDateString("sv-SE");

      const portal = process.env.PORTAL_LINK;

      const text = `
Hej ${name},

Det börjar bli dags för nästa leverans av din beställning hos oss:

${product_title} – ${price}

Leveransen sker ${plan_interval}. Din nästa förnyelse sker automatiskt den ${renewal_date} och levereras till närmaste DHL-ombud.

Beloppet debiteras automatiskt.

Vill du uppdatera intervall, hoppa över en leverans eller göra andra ändringar?
👉 ${portal}

Tack för att du låter oss vara en del av ditt kök. Vi är stolta över att få leverera vår olivolja till dig.

Frågor? Kontakta oss på kontakt@olivkassen.com

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
