import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ContentPage, ContentSection } from "@prisma/client";

export const contentRouter = Router();

// GET /api/content - pobierz wszystkie treści lub filtruj po stronie (publiczny endpoint)
contentRouter.get("/", async (req, res, next) => {
  try {
    const querySchema = z.object({
      page: z.enum(["HOME", "DREAM_POINTS", "COOPERATION"]).optional()
    });
    const query = querySchema.parse(req.query);

    const where = query.page ? { page: query.page as ContentPage } : {};

    const contents = await prisma.content.findMany({
      where,
      orderBy: [
        { page: "asc" },
        { section: "asc" }
      ],
      select: {
        section: true,
        page: true,
        data: true
      }
    });

    res.json({ data: contents });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: "Validation error",
        details: err.errors
      });
    }
    next(err);
  }
});

// GET /api/content/:section - pobierz konkretną sekcję (publiczny endpoint)
contentRouter.get("/:section", async (req, res, next) => {
  try {
    const { section } = req.params;
    
    const content = await prisma.content.findUnique({
      where: { section: section as ContentSection },
      select: {
        section: true,
        page: true,
        data: true
      }
    });

    if (!content) {
      return res.status(404).json({
        error: "Not found",
        message: "Content section not found"
      });
    }

    res.json({ data: content });
  } catch (err) {
    next(err);
  }
});

