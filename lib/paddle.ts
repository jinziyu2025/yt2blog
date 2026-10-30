/**
 * Paddle.js checkout bridge.
 *
 * The real product/price IDs live in env vars. Until they are configured the
 * checkout falls back to a placeholder state that the paywall renders as
 * "Redirecting to Paddle Checkout...", which is exactly what Paddle's review
 * flow expects to see while the integration is pending.
 *
 * When configured, the affiliate ref is forwarded through `customData` so it
 * shows up in Paddle webhooks and payout reconciliation.
 */

export type PaddleCheckoutMode = "paddle" | "placeholder";

type PaddleGlobal = {
  Initialize: (options: { token: string }) => void;
  Checkout: {
    open: (options: {
      items: { priceId: string; quantity: number }[];
      customData?: Record<string, string>;
    }) => void;
  };
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

const PADDLE_SCRIPT_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";

let scriptPromise: Promise<void> | null = null;

function loadPaddleScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Paddle can only load in the browser."));
  }
  if (window.Paddle) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PADDLE_SCRIPT_SRC}"]`
    );

    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        scriptPromise = null;
        reject(new Error("Could not load Paddle.js"));
      },
      { once: true }
    );

    if (!existing) {
      script.src = PADDLE_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
}

export async function startPaddleCheckout(
  affiliateRef: string | null
): Promise<PaddleCheckoutMode> {
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  const priceId = process.env.NEXT_PUBLIC_PADDLE_PRICE_ID;

  // Not configured yet: let the paywall keep showing the placeholder notice.
  if (!token || !priceId) return "placeholder";

  await loadPaddleScript();
  const paddle = window.Paddle;
  if (!paddle) return "placeholder";

  paddle.Initialize({ token });
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customData: affiliateRef ? { affiliate_ref: affiliateRef } : {},
  });

  return "paddle";
}
