import "dotenv/config";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const TEMPLATE_ID = "ce41d415-aadc-47ba-b57e-2d35a74af430";

const html = `
<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>

<body style="margin:0;padding:0;background:#f1e7db;font-family:Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1e7db;padding:40px 16px;">
<tr>
<td align="center">

<table width="100%" style="max-width:600px;background:#ffffff;border-radius:16px;padding:32px;">

<tr>
<td align="center" style="padding-bottom:24px;">
<img src="https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png"
width="120" style="display:block;">
</td>
</tr>

<tr>
<td style="font-size:15px;line-height:1.6;color:#000000;">

<p>Hej {{{name}}},</p>

<p>
Det är snart dags för nästa leverans i ditt olivoljeabonnemang:
<strong>{{{product_title}}}</strong>
<strong> – levereras {{{plan_interval}}}</strong>.
</p>

<p>
Paketet skickas till ditt närmaste DHL- eller Schenker-ombud.
Om du vill uppdatera dina betalningsuppgifter, ändra leveransintervall
eller göra andra justeringar i ditt abonnemang gör du det enkelt via vår kundportal:
</p>

<p>
👉 
<a href="{{{portal_url}}}" 
   style="color:#000000 !important; text-decoration:none !important;">
  <span style="color:#000000 !important; font-weight:bold;">
    Kundportal
  </span>
</a>
</p>

<p>
Nästa leverans sker den <strong>{{{renewal_date}}}</strong>.
</p>

<p>
Tack för att du låter oss vara en del av din matlagning.
Det betyder mycket för oss att få leverera vår olivolja till dig och
vi hoppas att den fortsätter att sätta guldkant på dina måltider.
</p>

<p>
Om du har frågor eller behöver hjälp är du välkommen att kontakta oss på
<strong>kontakt@olivkassen.com</strong>
</p>

<p>
Varma hälsningar,<br>
Olivkassen
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;

const text = `
Hej {{{name}}},

Det är snart dags för nästa leverans i ditt olivoljeabonnemang: {{{product_title}}} – levereras {{{plan_interval}}}.

Paketet skickas till ditt närmaste DHL- eller Schenker-ombud. 
Om du vill uppdatera dina betalningsuppgifter, ändra leveransintervall eller göra andra justeringar i ditt abonnemang gör du det enkelt via vår kundportal: {{{portal_url}}}

Nästa leverans sker den {{{renewal_date}}}.

Tack för att du låter oss vara en del av din matlagning.

Om du har frågor eller behöver hjälp är du välkommen att kontakta oss på kontakt@olivkassen.com

Varma hälsningar,
Olivkassen
`;

async function updateTemplate() {
  await resend.templates.update(TEMPLATE_ID, {
    name: "Olivkassen Renewal Reminder NEW",
    subject: "Snart dags för nästa leverans",
    preview: "Din nästa leverans närmar sig",
    from: "Olivkassen <renewals@olivkassen.com>",
    html,
    text,
  });

  await resend.templates.publish(TEMPLATE_ID);

  console.log("Template updated and published");
}

updateTemplate();
