"use client";

import { useEffect, useRef } from "react";
import { trackPixel } from "./meta-pixel";

/**
 * Fires a single Meta Pixel event once, on mount. Rendered conditionally by
 * server components at conversion points — e.g. the dashboard renders
 * <PixelTrack event="Purchase" /> only when it's reached via Stripe's
 * ?checkout=success redirect.
 *
 * Set `scrubQuery` when the render is gated on a query param (like
 * ?checkout=success): after firing, we strip the query from the URL bar with
 * history.replaceState so a refresh, back-forward, or bookmark of that URL
 * doesn't re-render this component and double-count the conversion. We use
 * replaceState rather than router.replace to avoid a server re-render — we only
 * need the address bar cleaned, not a navigation.
 */
export function PixelTrack({
  event,
  params,
  scrubQuery = false,
}: {
  event: string;
  params?: Record<string, unknown>;
  scrubQuery?: boolean;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackPixel(event, params);
    if (scrubQuery && window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Intentionally mount-only: we want exactly one event per landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
