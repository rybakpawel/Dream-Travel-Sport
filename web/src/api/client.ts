const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  error?: string;
  details?: Array<{ path: string; message: string }>;
  [key: string]: unknown;
};

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Merge cache option if provided
  const fetchOptions: RequestInit = {
    ...options,
    credentials: "include", // Zawsze wysyłaj cookies (potrzebne dla admin auth)
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  };
  
  // Add cache control for GET requests if not explicitly set
  if (options.method === undefined || options.method === "GET") {
    if (!options.cache) {
      fetchOptions.cache = "no-store";
    } else {
      fetchOptions.cache = options.cache;
    }
  }
  
  const response = await fetch(url, fetchOptions);

  // Obsługa 204 No Content (brak body)
  if (response.status === 204) {
    if (!response.ok) {
      throw new Error("API request failed");
    }
    return undefined as T;
  }

  // Sprawdź czy response ma body przed parsowaniem JSON
  const contentType = response.headers.get("content-type");
  const hasJsonBody = contentType && contentType.includes("application/json");

  let data: ApiResponse<T>;

  if (hasJsonBody) {
    try {
      data = await response.json();
    } catch (err) {
      // Jeśli parsowanie JSON się nie powiodło, ale status jest OK, zwróć undefined
      if (response.ok) {
        return undefined as T;
      }
      throw new Error("Failed to parse response as JSON");
    }
  } else {
    // Jeśli nie ma JSON body, ale status jest OK, zwróć undefined
    if (response.ok) {
      return undefined as T;
    }
    // Jeśli status nie jest OK, ale nie ma JSON, rzuć błąd
    throw new Error(`API request failed with status ${response.status}`);
  }

  if (!response.ok) {
    const messageFromApi =
      typeof (data as any).message === "string"
        ? ((data as any).message as string)
        : typeof data.error === "string"
          ? data.error
          : "API request failed";
    const error = new Error(messageFromApi);
    (error as Error & { details?: unknown; code?: string }).details = data.details;
    (error as Error & { details?: unknown; code?: string }).code =
      typeof (data as any).code === "string" ? ((data as any).code as string) : undefined;
    throw error;
  }

  // Jeśli odpowiedź ma strukturę { data: ..., pagination: ... }, zwróć cały obiekt
  // W przeciwnym razie zwróć data.data lub data (dla kompatybilności wstecznej)
  if (data.data !== undefined && (data as any).pagination !== undefined) {
    return data as T;
  }

  return (data.data ?? data) as T;
}

