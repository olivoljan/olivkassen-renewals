import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // --- GET = sanity check ---
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Renewals endpoint alive",
    });
  }

  // --- Only POST ---
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
    // 1️⃣ Fetch ALL active subscriptions
    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 10,
    });

    if (!subs.data.length) {
      return res.status(200).json({ ok: true, sent: 0, note: "No subscriptions" });
    }

    // 2️⃣ Pick FIRST subscription only (proof test)
    const sub = subs.data[0];
    const customer = sub.customer;
    const priceObj = sub.items.data[0].price;

    const product = await stripe.products.retrieve(priceObj.product);

    const price = `${priceObj.unit_amount / 100} kr`;

    const interval = priceObj.recurring.interval;
    const count = priceObj.recurring.interval_count;
    const map = { month: "månad", year: "år" };

    const planInterval =
      count === 1 ? `varje ${map[interval]}` : `var ${count} ${map[interval]}`;

    const renewalDate = new Date(
      sub.current_period_end * 1000
    ).toLocaleDateString("sv-SE");

    // 3️⃣ ORIGINAL EMAIL CONTENT
    const text = `
Hej,

Det börjar bli dags för nästa leverans av din Olivkassen:

${product.name} – ${price}

Leverans: ${planInterval}
Förnyelse: ${renewalDate}

Hantera abonnemang:
${process.env.PORTAL_LINK}

Vänliga hälsningar,
Olivkassen
`.trim();

    // 4️⃣ SEND TO YOU ONLY
    await sendEmail({
      to: "energyze@me.com",
      subject: "Din kommande Olivkassen-leverans",
      text,
    });

    return res.status(200).json({
      ok: true,
      upcoming: subs.data.length,
      sent: 1,
      note: "Proof email sent to test address only",
    });
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
