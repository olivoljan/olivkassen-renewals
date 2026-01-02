import { stripe } from "../lib/stripe.js";
import { sendEmail } from "../lib/sendgrid.js";

export default async function handler(req, res) {
  // --- GET = test mode (no auth, no emails) ---
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "GET test mode active — no emails sent.",
      howToRun: "POST with Authorization header to run real renewals."
    });
  }

  // --- Only POST allowed ---
  if (req.method !== "POST") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // --- CRON AUTH ---
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const received = req.headers.authorization;

  console.log("AUTH HEADER:", received);
  console.log("EXPECTED:", expected);

  if (received !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysFromNow = now + 7 * 24 * 60 * 60;

    const subs = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"]
    });

    const upcoming = subs.data.filter(
      s => s.current_period_end >= now && s.current_period_end <= sevenDaysFromNow
    );

    // 🔒 TEMP: disable sending emails until SendGrid is fixed
    return res.status(200).json({
      ok: true,
      upcoming: upcoming.length,
      note: "Emails skipped (SendGrid disabled for testing)"
    });

    /* === ENABLE LATER ===
    for (const sub of upcoming) {
      const customer = sub.customer;
      const price = sub.items.data[0].price;
      const product = await stripe.products.retrieve(price.product);

      await sendEmail({
        to: customer.email,
        subject: "Your upcoming Olivkassen delivery",
        text: `Your next delivery: ${product.name}`
      });
    }
    */
  } catch (err) {
    console.error("RENEWALS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
