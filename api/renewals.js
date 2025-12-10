import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysFromNow = now + 7 * 24 * 60 * 60;

    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price.product"]
    });

    const upcoming = subs.data.filter(s => {
      const t = s.current_period_end;
      return t >= now && t <= sevenDaysFromNow;
    });

    for (const sub of upcoming) {
      const customer = sub.customer;
      const item = sub.items.data[0];
      const priceObj = item.price;
      const product = priceObj.product;

      const name = customer.name || customer.email.split("@")[0];
      const product_title = product.name;
      const price = (priceObj.unit_amount / 100) + " kr";

      const interval = priceObj.recurring.interval;
      const count = priceObj.recurring.interval_count;
      const map = { month: "månad", year: "år" };

      const plan_interval =
        count === 1 ? `varje ${map[interval]}` : `var ${count} ${map[interval]}`;

      const renewal_date = new Date(sub.current_period_end * 1000)
        .toLocaleDateString("sv-SE");

      const portal = process.env.PORTAL_LINK;

      const text = `
Hej ${name},

Det börjar bli dags för nästa leverans av din beställning hos oss:

${product_title} – ${price}

Leveransen sker ${plan_interval}. Din nästa förnyelse sker automatiskt den ${renewal_date} och levereras till närmaste DHL-ombud.

Beloppet debiteras automatiskt.

Vill du uppdatera intervall, hoppa över en leverans eller göra andra ändringar?
👉 ${portal}

Tack för att du låter oss vara en del av ditt kök. Vi är stolta över att få leverera vår olivolja till dig och hoppas att den fortsätter att sätta guldkant på dina måltider.

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
