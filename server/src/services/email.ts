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
  sendNewsletterWelcome: (params: { to: string; name?: string }) => Promise<void>;
  sendContactForm: (params: {
    to: string; // Email właściciela strony
    fromEmail: string;
    fromName: string;
    company?: string;
    phone?: string;
    message: string;
  }) => Promise<void>;
  sendContactConfirmation: (params: { to: string; name: string }) => Promise<void>;
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

  // Użyj nowych zmiennych lub fallback do starej (backward compatibility)
  const systemFromEmail = env.RESEND_FROM_EMAIL_SYSTEM || env.RESEND_FROM_EMAIL;
  const contactFromEmail = env.RESEND_FROM_EMAIL_CONTACT || env.RESEND_FROM_EMAIL;

  return {
    async sendMagicLink({ to, customerName, magicLink, pointsAvailable, expiresInMinutes }) {
      const greeting = customerName ? `Cześć ${customerName},` : "Cześć,";
      const pointsText =
        pointsAvailable === 1 ? "punkt" : pointsAvailable < 5 ? "punkty" : "punktów";

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
    <p style="color: #333; margin-top: 0;">${greeting}</p>
    
    <p style="color: #333;">Masz do wykorzystania <strong style="color: #f6b41c;">${pointsAvailable} ${pointsText}</strong> Dream Points! 🎁</p>
    
    <p style="color: #333;">To Twoje punkty lojalnościowe, które możesz wykorzystać przy zakupie wyjazdu. Każdy punkt to realna zniżka na kolejny wyjazd.</p>
    
    <p style="color: #333; margin-top: 20px;">Kliknij poniższy link, aby przejść do koszyka i wykorzystać swoje punkty:</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${magicLink}" style="display: inline-block; background: #f6b41c; color: #020712; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Użyj Dream Points</a>
    </div>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f6b41c;">
      <p style="color: #020712; margin: 0 0 10px 0; font-weight: 600; font-size: 15px;">📌 Ważne:</p>
      <ul style="color: #666; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
        <li>Link jest ważny przez ${expiresInMinutes} minut</li>
        <li>Po kliknięciu zostaniesz przekierowany do koszyka</li>
        <li>Punkty zostaną automatycznie zastosowane podczas finalizacji zakupu</li>
      </ul>
    </div>
    
    <p style="color: #666; font-size: 14px; margin-top: 20px;">
      Jeśli nie prosiłeś o ten link, możesz go zignorować.
    </p>
    
    <p style="color: #333; margin-top: 30px;">Marcin Haładuda</p>
    <p style="color: #333; margin: 5px 0;"><strong>Dream Travel Sport</strong></p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      📞 +48 793 020 092<br>
      ✉️ <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c;">kontakt@dreamtravelsport.pl</a>
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

Masz do wykorzystania ${pointsAvailable} ${pointsText} Dream Points! 🎁

To Twoje punkty lojalnościowe, które możesz wykorzystać przy zakupie wyjazdu. Każdy punkt to realna zniżka na kolejny wyjazd.

Kliknij poniższy link, aby przejść do koszyka i wykorzystać swoje punkty:

${magicLink}

📌 Ważne:
– Link jest ważny przez ${expiresInMinutes} minut
– Po kliknięciu zostaniesz przekierowany do koszyka
– Punkty zostaną automatycznie zastosowane podczas finalizacji zakupu

Jeśli nie prosiłeś o ten link, możesz go zignorować.

Marcin Haładuda
Dream Travel Sport

📞 +48 793 020 092
✉️ kontakt@dreamtravelsport.pl

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${systemFromEmail}>`,
          to: [to],
          subject: `Twoje Dream Points czekają na wykorzystanie 🎁`,
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
      const frontendUrl = env.CORS_ORIGIN.replace(/\/$/, "");
      const statusUrl = `${frontendUrl}/platnosc.html?order=${encodeURIComponent(orderNumber)}`;

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
    <h2 style="color: #020712; margin-top: 0; font-size: 24px;">Rezerwacja przyjęta – ostatni krok do wyjazdu ⚽</h2>
    
    <p style="color: #333; margin-top: 20px;">Cześć,</p>
    
    <p style="color: #333;">potwierdzamy, że Twoja rezerwacja w Dream Travel Sport została złożona.</p>
    
    <p style="color: #333; margin-top: 20px;">Teraz ważna informacja organizacyjna 👇</p>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f6b41c;">
      <p style="color: #020712; margin: 0 0 10px 0; font-weight: 600; font-size: 15px;">🔹 Jeżeli wybrałeś/aś płatność online</p>
      <p style="color: #666; margin: 0 0 15px 0; font-size: 14px; line-height: 1.6;">
        Możesz sprawdzić status płatności i dokończyć transakcję klikając poniższy link:
      </p>
      <div style="text-align: center;">
        <a href="${statusUrl}" style="display: inline-block; background: #f6b41c; color: #020712; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">Sprawdź status płatności</a>
      </div>
      <p style="color: #666; margin: 15px 0 0 0; font-size: 13px; line-height: 1.6;">
        Sprawdź proszę także folder SPAM / Oferty, jeśli mail nie dotrze w ciągu kilku minut.
      </p>
    </div>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f6b41c;">
      <p style="color: #020712; margin: 0 0 10px 0; font-weight: 600; font-size: 15px;">🔹 Jeżeli wybrałeś/aś przelew tradycyjny</p>
      <p style="color: #666; margin: 0; font-size: 14px; line-height: 1.6;">
        W osobnej wiadomości otrzymasz od nas instrukcję przelewu.
      </p>
    </div>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f6b41c;">
      <p style="color: #020712; margin: 0 0 10px 0; font-weight: 600; font-size: 15px;">📌 Ważne</p>
      <ul style="color: #666; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
        <li>rezerwacja zostaje potwierdzona po zaksięgowaniu płatności,</li>
        <li>po opłaceniu otrzymasz maila z pełnym potwierdzeniem wyjazdu,</li>
        <li>szczegóły organizacyjne (bilety, harmonogram, dokumenty) dosyłamy bliżej terminu wydarzenia.</li>
      </ul>
    </div>
    
    <p style="color: #333; margin-top: 30px;">Jeśli cokolwiek jest niejasne — odezwij się od razu.</p>
    <p style="color: #333; margin-bottom: 30px;">Jesteśmy po to, żeby to było proste i bez nerwów.</p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      📞 +48 793 020 092<br>
      ✉️ <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c;">kontakt@dreamtravelsport.pl</a>
    </p>
    
    <p style="color: #333; margin-top: 30px;">Do usłyszenia,</p>
    <p style="color: #333; margin: 5px 0;"><strong>Zespół Dream Travel Sport</strong></p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
Rezerwacja przyjęta – ostatni krok do wyjazdu ⚽

Cześć,

potwierdzamy, że Twoja rezerwacja w Dream Travel Sport została złożona.

Teraz ważna informacja organizacyjna 👇

🔹 Jeżeli wybrałeś/aś płatność online
Możesz sprawdzić status płatności i dokończyć transakcję klikając poniższy link:
${statusUrl}

Sprawdź proszę także folder SPAM / Oferty, jeśli mail nie dotrze w ciągu kilku minut.

🔹 Jeżeli wybrałeś/aś przelew tradycyjny
W osobnej wiadomości otrzymasz od nas instrukcję przelewu.

📌 Ważne
– rezerwacja zostaje potwierdzona po zaksięgowaniu płatności,
– po opłaceniu otrzymasz maila z pełnym potwierdzeniem wyjazdu,
– szczegóły organizacyjne (bilety, harmonogram, dokumenty) dosyłamy bliżej terminu wydarzenia.

Jeśli cokolwiek jest niejasne — odezwij się od razu.
Jesteśmy po to, żeby to było proste i bez nerwów.

📞 +48 793 020 092
✉️ kontakt@dreamtravelsport.pl

Do usłyszenia,
Zespół Dream Travel Sport

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${systemFromEmail}>`,
          to: [to],
          subject: "Rezerwacja przyjęta – ostatni krok do wyjazdu ⚽",
          html,
          text
        });
        console.log(`[email] Order confirmation sent to ${to} for order ${orderNumber}`);
      } catch (err) {
        console.error(`[email] Failed to send order confirmation to ${to}:`, err);
        throw err;
      }
    },

    async sendPaymentInstructions({
      to,
      customerName,
      orderNumber,
      totalCents,
      currency,
      bankAccount
    }) {
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
    <p style="color: #333; margin-top: 0;">Cześć ${customerName},</p>
    
    <p style="color: #333;">Dzięki za złożenie rezerwacji! ⚽</p>
    
    <p style="color: #333; margin-top: 20px;">Teraz ostatni krok – przelew tradycyjny. Poniżej znajdziesz wszystkie potrzebne dane.</p>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f6b41c;">
      ${bankAccount ? `<div style="font-family: monospace; background: #fff; padding: 15px; border-radius: 6px; margin-bottom: 15px; white-space: pre-wrap;">${bankAccount}</div>` : '<p style="color: #666; margin-bottom: 15px;">Szczegóły płatności zostaną przesłane w osobnej wiadomości.</p>'}
      <p style="margin: 0 0 10px 0; color: #020712;"><strong>Kwota do zapłaty:</strong> <span style="color: #f6b41c; font-size: 20px; font-weight: 600;">${formatPrice(totalCents, currency)}</span></p>
      <p style="margin: 0; color: #666; font-size: 14px;"><strong>Tytuł przelewu:</strong> ${orderNumber}</p>
    </div>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f6b41c;">
      <p style="color: #020712; margin: 0 0 10px 0; font-weight: 600; font-size: 15px;">📌 Co dalej?</p>
      <ul style="color: #666; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
        <li>Po zaksięgowaniu płatności otrzymasz od nas maila z potwierdzeniem</li>
        <li>Rezerwacja zostanie ostatecznie potwierdzona po otrzymaniu środków</li>
        <li>Wszystkie szczegóły organizacyjne dostaniesz bliżej terminu wyjazdu</li>
      </ul>
    </div>
    
    <p style="color: #333; margin-top: 20px;">Jeśli masz jakiekolwiek pytania dotyczące płatności – po prostu napisz do nas maila. Rozmawiamy normalnie, bez infolinii i automatów.</p>
    
    <p style="color: #333; margin-top: 30px;">Marcin Haładuda</p>
    <p style="color: #333; margin: 5px 0;"><strong>Dream Travel Sport</strong></p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      📞 +48 793 020 092<br>
      ✉️ <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c;">kontakt@dreamtravelsport.pl</a>
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
Cześć ${customerName},

Dzięki za złożenie rezerwacji! ⚽

Teraz ostatni krok – przelew tradycyjny. Poniżej znajdziesz wszystkie potrzebne dane.

Dane do przelewu:
${bankAccount || "Szczegóły płatności zostaną przesłane w osobnej wiadomości."}

Kwota do zapłaty: ${formatPrice(totalCents, currency)}
Tytuł przelewu: ${orderNumber}

📌 Co dalej?
– Po zaksięgowaniu płatności otrzymasz od nas maila z potwierdzeniem
– Rezerwacja zostanie ostatecznie potwierdzona po otrzymaniu środków
– Wszystkie szczegóły organizacyjne dostaniesz bliżej terminu wyjazdu

Jeśli masz jakiekolwiek pytania dotyczące płatności – po prostu napisz do nas maila. Rozmawiamy normalnie, bez infolinii i automatów.

Marcin Haładuda
Dream Travel Sport

📞 +48 793 020 092
✉️ kontakt@dreamtravelsport.pl

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${systemFromEmail}>`,
          to: [to],
          subject: `Dane do przelewu - Zamówienie ${orderNumber} 💳`,
          html,
          text
        });
        console.log(`[email] Payment instructions sent to ${to} for order ${orderNumber}`);
      } catch (err) {
        console.error(`[email] Failed to send payment instructions to ${to}:`, err);
        throw err;
      }
    },

    async sendPaymentConfirmation({
      to,
      customerName,
      orderNumber,
      totalCents,
      currency,
      pointsEarned
    }) {
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
    <h2 style="color: #020712; margin-top: 0; font-size: 24px;">To już oficjalne! 🔥</h2>
    
    <p style="color: #333; margin-top: 20px;">Cześć ${customerName},</p>
    
    <p style="color: #333;">Twoja rezerwacja w Dream Travel Sport została opłacona i potwierdzona.</p>
    <p style="color: #333; font-weight: 600; font-size: 18px; margin: 20px 0;">Wyjazd jest zaklepany. 🔒⚽</p>
    
    <p style="color: #333; margin-top: 20px;">Od teraz możesz:</p>
    <ul style="color: #666; margin: 10px 0 20px 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
      <li>przestać się zastanawiać „czy się uda",</li>
      <li>przestać sprawdzać ceny, dostępność i fora,</li>
      <li>zaczać odliczać dni do meczu.</li>
    </ul>
    
    ${
      pointsEarned > 0
        ? `
    <div style="background: linear-gradient(135deg, #f6b41c 0%, #f9c84a 100%); padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <p style="margin: 0; color: #020712; font-size: 18px; font-weight: 600;">
        🎁 Otrzymałeś ${pointsEarned} ${pointsEarned === 1 ? "punkt" : pointsEarned < 5 ? "punkty" : "punktów"} Dream Points!
      </p>
      <p style="margin: 10px 0 0 0; color: #020712; font-size: 14px;">
        Możesz je wykorzystać przy następnym zakupie.
      </p>
    </div>
    `
        : ""
    }
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f6b41c;">
      <p style="color: #020712; margin: 0 0 10px 0; font-weight: 600; font-size: 15px;">📌 Co dalej?</p>
      <ul style="color: #666; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
        <li>bilety, hotel i logistyka są po naszej stronie,</li>
        <li>bliżej wyjazdu dostaniesz komplet informacji organizacyjnych,</li>
        <li>w razie jakichkolwiek pytań masz bezpośredni kontakt z DTS – bez infolinii i automatów.</li>
      </ul>
    </div>
    
    <p style="color: #333; margin-top: 20px;">Robimy to po to, żebyś skupił/a się na przeżyciu, a nie na organizacyjnym chaosie.</p>
    
    <p style="color: #333; margin-top: 20px; font-weight: 600;">Gratulacje dobrej decyzji.</p>
    <p style="color: #333; margin-bottom: 30px;">Do zobaczenia na stadionie.</p>
    
    <p style="color: #333; margin-top: 30px;">Marcin Haładuda</p>
    <p style="color: #333; margin: 5px 0;"><strong>Dream Travel Sport</strong></p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      📞 +48 793 020 092<br>
      ✉️ <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c;">kontakt@dreamtravelsport.pl</a>
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
To już oficjalne! 🔥

Cześć ${customerName},

Twoja rezerwacja w Dream Travel Sport została opłacona i potwierdzona.
Wyjazd jest zaklepany. 🔒⚽

Od teraz możesz:
– przestać się zastanawiać „czy się uda",
– przestać sprawdzać ceny, dostępność i fora,
– zacząć odliczać dni do meczu.

${pointsEarned > 0 ? `🎁 Otrzymałeś ${pointsEarned} ${pointsEarned === 1 ? "punkt" : pointsEarned < 5 ? "punkty" : "punktów"} Dream Points! Możesz je wykorzystać przy następnym zakupie.\n\n` : ""}📌 Co dalej?
– bilety, hotel i logistyka są po naszej stronie,
– bliżej wyjazdu dostaniesz komplet informacji organizacyjnych,
– w razie jakichkolwiek pytań masz bezpośredni kontakt z DTS – bez infolinii i automatów.

Robimy to po to, żebyś skupił/a się na przeżyciu, a nie na organizacyjnym chaosie.

Gratulacje dobrej decyzji.
Do zobaczenia na stadionie.

Marcin Haładuda
Dream Travel Sport

📞 +48 793 020 092
✉️ kontakt@dreamtravelsport.pl

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${systemFromEmail}>`,
          to: [to],
          subject: `Masz to. Wyjazd jest zaklepany 🔒⚽`,
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
      const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Witaj w Dream Travel Sport</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #020712 0%, #0a1a2e 100%); padding: 40px 30px; border-radius: 12px; margin-bottom: 20px;">
    <h1 style="color: #f6b41c; margin: 0 0 10px 0; font-size: 28px;">Dream Travel Sport</h1>
    <p style="color: #999; margin: 0; font-size: 14px;">sportowe wyjazdy premium</p>
  </div>

  <div style="background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #020712; margin-top: 0; font-size: 24px;">Witaj w Dream Travel Sport – zaczynamy 🚀</h2>
    
    <p style="color: #333; margin-top: 20px;">Cześć,</p>
    
    <p style="color: #333;">dzięki za zapis do newslettera Dream Travel Sport.</p>
    
    <p style="color: #333; margin-top: 20px;">Od teraz będziesz otrzymywać ode mnie:</p>
    <ul style="color: #333; line-height: 1.8; margin: 15px 0; padding-left: 20px;">
      <li>informacje o wyjazdach na topowe mecze w Europie,</li>
      <li>konkretne tipy jak zorganizować wyjazd meczowy mądrze i bezpiecznie,</li>
      <li>zaproszenia do limitowanych ofert i terminów, których często nie publikujemy publicznie.</li>
    </ul>
    
    <p style="color: #333; margin-top: 20px;">Nie wysyłam spamu.</p>
    <p style="color: #333;">Piszę tylko wtedy, gdy naprawdę jest o czym.</p>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #f6b41c;">
      <p style="color: #020712; margin: 0 0 10px 0; font-weight: 600; font-size: 15px;">📌 Dlaczego dostajesz tego maila?</p>
      <p style="color: #666; margin: 0; font-size: 14px; line-height: 1.6;">
        Bo zapisałeś/aś się dobrowolnie na newsletter Dream Travel Sport i wyraziłeś/aś zgodę na kontakt mailowy.<br>
        Twoje dane są przetwarzane zgodnie z RODO – możesz w każdej chwili zrezygnować z subskrypcji jednym kliknięciem.
      </p>
    </div>
    
    <p style="color: #333; margin-top: 30px;">Jeśli masz pytania lub już teraz myślisz o konkretnym meczu – po prostu odpisz na tego maila.</p>
    <p style="color: #333; margin-bottom: 30px;">Rozmawiamy normalnie, po ludzku.</p>
    
    <p style="color: #333; margin-top: 30px;">Do zobaczenia na stadionach,</p>
    <p style="color: #333; margin: 5px 0;"><strong>Marcin Haładuda</strong></p>
    <p style="color: #333; margin: 5px 0;">Dream Travel Sport</p>
    <p style="color: #333; margin: 5px 0;">📞 +48 780 546 904</p>
    <p style="color: #333; margin: 5px 0;">✉️ <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c; text-decoration: none;">kontakt@dreamtravelsport.pl</a></p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
Witaj w Dream Travel Sport – zaczynamy 🚀

Cześć,

dzięki za zapis do newslettera Dream Travel Sport.

Od teraz będziesz otrzymywać ode mnie:
– informacje o wyjazdach na topowe mecze w Europie,
– konkretne tipy jak zorganizować wyjazd meczowy mądrze i bezpiecznie,
– zaproszenia do limitowanych ofert i terminów, których często nie publikujemy publicznie.

Nie wysyłam spamu.
Piszę tylko wtedy, gdy naprawdę jest o czym.

📌 Dlaczego dostajesz tego maila?
Bo zapisałeś/aś się dobrowolnie na newsletter Dream Travel Sport i wyraziłeś/aś zgodę na kontakt mailowy.
Twoje dane są przetwarzane zgodnie z RODO – możesz w każdej chwili zrezygnować z subskrypcji jednym kliknięciem.

Jeśli masz pytania lub już teraz myślisz o konkretnym meczu – po prostu odpisz na tego maila.
Rozmawiamy normalnie, po ludzku.

Do zobaczenia na stadionach,
Marcin Haładuda
Dream Travel Sport
📞 +48 780 546 904
✉️ kontakt@dreamtravelsport.pl

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${systemFromEmail}>`,
          to: [to],
          subject: "Witaj w Dream Travel Sport – zaczynamy 🚀",
          html,
          text
        });
        console.log(`[email] Newsletter welcome sent to ${to}`);
      } catch (err) {
        console.error(`[email] Failed to send newsletter welcome to ${to}:`, err);
        throw err;
      }
    },

    async sendContactForm({ to, fromEmail, fromName, company, phone, message }) {
      const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nowa wiadomość z formularza współpracy</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #020712 0%, #0a1a2e 100%); padding: 40px 30px; border-radius: 12px; margin-bottom: 20px;">
    <h1 style="color: #f6b41c; margin: 0 0 10px 0; font-size: 28px;">Dream Travel Sport</h1>
    <p style="color: #999; margin: 0; font-size: 14px;">sportowe wyjazdy premium</p>
  </div>

  <div style="background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #020712; margin-top: 0; font-size: 24px;">Nowa wiadomość z formularza współpracy</h2>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f6b41c;">
      <p style="margin: 0 0 10px 0; color: #020712;"><strong>Od:</strong> ${fromName}</p>
      <p style="margin: 0 0 10px 0; color: #020712;"><strong>E-mail:</strong> <a href="mailto:${fromEmail}" style="color: #f6b41c;">${fromEmail}</a></p>
      ${company ? `<p style="margin: 0 0 10px 0; color: #020712;"><strong>Firma:</strong> ${company}</p>` : ""}
      ${phone ? `<p style="margin: 0 0 10px 0; color: #020712;"><strong>Telefon:</strong> ${phone}</p>` : ""}
    </div>
    
    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0 0 10px 0; color: #020712; font-weight: 600;">Wiadomość:</p>
      <p style="margin: 0; color: #666; white-space: pre-wrap;">${message}</p>
    </div>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Odpowiedz na tego maila, aby skontaktować się z ${fromName}.
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
Nowa wiadomość z formularza współpracy

Od: ${fromName}
E-mail: ${fromEmail}
${company ? `Firma: ${company}\n` : ""}${phone ? `Telefon: ${phone}\n` : ""}
Wiadomość:
${message}

Odpowiedz na tego maila, aby skontaktować się z ${fromName}.
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${contactFromEmail}>`,
          to: [to],
          replyTo: fromEmail,
          subject: `Nowa wiadomość z formularza współpracy od ${fromName}`,
          html,
          text
        });
        console.log(`[email] Contact form sent to ${to} from ${fromEmail}`);
      } catch (err) {
        console.error(`[email] Failed to send contact form to ${to}:`, err);
        throw err;
      }
    },

    async sendContactConfirmation({ to, name }) {
      const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Potwierdzenie otrzymania wiadomości</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #020712 0%, #0a1a2e 100%); padding: 40px 30px; border-radius: 12px; margin-bottom: 20px;">
    <h1 style="color: #f6b41c; margin: 0 0 10px 0; font-size: 28px;">Dream Travel Sport</h1>
    <p style="color: #999; margin: 0; font-size: 14px;">sportowe wyjazdy premium</p>
  </div>

  <div style="background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #020712; margin-top: 0; font-size: 24px;">Dziękujemy za wiadomość! ✉️</h2>
    
    <p style="color: #333; margin-top: 20px;">Cześć ${name},</p>
    
    <p style="color: #333;">Otrzymaliśmy Twoją wiadomość z formularza współpracy i skontaktujemy się z Tobą w ciągu 24 godzin.</p>
    
    <p style="color: #333; margin-top: 20px;">Jeśli masz pilne pytania, możesz również skontaktować się z nami bezpośrednio:</p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      📞 +48 793 020 092<br>
      ✉️ <a href="mailto:kontakt@dreamtravelsport.pl" style="color: #f6b41c;">kontakt@dreamtravelsport.pl</a>
    </p>
    
    <p style="color: #333; margin-top: 30px;">Do usłyszenia,</p>
    <p style="color: #333; margin: 5px 0;"><strong>Zespół Dream Travel Sport</strong></p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
    <p>Dream Travel Sport | sportowe wyjazdy premium</p>
  </div>
</body>
</html>
      `.trim();

      const text = `
Dziękujemy za wiadomość! ✉️

Cześć ${name},

Otrzymaliśmy Twoją wiadomość z formularza współpracy i skontaktujemy się z Tobą w ciągu 24 godzin.

Jeśli masz pilne pytania, możesz również skontaktować się z nami bezpośrednio:

📞 +48 793 020 092
✉️ kontakt@dreamtravelsport.pl

Do usłyszenia,
Zespół Dream Travel Sport

---
Dream Travel Sport | sportowe wyjazdy premium
      `.trim();

      try {
        await resend.emails.send({
          from: `${env.RESEND_FROM_NAME} <${systemFromEmail}>`,
          to: [to],
          subject: "Dziękujemy za wiadomość – Dream Travel Sport",
          html,
          text
        });
        console.log(`[email] Contact confirmation sent to ${to}`);
      } catch (err) {
        console.error(`[email] Failed to send contact confirmation to ${to}:`, err);
        throw err;
      }
    }
  };
}

export function createEmailService(env: Env): EmailService | null {
  return createEmailServiceInternal(env);
}
