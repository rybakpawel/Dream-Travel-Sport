import type { Env } from "../env.js";
import crypto from "node:crypto";
import { ServiceUnavailableError } from "../errors/app-error.js";

export type P24TransactionRequest = {
  sessionId: string; // orderNumber
  amount: number; // w groszach
  currency: "PLN";
  description: string;
  email: string;
  client: string; // imię i nazwisko
  address?: string;
  zip?: string;
  city?: string;
  country: "PL";
  phone?: string;
  language: "pl";
  urlReturn: string;
  urlStatus: string; // webhook URL
  timeLimit?: number; // czas na płatność (w praktyce P24 oczekuje wartości w minutach)
  channel?: number; // 16 = BLIK, 0 = wszystkie metody
  waitForResult?: boolean;
  regulationAccept?: boolean;
  shipping?: number;
  transferLabel?: string;
  mobileLib?: boolean;
  methodRefId?: string;
  methodRefIdHash?: string;
};

export type P24TransactionResponse = {
  data: {
    token: string;
    sessionId: string;
  };
  responseCode: string;
};

export type P24VerifyRequest = {
  merchantId: number;
  posId: number;
  sessionId: string;
  amount: number;
  currency: "PLN";
  orderId: number;
  sign: string;
};

export type P24VerifyResponse = {
  data: {
    status: "success" | "error";
    message?: string;
  };
  responseCode: string;
};

export class P24Client {
  private merchantId: number;
  private posId: number;
  private apiKey: string;
  private crcKey: string;
  private apiUrl: string;

  constructor(env: Env) {
    const apiKey = env.P24_REPORT_KEY || env.P24_RAPORT_KEY || env.P24_API_KEY;
    if (!env.P24_POS_ID || !apiKey || !env.P24_CRC_KEY) {
      throw new Error(
        "Przelewy24 credentials not configured (missing P24_POS_ID, P24_REPORT_KEY/P24_API_KEY or P24_CRC_KEY)"
      );
    }
    // Jeśli Merchant ID nie jest podane, użyj POS ID (w wielu przypadkach są takie same)
    this.merchantId = env.P24_MERCHANT_ID
      ? parseInt(env.P24_MERCHANT_ID, 10)
      : parseInt(env.P24_POS_ID, 10);
    this.posId = parseInt(env.P24_POS_ID, 10);
    this.apiKey = apiKey;
    this.crcKey = env.P24_CRC_KEY;
    this.apiUrl = env.P24_API_URL;

    // Bardzo częsty błąd: wzięcie nie tego klucza z panelu P24.
    // Klucz do REST API (w panelu zwykle jako "Klucz do raportów") jest zazwyczaj znacznie dłuższy (np. 32 znaki).
    if (this.apiKey.length < 16) {
      console.warn(
        `[P24] Podejrzanie krótki klucz API (długość=${this.apiKey.length}). ` +
          `Sprawdź, czy używasz właściwego klucza z panelu P24 ("Klucz do raportów") ` +
          `oraz czy masz ustawione dozwolone IP (np. % w sandbox).`
      );
    }
  }

  private getAuthHeader(): string {
    const auth = Buffer.from(`${this.posId}:${this.apiKey}`).toString("base64");
    return `Basic ${auth}`;
  }

  private sha384Hex(data: string): string {
    return crypto.createHash("sha384").update(data).digest("hex");
  }

  /**
   * Oblicza sygnaturę dla transaction/register
   * Format: sessionId|merchantId|amount|currency|crc
   */
  private calculateRegisterSignPipe(sessionId: string, amount: number, currency: string): string {
    const data = `${sessionId}|${this.merchantId}|${amount}|${currency}|${this.crcKey}`;
    return this.sha384Hex(data);
  }

  /**
   * Alternatywny format (spotykany w implementacjach REST v1): SHA384(JSON.stringify({...}))
   * Uwaga: jeśli P24 oczekuje formatu pipe, ta metoda nie zadziała — używamy jej jako fallback dla diagnostyki.
   */
  private calculateRegisterSignJson(sessionId: string, amount: number, currency: string): string {
    const data = JSON.stringify({
      sessionId,
      merchantId: this.merchantId,
      amount,
      currency,
      crc: this.crcKey
    });
    return this.sha384Hex(data);
  }

  /**
   * Oblicza sygnaturę dla transaction/verify
   * Format: sessionId|orderId|amount|currency|crc
   */
  private calculateVerifySignPipe(
    sessionId: string,
    orderId: number,
    amount: number,
    currency: string
  ): string {
    const data = `${sessionId}|${orderId}|${amount}|${currency}|${this.crcKey}`;
    return this.sha384Hex(data);
  }

  private calculateVerifySignJson(
    sessionId: string,
    orderId: number,
    amount: number,
    currency: string
  ): string {
    const data = JSON.stringify({
      sessionId,
      orderId,
      amount,
      currency,
      crc: this.crcKey
    });
    return this.sha384Hex(data);
  }