// Trips API
export const tripsApi = {
  getAll: (page?: number, limit?: number) => {
    const params = new URLSearchParams();
    if (page) params.append("page", String(page));
    if (limit) params.append("limit", String(limit));
    const query = params.toString();
    return apiRequest<{
      data: Array<unknown>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>(`/trips${query ? `?${query}` : ""}`);
  },
  getFeatured: () => apiRequest<Array<unknown>>("/trips/featured"),
  getBySlug: (slug: string) => apiRequest<unknown>(`/trips/${slug}`)
};

// Newsletter API
export const newsletterApi = {
  subscribe: (data: { email: string; name?: string }) =>
    apiRequest<{ success: boolean; message: string }>("/newsletter", {
      method: "POST",
      body: JSON.stringify(data)
    })
};

// Content API
export const contentApi = {
  getAll: (page?: "HOME" | "DREAM_POINTS" | "COOPERATION") => {
    const params = new URLSearchParams();
    if (page) params.append("page", page);
    // Add cache-busting timestamp
    params.append("_t", String(Date.now()));
    const query = params.toString();
    // apiRequest returns data.data ?? data, so for { data: [...] } it returns the array
    return apiRequest<Array<{
      section: string;
      page: string;
      data: any;
    }>>(`/content?${query}`, {
      cache: "no-store"
    });
  },
  getSection: (section: string) =>
    apiRequest<{
      data: {
        section: string;
        page: string;
        data: any;
      };
    }>(`/content/${section}?_t=${Date.now()}`, {
      cache: "no-store"
    })
};

// Cart API
export const cartApi = {
  getCart: (sessionId: string) =>
    apiRequest<{
      success: boolean;
      cart: Array<{ id: string; qty: number; departurePointId?: string; priceCents?: number }>;
    }>(`/cart/${sessionId}`),

  updateCart: (sessionId: string, cart: Array<{ id: string; qty: number; departurePointId?: string; priceCents?: number }>) =>
    apiRequest<{
      success: boolean;
      cart: Array<{ id: string; qty: number; departurePointId?: string; priceCents?: number }>;
      message: string;
    }>(`/cart/${sessionId}`, {
      method: "PUT",
      body: JSON.stringify(cart)
    })
};

// Checkout API
export const checkoutApi = {
  createSession: (data: { customerEmail: string; cartData: Array<{ id: string; qty: number; departurePointId?: string; priceCents?: number }> }) =>
    apiRequest<{
      success: boolean;
      session: {
        id: string;
        status: string;
        customerEmail: string;
        expiresAt: string;
        hasLoyaltyPoints: boolean;
        loyaltyPoints: number;
      };
    }>("/checkout/sessions", {
      method: "POST",
      body: JSON.stringify(data)
    }),

  getSession: (sessionId: string) =>
    apiRequest<{
      session: {
        id: string;
        status: string;
        customerEmail: string;
        expiresAt: string;
        pointsReserved: number;
        hasLoyaltyPoints: boolean;
        loyaltyPoints: number;
        orderId: string | null;
      };
    }>(`/checkout/sessions/${sessionId}`),

  requestMagicLink: (data: { sessionId: string; customerEmail: string }) =>
    apiRequest<{
      success: boolean;
      message: string;
      token?: string;
      magicLink?: string;
    }>("/checkout/magic-link", {
      method: "POST",
      body: JSON.stringify(data)
    }),

  applyPoints: (sessionId: string, pointsToUse: number) =>
    apiRequest<{
      success: boolean;
      pointsReserved: number;
      availablePoints: number;
    }>(`/checkout/sessions/${sessionId}/apply-points`, {
      method: "POST",
      body: JSON.stringify({ pointsToUse })
    })
};

// Orders API
export const ordersApi = {
  create: (data: {
    checkoutSessionId: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    invoiceType: "RECEIPT" | "INVOICE_PERSONAL" | "INVOICE_COMPANY";
    companyName?: string | null;
    companyTaxId?: string | null;
    companyAddress?: string | null;
    items: Array<{
      tripId: string;
      qty: number;
      passengers: Array<{
        firstName: string;
        lastName: string;
        birthDate?: string | null;
        documentType: "ID_CARD" | "PASSPORT";
        documentNumber?: string | null;
      }>;
    }>;
    usePoints?: boolean;
  }) =>
    apiRequest<{
      success: boolean;
      message: string;
      order: {
        id: string;
        orderNumber: string;
        status: string;
        totalCents: number;
        currency: string;
      };
    }>("/orders", {
      method: "POST",
      body: JSON.stringify(data)
    }),

  lookup: (data: { orderNumber: string; customerEmail: string }) =>
    apiRequest<{
      success: boolean;
      order: {
        id: string;
        orderNumber: string;
        status: string;
        totalCents: number;
        currency: string;
        submittedAt: string;
      };
      payment: {
        id: string;
        provider: string;
        status: string;
        createdAt: string;
        paidAt: string | null;
      } | null;
      manualTransfer: {
        bankAccount: string | null;
        title: string;
        amountCents: number;
        currency: string;
      } | null;
    }>("/orders/lookup", {
      method: "POST",
      body: JSON.stringify(data)
    })
};

// Contact API
export const contactApi = {
  submit: (data: { name: string; email: string; company?: string; phone?: string; message: string }) =>
    apiRequest<{
      success: boolean;
      message: string;
    }>("/contact", {
      method: "POST",
      body: JSON.stringify(data)
    })
};

// Payments API
export const paymentsApi = {
  create: (
    orderId: string,
    provider: "PRZELEWY24" | "MANUAL_TRANSFER" = "PRZELEWY24",
    options?: { forceNew?: boolean }
  ) =>
    apiRequest<{
      success: boolean;
      payment?: {
        id: string;
        status: string;
        provider: string;
      };
      redirectUrl?: string;
      message?: string;
    }>(`/orders/${orderId}/payments`, {
      method: "POST",
      body: JSON.stringify({ provider, forceNew: options?.forceNew ?? false })
    })
};

// Admin API
export const adminApi = {
  getStats: () =>
    apiRequest<{
      trips: { total: number };
      orders: {
        total: number;
        pending: number;
        paid: number;
        overdueManualTransfers: number;
        overdueManualTransfersHours: number;
      };
      users: { total: number };
      newsletter: { subscribers: number };
      revenue: { totalCents: number };
    }>("/admin/stats", {
      credentials: "include" // Wysyła cookies automatycznie
    }),

  getOrders: (
    page?: number,
    limit?: number,
    status?: string,
    overdueManualTransfers?: boolean
  ) => {
    const params = new URLSearchParams();
    if (page) params.append("page", String(page));
    if (limit) params.append("limit", String(limit));
    if (status) params.append("status", status);
    if (overdueManualTransfers) params.append("overdueManualTransfers", "true");
    const query = params.toString();
    return apiRequest<{
      data: Array<unknown>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/admin/orders${query ? `?${query}` : ""}`, {
      credentials: "include"
    });
  },

  getOrder: (id: string) =>
    apiRequest<unknown>(`/admin/orders/${id}`, {
      credentials: "include"
    }),

  markManualTransferPaid: (orderId: string) =>
    apiRequest<{
      success: boolean;
      orderId: string;
      orderNumber: string;
      orderStatus: string;
      paymentId: string | null;
    }>(`/admin/orders/${orderId}/manual-transfer/mark-paid`, {
      method: "POST",
      credentials: "include"
    }),

  cancelManualTransferOrder: (orderId: string) =>
    apiRequest<{
      success: boolean;
      orderId: string;
      orderNumber: string;
      orderStatus: string;
    }>(`/admin/orders/${orderId}/manual-transfer/cancel`, {
      method: "POST",
      credentials: "include"
    }),

  getTrips: (page?: number, limit?: number) => {
    const params = new URLSearchParams();
    if (page) params.append("page", String(page));
    if (limit) params.append("limit", String(limit));
    const query = params.toString();
    return apiRequest<{
      data: Array<unknown>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/admin/trips${query ? `?${query}` : ""}`, {
      credentials: "include"
    });
  },

  getTrip: (id: string) =>
    apiRequest<unknown>(`/admin/trips/${id}`, {
      credentials: "include"
    }),

  createTrip: (data: Record<string, unknown>) =>
    apiRequest<unknown>("/admin/trips", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(data)
    }),

  updateTrip: (id: string, data: Record<string, unknown>) =>
    apiRequest<unknown>(`/admin/trips/${id}`, {
      method: "PUT",
      credentials: "include",
      body: JSON.stringify(data)
    }),

  // Departure Points (Miejsca wylotu)
  createDeparturePoint: (
    tripId: string,
    data: { city: string; priceCents: number; currency?: string; isActive?: boolean; sortOrder?: number }
  ) =>
    apiRequest<unknown>(`/admin/trips/${tripId}/departure-points`, {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(data)
    }),

  updateDeparturePoint: (
    tripId: string,
    departurePointId: string,
    data: { city?: string; priceCents?: number; currency?: string; isActive?: boolean; sortOrder?: number }
  ) =>
    apiRequest<unknown>(`/admin/trips/${tripId}/departure-points/${departurePointId}`, {
      method: "PUT",
      credentials: "include",
      body: JSON.stringify(data)
    }),

  deleteDeparturePoint: (tripId: string, departurePointId: string) =>
    apiRequest<{ message: string }>(`/admin/trips/${tripId}/departure-points/${departurePointId}`, {
      method: "DELETE",
      credentials: "include"
    }),

  deactivateTrip: (id: string) =>
    apiRequest<{ message: string }>(`/admin/trips/${id}/deactivate`, {
      method: "PATCH",
      credentials: "include"
    }),

  activateTrip: (id: string) =>
    apiRequest<{ message: string }>(`/admin/trips/${id}/activate`, {
      method: "PATCH",
      credentials: "include"
    }),

  uploadImage: async (file: File): Promise<{ path: string; filename: string }> => {
    const formData = new FormData();
    formData.append("image", file);

    const url = `${API_BASE_URL}/admin/upload`;
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      // Nie ustawiaj Content-Type - przeglądarka ustawi to automatycznie z boundary dla FormData
      body: formData
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Upload failed" }));
      throw new Error(error.message || "Nie udało się przesłać obrazu");
    }

    const data = await response.json();
    return data;
  },

  deleteImage: async (imagePath: string): Promise<void> => {
    const url = `${API_BASE_URL}/admin/upload`;
    const response = await fetch(url, {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ imagePath })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Delete failed" }));
      throw new Error(error.message || "Nie udało się usunąć obrazu");
    }
  },

  getUsers: (page?: number, limit?: number) => {
    const params = new URLSearchParams();
    if (page) params.append("page", String(page));
    if (limit) params.append("limit", String(limit));
    const query = params.toString();
    return apiRequest<{
      data: Array<unknown>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/admin/users${query ? `?${query}` : ""}`, {
      credentials: "include"
    });
  },

  getNewsletter: (page?: number, limit?: number, status?: string) => {
    const params = new URLSearchParams();
    if (page) params.append("page", String(page));
    if (limit) params.append("limit", String(limit));
    if (status) params.append("status", status);
    const query = params.toString();
    return apiRequest<{
      data: Array<unknown>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/admin/newsletter${query ? `?${query}` : ""}`, {
      credentials: "include"
    });
  },

  // Content management
  get: (endpoint: string) =>
    apiRequest(`/admin${endpoint}`, {
      credentials: "include"
    }),

  put: (endpoint: string, body: unknown) =>
    apiRequest(`/admin${endpoint}`, {
      method: "PUT",
      credentials: "include",
      body: JSON.stringify(body)
    })
};
