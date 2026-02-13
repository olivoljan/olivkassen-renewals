import 'dotenv/config';
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const TEMPLATE_ID = "1dd3356f-5762-4af2-b4a6-33ed235e92d1";

const html = `
<!DOCTYPE html>
<html lang="sv">
<head>
<meta content="width=device-width" name="viewport" />
<meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
</head>
<body style="margin:0;padding:0;background:#f1e7db;font-family:Arial,sans-serif;">

<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">
  Ditt olivoljeabonnemang levereras snart – {{{renewal_date}}}
</div>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1e7db;padding:40px 16px;">
<tr>
<td align="center">

<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:32px;">

<tr>
<td align="center">
<img src="https://cdn.prod.website-files.com/676d596f9615722376dfe2fc/695c27864df0f98b1754712a_olivkassen-logo%402x.png"
width="120" style="margin-bottom:24px;" />
</td>
</tr>

<tr>
<td style="font-size:15px;line-height:1.6;color:#000000;">

<p>Hej {{name}},</p>

<p>
Det är snart dags för nästa leverans i ditt olivoljeabonnemang:
<strong>{{product_title}}</strong> – levereras <strong>{{plan_interval}}</strong>.
</p>

<p>
Paketet skickas till ditt närmaste DHL- eller Schenker-ombud.
Om du vill uppdatera dina betalningsuppgifter, ändra leveransintervall
eller göra andra justeringar i ditt abonnemang gör du det enkelt via vår kundportal:
</p>

<p>
👉 <a href="https://olivkassen.com/kundportal" style="color:#000000;text-decoration:none;">
<strong>Kundportal</strong>
</a>
</p>

<p>
Nästa leverans sker den <strong>{{renewal_date}}</strong>.
</p>

<p>
Tack för att du låter oss vara en del av din matlagning.
Det betyder mycket för oss att få leverera vår olivolja till dig
och vi hoppas att den fortsätter att sätta guldkant på dina måltider.
</p>

<p>
Om du har frågor är du välkommen att kontakta oss på
<a href="mailto:kontakt@olivkassen.com" style="color:#000000;text-decoration:none;">
kontakt@olivkassen.com
</a>
</p>

<p>
Varma hälsningar,<br>
<strong>Olivkassen</strong>
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
  await resend.templates.update(TEMPLATE_ID, {
    name: "Olivkassen Renewal Reminder",
    subject: "Snart dags för nästa leverans",
    preview: "Ditt olivoljeabonnemang levereras snart – {{{renewal_date}}}",
    html
  });

  console.log("✅ Template updated successfully");
}

updateTemplate();