  async createTransaction(req: P24TransactionRequest): Promise<P24TransactionResponse> {
    const authHeader = this.getAuthHeader();

    const attempt = async (sign: string, signFormat: "pipe" | "json") => {
      const payload = {
        ...req,
        merchantId: this.merchantId,
        posId: this.posId,
        sign
      };

      console.log("[P24] Creating transaction:", {
        url: `${this.apiUrl}/api/v1/transaction/register`,
        merchantId: this.merchantId,
        posId: this.posId,
        apiKeyLength: this.apiKey.length,
        apiKeyLast4: this.apiKey.slice(-4),
        crcKeyLength: this.crcKey.length,
        crcKeyLast4: this.crcKey.slice(-4),
        authHeaderPrefix: authHeader.substring(0, 30) + "...",
        signFormat,
        payloadKeys: Object.keys(payload),
        signLength: sign.length,
        signPreview: sign.substring(0, 20) + "..."
      });

      const response = await fetch(`${this.apiUrl}/api/v1/transaction/register`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.text();
        return { ok: false as const, status: response.status, error, signFormat };
      }

      return {
        ok: true as const,
        data: (await response.json()) as P24TransactionResponse,
        signFormat
      };
    };

    // P24 REST v1 najczęściej oczekuje sygnatury jako SHA384(JSON.stringify({...})) z polem `crc` w JSON.
    // Dlatego próbujemy najpierw format "json", a dopiero potem fallback "pipe".
    const signJson = this.calculateRegisterSignJson(req.sessionId, req.amount, req.currency);
    const first = await attempt(signJson, "json");
    if (first.ok) {
      return first.data;
    }

    const signPipe = this.calculateRegisterSignPipe(req.sessionId, req.amount, req.currency);
    if (signPipe !== signJson) {
      const second = await attempt(signPipe, "pipe");
      if (second.ok) {
        console.warn("[P24] Register succeeded after retry with PIPE sign format");
        return second.data;
      }

      // Jeśli oba podejścia dały 401, to praktycznie zawsze jest zły klucz / IP / środowisko
      if (first.status === 401 && second.status === 401) {
        throw new ServiceUnavailableError(
          `P24 API error: 401 ${second.error}\n` +
            `Błąd autoryzacji P24. Sprawdź:\n` +
            `- P24_POS_ID: ${this.posId}\n` +
            `- P24_REPORT_KEY/P24_API_KEY: ${this.apiKey ? "***" + this.apiKey.slice(-4) : "BRAK"} (len=${this.apiKey.length})\n` +
            `- P24_API_URL: ${this.apiUrl}\n` +
            `- dozwolone IP w panelu P24 (dla sandbox często ustaw "%")\n` +
            `- czy używasz danych z właściwego środowiska (sandbox/produkcja)\n` +
            `Dodatkowo: próbowano dwóch formatów sygnatury (json + pipe) i oba zostały odrzucone.`,
          {
            status: 401,
            attempts: ["json", "pipe"]
          }
        );
      }

      throw new ServiceUnavailableError(`P24 API error: ${second.status} ${second.error}`, {
        status: second.status,
        attempts: [
          { format: first.signFormat, status: first.status },
          { format: second.signFormat, status: second.status }
        ]
      });
    }

    // Brak sensownego fallbacku - zwróć błąd z pierwszej próby (json)
    throw new ServiceUnavailableError(`P24 API error: ${first.status} ${first.error}`, {
      status: first.status,
      attempt: first.signFormat
    });
  }

  async verifyTransaction(req: Omit<P24VerifyRequest, "sign">): Promise<P24VerifyResponse> {
    const authHeader = this.getAuthHeader();

    const attempt = async (sign: string, signFormat: "pipe" | "json") => {
      // UWAGA: merchantId i posId NIE są w sygnaturze verify (payload może je zawierać)
      const payload: P24VerifyRequest = {
        ...req,
        merchantId: this.merchantId,
        posId: this.posId,
        sign
      };

      const payloadString = JSON.stringify(payload);
      const response = await fetch(`${this.apiUrl}/api/v1/transaction/verify`, {
        method: "PUT",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(payloadString).toString()
        },
        body: payloadString
      });

      if (!response.ok) {
        const error = await response.text();
        return { ok: false as const, status: response.status, error, signFormat };
      }

      return { ok: true as const, data: (await response.json()) as P24VerifyResponse, signFormat };
    };

    const signJson = this.calculateVerifySignJson(
      req.sessionId,
      req.orderId,
      req.amount,
      req.currency
    );
    const first = await attempt(signJson, "json");
    if (first.ok) {
      return first.data;
    }

