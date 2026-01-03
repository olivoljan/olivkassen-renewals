import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (req.headers.authorization !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const ninetyDaysFromNow = now + 90 * 24 * 60 * 60;

    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: [
        "data.customer",
        "data.items.data.price",
        "data.latest_invoice.payment_intent"
      ]
    });

    const upcoming = subs.data.filter(
      s => s.current_period_end >= now &&
           s.current_period_end <= ninetyDaysFromNow
    );

    let sent = 0;

    for (const sub of upcoming) {
      const customer = sub.customer;
      if (!customer?.email) continue;

      const priceObj = sub.items.data[0].price;
      const product = await stripe.products.retrieve(priceObj.product);

      const renewalDate = new Date(
        sub.current_period_end * 1000
      ).toLocaleDateString("sv-SE");

      const planInterval =
        priceObj.recurring?.interval === "month"
          ? "månad"
          : priceObj.recurring?.interval === "year"
          ? "år"
          : "period";

      const price = Math.round(priceObj.unit_amount / 100);

      const text = `
Hej ${customer.name || ""},

Det börjar bli dags för nästa leverans av din beställning hos oss:

${product.name} – ${price} kr

Leveransen sker var ${planInterval}.
Din nästa förnyelse sker automatiskt den ${renewalDate}.

Hantera ditt abonnemang:
${process.env.PORTAL_LINK}

Varma hälsningar,
Olivkassen
`.trim();

      const html = `
<div style="
  background:#ffffff;
  color:#111111;
  font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  padding:24px;
  max-width:560px;
  margin:0 auto;
">
  <img
    src="https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/67a38a8645686cca76b775ec_olivkassen-logo.svg"
    alt="Olivkassen"
    style="width:140px;max-width:40%;margin-bottom:24px;"
  />

  <p>Hej ${customer.name || ""},</p>

  <p>Det börjar bli dags för nästa leverans av din beställning hos oss:</p>

  <p style="font-size:16px;font-weight:500;margin:16px 0;">
    ${product.name} – ${price} kr
  </p>

  <p>
    Leveransen sker var ${planInterval}.<br/>
    Din nästa förnyelse sker automatiskt den <strong>${renewalDate}</strong>
    och levereras till närmaste DHL-ombud.
  </p>

  <div style="margin:28px 0;">
    <a href="https://billing.stripe.com/p/login/8wM9CM1iv93f4tG288"
       style="
         display:inline-block;
         padding:14px 22px;
         background:#111111;
         color:#ffffff;
         text-decoration:none;
         border-radius:6px;
         font-weight:600;
       ">
      Kundportal
    </a>
  </div>

  <p>
    Tack för att du låter oss vara en del av ditt kök. Vi är stolta över att få
    leverera vår olivolja till dig.
  </p>

  <p>
    Frågor? Kontakta oss på
    <a href="mailto:kontakt@olivkassen.com">kontakt@olivkassen.com</a>
  </p>

  <p style="margin-top:32px;">
    Varma hälsningar,<br/>
    <strong>Olivkassen</strong>
  </p>
</div>
      `.trim();

      await sendEmail({
        to: customer.email,
        subject: "Snart dags för nästa leverans",
        text,
        html
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
