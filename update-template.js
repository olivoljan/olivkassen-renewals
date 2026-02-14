import "dotenv/config";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const TEMPLATE_ID = process.env.RESEND_TEMPLATE_ID;

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
<strong>{{{product_title}}}</strong> – levereras
<strong>{{{plan_interval}}}</strong>.
</p>

<p>
Paketet skickas till ditt närmaste DHL- eller Schenker-ombud.
Om du vill uppdatera dina betalningsuppgifter, ändra leveransintervall
eller göra andra justeringar i ditt abonnemang gör du det enkelt via vår kundportal:
</p>

<p>
👉
<a href="{{{portal_url}}}" style="text-decoration:none;">
<span style="color:#000000 !important;">
<strong>Kundportal</strong>
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

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;

async function updateTemplate() {
  const response = await resend.templates.update(TEMPLATE_ID, {
    html,
  });

  console.log("Template updated successfully");
}

updateTemplate();