    const signPipe = this.calculateVerifySignPipe(
      req.sessionId,
      req.orderId,
      req.amount,
      req.currency
    );
    if (signPipe !== signJson) {
      const second = await attempt(signPipe, "pipe");
      if (second.ok) {
        console.warn("[P24] Verify succeeded after retry with PIPE sign format");
        return second.data;
      }

      throw new ServiceUnavailableError(`P24 verify error: ${second.status} ${second.error}`, {
        status: second.status,
        attempts: [
          { format: first.signFormat, status: first.status },
          { format: second.signFormat, status: second.status }
        ]
      });
    }

    throw new ServiceUnavailableError(`P24 verify error: ${first.status} ${first.error}`, {
      status: first.status,
      attempt: first.signFormat
    });
  }

  getPaymentUrl(token: string): string {
    return `${this.apiUrl}/trnRequest/${token}`;
  }

  /**
   * Weryfikuje sygnaturę webhooka od P24
   * P24 wysyła webhook z sygnaturą w polu 'sign'
   *
   * W praktyce spotykane są różne formaty sygnatury. Najczęstsze:
   * - sessionId|orderId|amount|currency|crc  (bardzo popularne w integracjach)
   * - merchantId|posId|sessionId|amount|currency|orderId|crc (spotykane w części opisów)
   *
   * Dodatkowo: niektóre implementacje liczą sha384 z JSON.stringify({... , crc}).
   * Dla kompatybilności akceptujemy kilka wariantów, ale nadal weryfikujemy merchantId/posId.
   */
  verifyWebhookSignature(webhookData: {
    merchantId: string | number;
    posId: string | number;
    sessionId: string;
    amount: string | number;
    currency: string;
    orderId: string | number;
    sign: string;
  }): boolean {
    // Sprawdź czy merchantId i posId się zgadzają
    const merchantIdStr = String(webhookData.merchantId);
    const posIdStr = String(webhookData.posId);

    if (merchantIdStr !== String(this.merchantId) || posIdStr !== String(this.posId)) {
      return false;
    }

    const incoming = String(webhookData.sign).toLowerCase();
    const sessionId = String(webhookData.sessionId);
    const orderIdStr = String(webhookData.orderId);
    const amountStr = String(webhookData.amount);
    const currency = String(webhookData.currency);

    const candidates: Record<string, string> = {};

    // 1) Najczęstszy wariant (bez merchantId/posId)
    candidates.pipe_session_order = this.sha384Hex(
      `${sessionId}|${orderIdStr}|${amountStr}|${currency}|${this.crcKey}`
    );

    // 2) Wariant z merchantId/posId
    candidates.pipe_merchant_pos = this.sha384Hex(
      `${merchantIdStr}|${posIdStr}|${sessionId}|${amountStr}|${currency}|${orderIdStr}|${this.crcKey}`
    );

    // 3) Wariant JSON (number)
    const orderIdNum = Number(orderIdStr);
    const amountNum = Number(amountStr);
    if (Number.isFinite(orderIdNum) && Number.isFinite(amountNum)) {
      candidates.json_session_order_num = this.sha384Hex(
        JSON.stringify({
          sessionId,
          orderId: orderIdNum,
          amount: amountNum,
          currency,
          crc: this.crcKey
        })
      );

      candidates.json_merchant_pos_num = this.sha384Hex(
        JSON.stringify({
          merchantId: Number(merchantIdStr),
          posId: Number(posIdStr),
          sessionId,
          amount: amountNum,
          currency,
          orderId: orderIdNum,
          crc: this.crcKey
        })
      );
    }

    // 4) Wariant JSON (string)
    candidates.json_session_order_str = this.sha384Hex(
      JSON.stringify({
        sessionId,
        orderId: orderIdStr,
        amount: amountStr,
        currency,
        crc: this.crcKey
      })
    );

    candidates.json_merchant_pos_str = this.sha384Hex(
      JSON.stringify({
        merchantId: merchantIdStr,
        posId: posIdStr,
        sessionId,
        amount: amountStr,
        currency,
        orderId: orderIdStr,
        crc: this.crcKey
      })
    );

    const matched = Object.entries(candidates).find(([, sig]) => sig.toLowerCase() === incoming);
    if (matched) {
      return true;
    }

    console.warn("[P24] Webhook signature mismatch:", {
      sessionId,
      orderId: orderIdStr,
      amount: amountStr,
      currency,
      receivedSignPreview: incoming.slice(0, 12) + "...",
      candidatePreviews: Object.fromEntries(
        Object.entries(candidates).map(([k, v]) => [k, v.slice(0, 12) + "..."])
      )
    });

    return false;
  }
}

export function createP24Client(env: Env): P24Client | null {
  try {
    return new P24Client(env);
  } catch {
    return null; // P24 nie skonfigurowane - płatności tylko MANUAL_TRANSFER
  }
}
