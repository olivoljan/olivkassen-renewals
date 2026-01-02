import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: [
        "data.customer",
        "data.items.data.price",
        "data.default_payment_method",
      ],
      limit: 1, // proof test
    });

    const sub = subs.data[0];
    const customer = sub.customer;
    const priceObj = sub.items.data[0].price;
    const product = await stripe.products.retrieve(priceObj.product);

    // --- Renewal date ---
    const renewalDate = new Date(
      sub.current_period_end * 1000
    ).toLocaleDateString("sv-SE");

    // --- Interval ---
    const count = priceObj.recurring.interval_count;
    const interval = priceObj.recurring.interval;
    const map = { month: "månad", year: "år" };
    const planInterval =
      count === 1 ? `varje ${map[interval]}` : `var ${count} ${map[interval]}`;

    // --- Price ---
    const price = priceObj.unit_amount / 100;

    // --- PAYMENT METHOD LOGIC ---
    let paymentLine = "Beloppet debiteras automatiskt.";

    const pm =
      sub.default_payment_method ||
      customer.invoice_settings?.default_payment_method;

    if (pm) {
      if (pm.type === "card") {
        paymentLine = `Beloppet debiteras från ditt kort (•••• ${pm.card.last4}).`;
      } else if (pm.type === "klarna") {
        paymentLine = "Beloppet betalas via Klarna.";
      }
    }

    // --- EMAIL TEXT ---
    const text = `
Hej ${customer.name || ""},

Det börjar bli dags för nästa leverans av din beställning hos oss:

${product.name} – ${price} 

Leveransen sker ${planInterval}. Din nästa förnyelse sker automatiskt den ${renewalDate} och levereras till närmaste DHL-ombud.

${paymentLine}

Vill du uppdatera betalningsuppgifter, byta intervall eller göra andra ändringar?

👉 https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288

Tack för att du låter oss vara en del av ditt kök. Vi är stolta över att få leverera vår olivolja till dig och hoppas att den fortsätter att sätta guldkant på dina måltider.

Frågor? Kontakta oss på kontakt@olivkassen.com

Varma hälsningar,
Olivkassen
`.trim();

    await sendEmail({
      to: "energyze@me.com", // still safe test
      subject: "Snart dags för nästa leverans från Olivkassen",
      text,
    });

    return res.status(200).json({ ok: true, sent: 1 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
