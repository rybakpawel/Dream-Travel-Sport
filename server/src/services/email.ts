import { Resend } from "resend";

import type { Env } from "../env.js";

export type EmailService = {
  sendMagicLink: (params: {
    to: string;
    customerName?: string;
    magicLink: string;
    pointsAvailable: number;
    expiresInMinutes: number;
  }) => Promise<void>;
  sendOrderConfirmation: (params: {
    to: string;
    customerName: string;
    orderNumber: string;
    totalCents: number;
    currency: string;
    items: Array<{ name: string; qty: number; priceCents: number }>;
  }) => Promise<void>;
  sendPaymentInstructions: (params: {
    to: string;
    customerName: string;
    orderNumber: string;
    totalCents: number;
    currency: string;
    bankAccount?: string;
  }) => Promise<void>;
  sendPaymentConfirmation: (params: {
    to: string;
    customerName: string;
    orderNumber: string;
    totalCents: number;
    currency: string;
    pointsEarned: number;
  }) => Promise<void>;
  sendNewsletterWelcome: (params: {
    to: string;
    name?: string;
  }) => Promise<void>;
};

function formatPrice(cents: number, currency: string): string {
  return `${(cents / 100).toLocaleString("pl-PL")} ${currency}`;
}

function createEmailServiceInternal(env: Env): EmailService | null {
  if (!env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not configured - emails will not be sent");
    return null;
  }

  const resend = new Resend(env.RESEND_API_KEY);

  return {
    async sendMagicLink({ to, customerName, magicLink, pointsAvailable, expiresInMinutes }) {
      const greeting = customerName ? `Cześć ${customerName}!` : "Cześć!";
      const pointsText = pointsAvailable === 1 ? "punkt" : pointsAvailable < 5 ? "punkty" : "punktów";

      const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Użyj Dream Points</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #020712 0%, #0a1a2e 100%); padding: 40px 30px; border-radius: 12px; margin-bottom: 20px;">
    <h1 style="color: #f6b41c; margin: 0 0 10px 0; font-size: 28px;">Dream Travel Sport</h1>
    <p style="color: #999; margin: 0; font-size: 14px;">sportowe wyjazdy premium</p>
  </div>

  <div style="background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #020712; margin-top: 0;">${greeting}</h2>
    
    <p>Masz do wykorzystania <strong style="color: #f6b41c;">${pointsAvailable} ${pointsText}</strong> Dream Points!</p>
    
    <p>Kliknij poniższy link, aby użyć swoich punktów podczas finalizacji zakupu:</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${magicLink}" style="display: inline-block; background: #f6b41c; color: #020712; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Użyj Dream Points</a>
    </div>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      <strong>Ważne:</strong> Link jest ważny przez ${expiresInMinutes} minut. Po kliknięciu zostaniesz przekierowany do koszyka, gdzie będziesz mógł finalizować zakup z wykorzystaniem punktów.
    </p>
    
    <p style="color: #666; font-size: 14px; margin-top: 20px;">
      Jeśli nie prosiłeś o ten link, możesz go zignorować.
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
${greeting}

Masz do wykorzystania ${pointsAvailable} ${pointsText} Dream Points!

Kliknij poniższy link, aby użyć swoich punktów podczas finalizacji zakupu:

${magicLink}

Ważne: Link jest ważny przez ${expiresInMinutes} minut.

Jeśli nie prosiłeś o ten link, możesz go zignorować.

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
          to: [to],
          subject: `Użyj ${pointsAvailable} Dream Points w swoim zamówieniu`,
          html,
          text
        });
        console.log(`[email] Magic link sent to ${to}`);
      } catch (err) {
        console.error(`[email] Failed to send magic link to ${to}:`, err);
        throw err;
      }
    },

    async sendOrderConfirmation({ to, customerName, orderNumber, totalCents, currency, items }) {
      const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Potwierdzenie rezerwacji</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #020712 0%, #0a1a2e 100%); padding: 40px 30px; border-radius: 12px; margin-bottom: 20px;">
    <h1 style="color: #f6b41c; margin: 0 0 10px 0; font-size: 28px;">Dream Travel Sport</h1>
    <p style="color: #999; margin: 0; font-size: 14px;">sportowe wyjazdy premium</p>
  </div>

  <div style="background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #020712; margin-top: 0;">Dziękujemy za rezerwację, ${customerName}!</h2>
    
    <p>Twoja rezerwacja została przyjęta. Numer zamówienia: <strong style="color: #f6b41c;">${orderNumber}</strong></p>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #020712; font-size: 18px;">Szczegóły zamówienia:</h3>
      <table style="width: 100%; border-collapse: collapse;">
        ${items
          .map(
            (item) => `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${item.name}</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${item.qty} × ${formatPrice(item.priceCents, currency)}</td>
        </tr>
        `
          )
          .join("")}
        <tr>
          <td style="padding: 12px 0 8px 0; font-weight: 600; color: #020712;">Suma:</td>
          <td style="padding: 12px 0 8px 0; text-align: right; font-weight: 600; color: #f6b41c; font-size: 18px;">${formatPrice(totalCents, currency)}</td>
        </tr>
      </table>
    </div>
    
    <p>Wkrótce skontaktujemy się z Tobą mailowo lub telefonicznie, aby potwierdzić szczegóły i wysłać umowę do podpisu online.</p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Jeśli masz pytania, skontaktuj się z nami: <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c;">kontakt@dreamtravelsport.pl</a>
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
Dziękujemy za rezerwację, ${customerName}!

Twoja rezerwacja została przyjęta. Numer zamówienia: ${orderNumber}

Szczegóły zamówienia:
${items.map((item) => `- ${item.name}: ${item.qty} × ${formatPrice(item.priceCents, currency)}`).join("\n")}

Suma: ${formatPrice(totalCents, currency)}

Wkrótce skontaktujemy się z Tobą mailowo lub telefonicznie, aby potwierdzić szczegóły i wysłać umowę do podpisu online.

Jeśli masz pytania, skontaktuj się z nami: kontakt@dreamtravelsport.pl

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
          to: [to],
          subject: `Potwierdzenie rezerwacji ${orderNumber} - Dream Travel Sport`,
          html,
          text
        });
        console.log(`[email] Order confirmation sent to ${to} for order ${orderNumber}`);
      } catch (err) {
        console.error(`[email] Failed to send order confirmation to ${to}:`, err);
        throw err;
      }
    },

    async sendPaymentInstructions({ to, customerName, orderNumber, totalCents, currency, bankAccount }) {
      const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Instrukcje płatności</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #020712 0%, #0a1a2e 100%); padding: 40px 30px; border-radius: 12px; margin-bottom: 20px;">
    <h1 style="color: #f6b41c; margin: 0 0 10px 0; font-size: 28px;">Dream Travel Sport</h1>
    <p style="color: #999; margin: 0; font-size: 14px;">sportowe wyjazdy premium</p>
  </div>

  <div style="background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #020712; margin-top: 0;">Instrukcje płatności</h2>
    
    <p>Cześć ${customerName},</p>
    
    <p>Dziękujemy za złożenie rezerwacji <strong style="color: #f6b41c;">${orderNumber}</strong>.</p>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #020712; font-size: 18px;">Dane do przelewu:</h3>
      ${bankAccount ? `<p style="font-family: monospace; background: #fff; padding: 15px; border-radius: 6px; margin: 10px 0;">${bankAccount.replace(/\n/g, "<br>")}</p>` : "<p>Szczegóły płatności zostaną przesłane w osobnej wiadomości.</p>"}
      <p style="margin: 15px 0 0 0;"><strong>Kwota do zapłaty:</strong> <span style="color: #f6b41c; font-size: 20px; font-weight: 600;">${formatPrice(totalCents, currency)}</span></p>
      <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;"><strong>Tytuł przelewu:</strong> ${orderNumber}</p>
    </div>
    
    <p style="color: #666; font-size: 14px; margin-top: 20px;">
      <strong>Ważne:</strong> Po otrzymaniu płatności skontaktujemy się z Tobą, aby potwierdzić rezerwację i wysłać umowę do podpisu online.
    </p>
    
    <p style="color: #666; font-size: 14px;">
      Jeśli masz pytania dotyczące płatności, skontaktuj się z nami: <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c;">kontakt@dreamtravelsport.pl</a>
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
Instrukcje płatności

Cześć ${customerName},

Dziękujemy za złożenie rezerwacji ${orderNumber}.

Dane do przelewu:
${bankAccount || "Szczegóły płatności zostaną przesłane w osobnej wiadomości."}

Kwota do zapłaty: ${formatPrice(totalCents, currency)}
Tytuł przelewu: ${orderNumber}

Ważne: Po otrzymaniu płatności skontaktujemy się z Tobą, aby potwierdzić rezerwację i wysłać umowę do podpisu online.

Jeśli masz pytania dotyczące płatności, skontaktuj się z nami: kontakt@dreamtravelsport.pl

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
          to: [to],
          subject: `Instrukcje płatności - Zamówienie ${orderNumber}`,
          html,
          text
        });
        console.log(`[email] Payment instructions sent to ${to} for order ${orderNumber}`);
      } catch (err) {
        console.error(`[email] Failed to send payment instructions to ${to}:`, err);
        throw err;
      }
    },

    async sendPaymentConfirmation({ to, customerName, orderNumber, totalCents, currency, pointsEarned }) {
      const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Płatność potwierdzona</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #020712 0%, #0a1a2e 100%); padding: 40px 30px; border-radius: 12px; margin-bottom: 20px;">
    <h1 style="color: #f6b41c; margin: 0 0 10px 0; font-size: 28px;">Dream Travel Sport</h1>
    <p style="color: #999; margin: 0; font-size: 14px;">sportowe wyjazdy premium</p>
  </div>

  <div style="background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #020712; margin-top: 0;">Płatność potwierdzona! 🎉</h2>
    
    <p>Cześć ${customerName},</p>
    
    <p>Twoja płatność za zamówienie <strong style="color: #f6b41c;">${orderNumber}</strong> została potwierdzona.</p>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0;"><strong>Kwota:</strong> <span style="color: #f6b41c; font-size: 20px; font-weight: 600;">${formatPrice(totalCents, currency)}</span></p>
    </div>
    
    ${pointsEarned > 0 ? `
    <div style="background: linear-gradient(135deg, #f6b41c 0%, #f9c84a 100%); padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <p style="margin: 0; color: #020712; font-size: 18px; font-weight: 600;">
        🎁 Otrzymałeś ${pointsEarned} ${pointsEarned === 1 ? "punkt" : pointsEarned < 5 ? "punkty" : "punktów"} Dream Points!
      </p>
      <p style="margin: 10px 0 0 0; color: #020712; font-size: 14px;">
        Możesz je wykorzystać przy następnym zakupie.
      </p>
    </div>
    ` : ""}
    
    <p>Wkrótce skontaktujemy się z Tobą, aby potwierdzić szczegóły wyjazdu i wysłać umowę do podpisu online.</p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Jeśli masz pytania, skontaktuj się z nami: <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c;">kontakt@dreamtravelsport.pl</a>
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
Płatność potwierdzona! 🎉

Cześć ${customerName},

Twoja płatność za zamówienie ${orderNumber} została potwierdzona.

Kwota: ${formatPrice(totalCents, currency)}

${pointsEarned > 0 ? `🎁 Otrzymałeś ${pointsEarned} ${pointsEarned === 1 ? "punkt" : pointsEarned < 5 ? "punkty" : "punktów"} Dream Points! Możesz je wykorzystać przy następnym zakupie.\n\n` : ""}Wkrótce skontaktujemy się z Tobą, aby potwierdzić szczegóły wyjazdu i wysłać umowę do podpisu online.

Jeśli masz pytania, skontaktuj się z nami: kontakt@dreamtravelsport.pl

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
          to: [to],
          subject: `Płatność potwierdzona - Zamówienie ${orderNumber}`,
          html,
          text
        });
        console.log(`[email] Payment confirmation sent to ${to} for order ${orderNumber}`);
      } catch (err) {
        console.error(`[email] Failed to send payment confirmation to ${to}:`, err);
        throw err;
      }
    },

    async sendNewsletterWelcome({ to, name }) {
      const greeting = name ? `Cześć ${name}!` : "Cześć!";

      const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Witamy w newsletterze</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #020712 0%, #0a1a2e 100%); padding: 40px 30px; border-radius: 12px; margin-bottom: 20px;">
    <h1 style="color: #f6b41c; margin: 0 0 10px 0; font-size: 28px;">Dream Travel Sport</h1>
    <p style="color: #999; margin: 0; font-size: 14px;">sportowe wyjazdy premium</p>
  </div>

  <div style="background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #020712; margin-top: 0;">${greeting}</h2>
    
    <p>Dziękujemy za zapisanie się do newslettera Dream Travel Sport! 🎉</p>
    
    <p>Od teraz będziesz na bieżąco z:</p>
    <ul style="color: #333; line-height: 1.8;">
      <li>Najnowszymi wyjazdami sportowymi</li>
      <li>Ekskluzywnymi ofertami i promocjami</li>
      <li>Wydarzeniami i spotkaniami</li>
      <li>Inspiracjami do podróży</li>
    </ul>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: center;">
      <p style="margin: 0; color: #020712; font-size: 18px; font-weight: 600;">
        Nie przegap żadnej okazji na niezapomniany wyjazd!
      </p>
    </div>
    
    <p style="margin-top: 30px;">
      <a href="${env.CORS_ORIGIN}/index.html#oferta" style="display: inline-block; background: #f6b41c; color: #020712; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Sprawdź dostępne wyjazdy</a>
    </p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Jeśli masz pytania lub chcesz się z nami skontaktować, napisz do nas: <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c;">kontakt@dreamtravelsport.pl</a>
    </p>
    
    <p style="color: #666; font-size: 14px; margin-top: 20px;">
      Jeśli nie chcesz otrzymywać naszych wiadomości, możesz w każdej chwili wypisać się z newslettera, klikając link w stopce wiadomości.
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
    <p style="margin-top: 10px;">
      <a href="${env.CORS_ORIGIN}/index.html" style="color: #999; text-decoration: none;">Odwiedź naszą stronę</a> |
      <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #999; text-decoration: none;">Kontakt</a>
    </p>
  </div>
</body>
</html>
      `.trim();

      const text = `
${greeting}

Dziękujemy za zapisanie się do newslettera Dream Travel Sport! 🎉

Od teraz będziesz na bieżąco z:
- Najnowszymi wyjazdami sportowymi
- Ekskluzywnymi ofertami i promocjami
- Wydarzeniami i spotkaniami
- Inspiracjami do podróży

Nie przegap żadnej okazji na niezapomniany wyjazd!

Sprawdź dostępne wyjazdy: ${env.CORS_ORIGIN}/index.html#oferta

Jeśli masz pytania lub chcesz się z nami skontaktować, napisz do nas: kontakt@dreamtravelsport.pl

Jeśli nie chcesz otrzymywać naszych wiadomości, możesz w każdej chwili wypisać się z newslettera.

---
Dream Travel Sport | sportowe wyjazdy premium
${env.CORS_ORIGIN}/index.html
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
          to: [to],
          subject: "Witamy w newsletterze Dream Travel Sport! 🎉",
          html,
          text
        });
        console.log(`[email] Newsletter welcome sent to ${to}`);
      } catch (err) {
        console.error(`[email] Failed to send newsletter welcome to ${to}:`, err);
        throw err;
      }
    }
  };
}

export function createEmailService(env: Env): EmailService | null {
  return createEmailServiceInternal(env);
}

