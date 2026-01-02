import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  /**
   * ============================
   * GET — SAFE TEST MODE
   * ============================
   */
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "GET test mode active — no emails sent.",
      howToRun: "Send a POST request with Authorization header to process renewals."
    });
  }

  /**
   * ============================
   * ONLY POST ALLOWED
   * ============================
   */
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  /**
   * ============================
   * CRON AUTH (POST ONLY)
   * ============================
   */
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysFromNow = now + 7 * 24 * 60 * 60;

    /**
     * Fetch subscriptions
     * (cannot expand product this deep)
     */
    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"]
    });

    const upcoming = subs.data.filter((s) => {
      const renewAt = s.current_period_end;
      return renewAt >= now && renewAt <= sevenDaysFromNow;
    });

    let sent = 0;

    for (const sub of upcoming) {
      const customer = sub.customer;
      const item = sub.items.data[0];
      const priceObj = item.price;

      // Fetch product separately (Stripe limitation)
      const product = await stripe.products.retrieve(priceObj.product);

      const name = customer.name || customer.email.split("@")[0];
      const price = `${priceObj.unit_amount / 100} kr`;

      const interval = priceObj.recurring.interval; // month / year
      const count = priceObj.recurring.interval_count;
      const map = { month: "månad", year: "år" };

      const planInterval =
        count === 1
          ? `varje ${map[interval]}`
          : `var ${count} ${map[interval]}`;

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

      const portal = process.env.PORTAL_LINK;

      const text = `
Hej ${name},

Det börjar bli dags för nästa leverans av din beställning hos oss:

${product.name} – ${price}

Leveransen sker ${planInterval}. Din nästa förnyelse sker automatiskt den ${renewalDate} och levereras till närmaste DHL-ombud.

Beloppet debiteras automatiskt.

Vill du uppdatera intervall, hoppa över en leverans eller göra andra ändringar?
👉 ${portal}

Tack för att du låter oss vara en del av ditt kök.

Frågor? Kontakta oss på kontakt@olivkassen.com

Varma hälsningar,
Olivkassen
`;

      await sendEmail({
        to: customer.email,
        subject: "Din kommande Olivkassen-leverans",
        text
      });

      sent++;
    }

    return res.status(200).json({
      ok: true,
      sent
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
