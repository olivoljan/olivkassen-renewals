import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const resend = new Resend(process.env.RESEND_API_KEY);

const TEST_MODE = true;
const TEST_RECIPIENT = "olivkassen@gmail.com";
const NOTICE_DAYS = 7;
const TARGET_HOUR = 7; // 07:00 local time

async function sendSlack(message) {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

function formatDate(ts) {
  return new Date(ts * 1000).toISOString().split("T")[0];
}

function getTargetDayWindow() {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + NOTICE_DAYS);
  target.setHours(TARGET_HOUR, 0, 0, 0);

  const start = new Date(target);
  const end = new Date(target);
  end.setHours(23, 59, 59, 999);

  return {
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(end.getTime() / 1000),
  };
}

function buildHtml(data) {
  return `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#F1E7DB;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px;">
            
            <tr>
              <td align="center">
                <img
                  src="https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png"
                  alt="Olivkassen"
                  width="120"
                  style="display:block;margin:0 auto 24px;"
                />
              </td>
            </tr>

            <tr>
              <td style="font-size:15px;color:#000000;line-height:1.6;text-align:left;">
                <br>Hej ${data.name},<br><br>

                Det är snart dags för nästa leverans i ditt olivoljeabonnemang: 
                <strong>${data.product_title} – levereras ${data.plan_interval}.</strong>
                <br><br>

                Paketet skickas till ditt närmaste DHL- eller Schenker-ombud. 
                Om du vill uppdatera dina betalningsuppgifter, ändra leveransintervall 
                eller göra andra justeringar i ditt abonnemang gör du det enkelt via vår kundportal:
              </td>
            </tr>

            <tr>
              <td style="padding:24px 0;text-align:left;">
                👉 <a href="${data.portal_url}" style="color:#000000;text-decoration:none;font-size:15px;">
                  <strong>Kundportal</strong>
                </a>
              </td>
            </tr>

            <tr>
              <td style="font-size:15px;color:#000000;line-height:1.6;text-align:left;">
                Nästa leverans sker den <strong>${data.renewal_date}</strong>.
                <br><br>

                Tack för att du låter oss vara en del av din matlagning.
                <br><br>

                Om du har frågor är du välkommen att kontakta oss på
                <a href="mailto:kontakt@olivkassen.com" style="color:#000000;">
                  kontakt@olivkassen.com
                </a>
                <br><br>

                Varma hälsningar,<br>
                <strong>Olivkassen</strong>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  let checked = 0;
  let eligible = 0;
  let sent = 0;
  let failed = 0;
  const preview = [];

  try {
    const { start, end } = getTargetDayWindow();

    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer", "data.items.data.price"],
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      checked++;

      if (
        sub.current_period_end < start ||
        sub.current_period_end > end
      )
        continue;

      eligible++;

      const customer = sub.customer;
      if (!customer?.email) continue;

      const item = sub.items.data[0];
      const price = item.price;

      let intervalText = "recurring";
      if (price.recurring?.interval === "month") {
        intervalText =
          price.recurring.interval_count === 1
            ? "varje månad"
            : `var ${price.recurring.interval_count}:e månad`;
      }

      const renewalDate = formatDate(sub.current_period_end);

      preview.push(
        `• ${customer.email} | ${price.nickname} | ${renewalDate}`
      );

      const html = buildHtml({
        name: customer.name || "vän",
        product_title: price.nickname,
        plan_interval: intervalText,
        renewal_date: renewalDate,
        portal_url: process.env.PORTAL_LINK,
      });

      try {
        await resend.emails.send({
          from: "Olivkassen <renewals@olivkassen.com>",
          to: TEST_MODE ? TEST_RECIPIENT : customer.email,
          subject: "Snart dags för nästa leverans",
          html,
        });

        sent++;
      } catch (err) {
        console.error("SEND FAILED:", err);
        failed++;
      }
    }

    await sendSlack(`
*Olivkassen – Daily Renewal Report (TEST)*

Date: ${new Date().toLocaleDateString("sv-SE")}
Renewals exactly in ${NOTICE_DAYS} days: ${eligible}
Emails sent: ${sent}
Failed: ${failed}

---
${preview.join("\n") || "No renewals"}
`);

    return res.status(200).json({
      ok: true,
      checked,
      eligible,
      sent,
      failed,
    });
  } catch (err) {
    console.error("FATAL ERROR:", err);
    await sendSlack(`🚨 Fatal renewal error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
