import { checkoutApi } from "../../api/client.js";

export async function requestMagicLink(sessionId: string, customerEmail: string): Promise<string> {
  try {
    const response = await checkoutApi.requestMagicLink({
      sessionId,
      customerEmail
    });
    // W dev zwracamy token, w produkcji tylko email
    return response.token || "";
  } catch (err) {
    console.error("Failed to request magic link:", err);
    throw err;
  }
}

export async function applyPointsToSession(sessionId: string, pointsToUse: number) {
  return checkoutApi.applyPoints(sessionId, pointsToUse);
}

