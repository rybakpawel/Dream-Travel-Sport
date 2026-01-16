import express from "express";
import { z } from "zod";
import type { Env } from "../env.js";
import type { EmailService } from "../services/email.js";

const contactSchema = z.object({
  name: z.string().min(1, "Imię i nazwisko jest wymagane"),
  email: z.string().email("Nieprawidłowy adres e-mail"),
  company: z.string().optional(),
  phone: z.string().optional(),
  message: z.string().min(10, "Wiadomość musi mieć minimum 10 znaków")
});

export function createContactRouter(env: Env, emailService: EmailService | null) {
  const router = express.Router();

  router.post("/", async (req, res, next) => {
    try {
      const body = contactSchema.parse(req.body);

      if (!emailService) {
        console.warn("[contact] Email service not configured - contact form submission ignored");
        return res.status(503).json({
          error: "Service temporarily unavailable",
          message: "Formularz kontaktowy jest tymczasowo niedostępny"
        });
      }

      // Wysyłamy e-mail do właściciela strony
      await emailService.sendContactForm({
        to: "kontakt@dreamtravelsport.pl",
        fromEmail: body.email,
        fromName: body.name,
        company: body.company,
        phone: body.phone,
        message: body.message
      });

      // Wysyłamy potwierdzenie do nadawcy
      await emailService.sendContactConfirmation({
        to: body.email,
        name: body.name
      });

      return res.json({
        success: true,
        message: "Wiadomość została wysłana"
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Nieprawidłowe dane formularza",
          details: err.errors
        });
      }
      next(err);
    }
  });

  return router;
}

