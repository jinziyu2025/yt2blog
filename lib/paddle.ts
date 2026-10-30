/**
 * Paddle.js checkout bridge.
 *
 * Configure `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` and `NEXT_PUBLIC_PADDLE_PRICE_ID`
 * (a Paddle price entity ID starting with `pri_`, not a product ID).
 * When either value is missing the paywall falls back to the placeholder
 * "Redirecting to Paddle Checkout..." notice used during review.
 *
 * When configured, the affiliate ref is forwarded through `customData` so it
 * shows up in Paddle webhooks and payout reconciliation.
 */

export type PaddleCheckoutStatus =
  | "opened"
  | "placeholder"
  | "invalid-price-id";

type PaddleGlobal = {
  Initialize: (options: { token: string }) => void;
  Checkout: {
    open: (options: {
      items: { priceId: string; quantity: number }[];
      customData?: Record<string, string>;
      settings?: {
        displayMode?: "overlay" | "inline";
        theme?: "light" | "dark";
        locale?: string;
      };
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
let initializedToken: string | null = null;

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

async function ensurePaddle(token: string): Promise<PaddleGlobal> {
  await loadPaddleScript();

  const paddle = window.Paddle;
  if (!paddle) throw new Error("Paddle.js loaded but window.Paddle is missing.");

  // Paddle.Initialize() only needs to run once per token for a page session.
  if (initializedToken !== token) {
    paddle.Initialize({ token });
    initializedToken = token;
  }

  return paddle;
}

export async function startPaddleCheckout(
  affiliateRef: string | null
): Promise<PaddleCheckoutStatus> {
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim();
  const priceId = process.env.NEXT_PUBLIC_PADDLE_PRICE_ID?.trim();

  // Not configured yet: let the paywall keep showing the placeholder notice.
  if (!token || !priceId) return "placeholder";

  // Paddle.Checkout.open() only accepts price entity IDs (pri_...).
  if (!priceId.startsWith("pri_")) {
    console.error(
      "[paddle] NEXT_PUBLIC_PADDLE_PRICE_ID must be a price ID starting with " +
        `"pri_". Received "${priceId}" — product IDs (pro_...) are not valid here.`
    );
    return "invalid-price-id";
  }

  const paddle = await ensurePaddle(token);

  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    ...(affiliateRef ? { customData: { affiliate_ref: affiliateRef } } : {}),
    settings: { displayMode: "overlay", theme: "dark", locale: "en" },
  });

  return "opened";
}
