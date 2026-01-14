import { Router } from "express";

import { prisma } from "../prisma.js";

export const tripsRouter = Router();

type DeparturePointDto = {
  id: string;
  city: string;
  priceCents: number;
  currency: string;
  sortOrder: number;
};

function toTripDto(
  trip: {
    id: string;
    slug: string;
    name: string;
    details: string;
    extendedDescription: string;
    tag: string;
    meta: string;
    startsAt: Date | null;
    endsAt: Date | null;
    currency: string;
    priceCents: number | null;
    capacity: number | null;
    seatsLeft: number | null;
    availability: string;
    spotsLabel: string | null;
    useAutoSpotsLabel: boolean;
    hotelClass: number | null;
    isFeatured: boolean;
    heroImagePath: string | null;
    cardImagePath: string | null;
  },
  departurePoints?: DeparturePointDto[]
) {
  // Oblicz najtańszą cenę z miejsc wylotu (lub użyj starego priceCents jako fallback)
  let minPriceCents: number | null = null;
  if (departurePoints && departurePoints.length > 0) {
    minPriceCents = Math.min(...departurePoints.map((dp) => dp.priceCents));
  } else if (trip.priceCents !== null && trip.priceCents !== undefined) {
    minPriceCents = trip.priceCents;
  }

  return {
    ...trip,
    priceCents: minPriceCents,
    departurePoints: departurePoints || []
  };
}

tripsRouter.get("/", async (req, res, next) => {
  try {
    // Paginacja (opcjonalna)
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 100); // max 100
    const skip = (page - 1) * limit;

    const [trips, total] = await Promise.all([
      prisma.trip.findMany({
        where: { isActive: true },
        select: {
          id: true,
          slug: true,
          name: true,
          details: true,
          extendedDescription: true,
          tag: true,
          meta: true,
          startsAt: true,
          endsAt: true,
          currency: true,
          priceCents: true,
          capacity: true,
          seatsLeft: true,
          availability: true,
          spotsLabel: true,
          useAutoSpotsLabel: true,
          hotelClass: true,
          isFeatured: true,
          heroImagePath: true,
          cardImagePath: true
        },
        orderBy: [{ isFeatured: "desc" }, { startsAt: "asc" }, { createdAt: "desc" }],
        skip,
        take: limit
      }),
      prisma.trip.count({ where: { isActive: true } })
    ]);

    // Pobierz miejsca wylotu dla wszystkich wyjazdów
    const tripIds = trips.map((t) => t.id);
    const departurePoints = await prisma.departurePoint.findMany({
      where: {
        tripId: { in: tripIds },
        isActive: true
      },
      select: {
        id: true,
        tripId: true,
        city: true,
        priceCents: true,
        currency: true,
        sortOrder: true
      },
      orderBy: { sortOrder: "asc" }
    });

    // Grupuj miejsca wylotu po tripId
    const departurePointsByTrip = new Map<string, DeparturePointDto[]>();
    departurePoints.forEach((dp) => {
      if (!departurePointsByTrip.has(dp.tripId)) {
        departurePointsByTrip.set(dp.tripId, []);
      }
      departurePointsByTrip.get(dp.tripId)!.push({
        id: dp.id,
        city: dp.city,
        priceCents: dp.priceCents,
        currency: dp.currency,
        sortOrder: dp.sortOrder
      });
    });

    res.json({
      data: trips.map((trip) => toTripDto(trip, departurePointsByTrip.get(trip.id))),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
});

tripsRouter.get("/featured", async (_req, res, next) => {
  try {
    const trips = await prisma.trip.findMany({
      where: { isFeatured: true, isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        details: true,
        extendedDescription: true,
        tag: true,
        meta: true,
        startsAt: true,
        endsAt: true,
        currency: true,
        priceCents: true,
        capacity: true,
        seatsLeft: true,
        availability: true,
        spotsLabel: true,
        useAutoSpotsLabel: true,
        hotelClass: true,
        isFeatured: true,
        heroImagePath: true,
        cardImagePath: true
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }]
    });

    // Pobierz miejsca wylotu dla wszystkich wyjazdów
    const tripIds = trips.map((t) => t.id);
    const departurePoints = await prisma.departurePoint.findMany({
      where: {
        tripId: { in: tripIds },
        isActive: true
      },
      select: {
        id: true,
        tripId: true,
        city: true,
        priceCents: true,
        currency: true,
        sortOrder: true
      },
      orderBy: { sortOrder: "asc" }
    });

    // Grupuj miejsca wylotu po tripId
    const departurePointsByTrip = new Map<string, DeparturePointDto[]>();
    departurePoints.forEach((dp) => {
      if (!departurePointsByTrip.has(dp.tripId)) {
        departurePointsByTrip.set(dp.tripId, []);
      }
      departurePointsByTrip.get(dp.tripId)!.push({
        id: dp.id,
        city: dp.city,
        priceCents: dp.priceCents,
        currency: dp.currency,
        sortOrder: dp.sortOrder
      });
    });

    res.json(trips.map((trip) => toTripDto(trip, departurePointsByTrip.get(trip.id))));
  } catch (err) {
    next(err);
  }
});

tripsRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const trip = await prisma.trip.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        details: true,
        extendedDescription: true,
        tag: true,
        meta: true,
        startsAt: true,
        endsAt: true,
        currency: true,
        priceCents: true,
        capacity: true,
        seatsLeft: true,
        availability: true,
        spotsLabel: true,
        useAutoSpotsLabel: true,
        hotelClass: true,
        isFeatured: true,
        heroImagePath: true,
        cardImagePath: true
      }
    });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    // Pobierz miejsca wylotu dla tego wyjazdu
    const departurePoints = await prisma.departurePoint.findMany({
      where: {
        tripId: trip.id,
        isActive: true
      },
      select: {
        id: true,
        city: true,
        priceCents: true,
        currency: true,
        sortOrder: true
      },
      orderBy: { sortOrder: "asc" }
    });

    res.json(
      toTripDto(
        trip,
        departurePoints.map((dp) => ({
          id: dp.id,
          city: dp.city,
          priceCents: dp.priceCents,
          currency: dp.currency,
          sortOrder: dp.sortOrder
        }))
      )
    );
  } catch (err) {
    next(err);
  }
});
