import { NewsletterStatus } from "@prisma/client";
import express from "express";
import { Resend } from "resend";
import { z } from "zod";

import type { Env } from "../env.js";
import { createNewsletterRateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../prisma.js";
import type { EmailService } from "../services/email.js";

export function createNewsletterRouter(
  env: Env,
  emailService: EmailService | null
): express.Router {
  const router = express.Router();

  // Rate limiting dla newslettera
  router.use(createNewsletterRateLimiter(env));

  const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
  const configuredAudienceId = env.RESEND_NEWSLETTER_AUDIENCE_ID;
  const configuredAudienceName = env.RESEND_NEWSLETTER_AUDIENCE_NAME?.trim() || undefined;
  const shouldSyncToResend = Boolean(configuredAudienceId || configuredAudienceName);

  let resolvedAudienceId: string | null = null;

  async function resolveNewsletterAudienceId(): Promise<string> {
    if (resolvedAudienceId) return resolvedAudienceId;

    if (configuredAudienceId) {
      resolvedAudienceId = configuredAudienceId;
      return configuredAudienceId;
    }

    if (!configuredAudienceName) {
      throw new Error("RESEND_NEWSLETTER_AUDIENCE_NAME is missing");
    }

    if (!resend) {
      throw new Error("RESEND_API_KEY is missing (newsletter Resend sync is enabled)");
    }

    const listResp = await resend.audiences.list();
    if (listResp.error) {
      throw new Error(
        `[resend] Failed to list audiences: ${listResp.error.name}: ${listResp.error.message}`
      );
    }

    const found = listResp.data?.data?.find(
      (a) => a.name.trim().toLowerCase() === configuredAudienceName.toLowerCase()
    );

    if (found) {
      resolvedAudienceId = found.id;
      return found.id;
    }

    const created = await resend.audiences.create({ name: configuredAudienceName });
    if (created.error) {
      // Możliwy race lub constraint - spróbuj ponownie odczytać listę
      const listAgain = await resend.audiences.list();
      const foundAgain = listAgain.data?.data?.find(
        (a) => a.name.trim().toLowerCase() === configuredAudienceName.toLowerCase()
      );
      if (foundAgain) {
        resolvedAudienceId = foundAgain.id;
        return foundAgain.id;
      }
      throw new Error(
        `[resend] Failed to create audience "${configuredAudienceName}": ${created.error.name}: ${created.error.message}`
      );
    }

    resolvedAudienceId = created.data.id;
    return created.data.id;
  }

  async function upsertResendNewsletterContact(params: { email: string; name?: string | null }) {
    if (!resend) throw new Error("RESEND_API_KEY is missing (newsletter Resend sync is enabled)");
    const newsletterAudienceId = await resolveNewsletterAudienceId();

    const firstName = params.name?.trim() ? params.name.trim() : undefined;

    const desired = {
      audienceId: newsletterAudienceId,
      email: params.email,
      unsubscribed: false,
      firstName
    };

    const existing = await resend.contacts.get({
      audienceId: newsletterAudienceId,
      email: params.email
    });

    if (existing.data) {
      const upd = await resend.contacts.update(desired);
      if (upd.error) {
        throw new Error(
          `[resend] Failed to update contact: ${upd.error.name}: ${upd.error.message}`
        );
      }
      return;
    }

    if (existing.error && existing.error.name !== "not_found") {
      throw new Error(
        `[resend] Failed to fetch contact: ${existing.error.name}: ${existing.error.message}`
      );
    }

    const created = await resend.contacts.create(desired);
    if (created.error) {
      // Możliwy race: spróbuj jeszcze raz pobrać i zaktualizować
      const again = await resend.contacts.get({
        audienceId: newsletterAudienceId,
        email: params.email
      });
      if (again.data) {
        const upd = await resend.contacts.update(desired);
        if (upd.error) {
          throw new Error(
            `[resend] Failed to update contact: ${upd.error.name}: ${upd.error.message}`
          );
        }
        return;
      }
      throw new Error(
        `[resend] Failed to create contact: ${created.error.name}: ${created.error.message}`
      );
    }
  }

  const subscribeSchema = z.object({
    email: z.string().email("Nieprawidłowy adres e-mail"),
    name: z.string().min(1, "Imię jest wymagane").optional()
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = subscribeSchema.parse(req.body);
      const sourcePage = req.headers.referer || undefined;

      // Biznesowo: zapis do newslettera jest natychmiastowy (bez double opt-in),
      // więc ustawiamy status CONFIRMED.
      const subscriber = await prisma.newsletterSubscriber.upsert({
        where: { email: body.email },
        create: {
          email: body.email,
          name: body.name ?? null,
          status: NewsletterStatus.CONFIRMED,
          sourcePage: sourcePage ?? null
        },
        update: {
          name: body.name ?? null,
          status: NewsletterStatus.CONFIRMED, // re-subscribe
          sourcePage: sourcePage ?? null,
          updatedAt: new Date()
        }
      });

      // Jeśli skonfigurowano sync newslettera do Resend (ID lub NAME), to zapis ma też trafić do Resend (pod Broadcast)
      if (shouldSyncToResend) {
        if (!env.RESEND_API_KEY) {
          console.error("[newsletter] Resend sync is enabled, but RESEND_API_KEY is missing");
          return res.status(500).json({
            error: "Server misconfigured",
            message: "Newsletter is not configured.",
            code: "NEWSLETTER_NOT_CONFIGURED"
          });
        }

        try {
          await upsertResendNewsletterContact({ email: body.email, name: body.name ?? null });
        } catch (syncErr) {
          console.error("[newsletter] Failed to sync subscriber to Resend:", syncErr);
          return res.status(502).json({
            error: "Newsletter provider error",
            message: "Nie udało się zapisać do newslettera. Spróbuj ponownie.",
            code: "RESEND_ERROR"
          });
        }
      }

      // Wyślij email powitalny (nie blokuje zapisu)
      if (emailService) {
        try {
          await emailService.sendNewsletterWelcome({
            to: body.email,
            name: body.name ?? undefined
          });
        } catch (emailErr) {
          console.error("[newsletter] Failed to send welcome email:", emailErr);
          // Nie blokuj odpowiedzi - logujemy błąd, ale zwracamy sukces
        }
      }

      res.status(201).json({
        success: true,
        message: "Zostałeś zapisany do newslettera Dream Travel Sport.",
        subscriber: {
          email: subscriber.email,
          name: subscriber.name
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  return router;
}
