"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Paste your pixel id into NEXT_PUBLIC_META_PIXEL_ID (Vercel env). Until then
// everything here stays dormant — the base script never loads and trackPixel()
// no-ops — so this is safe to ship before the ad account exists.
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

type Fbq = (...args: unknown[]) => void;

function getFbq(): Fbq | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { fbq?: Fbq }).fbq;
}

/**
 * Fire a Meta (Facebook) Pixel standard event. Safe to call anywhere: if the
 * pixel isn't configured or hasn't loaded yet, it simply does nothing.
 * Standard events we use: "CompleteRegistration" (signup), "Purchase"
 * (subscription started). Full list: https://www.facebook.com/business/help/402791146561655
 */
export function trackPixel(event: string, params?: Record<string, unknown>): void {
  const fbq = getFbq();
  if (typeof fbq !== "function") return;
  fbq("track", event, params);
}

/**
 * Base pixel. Loads fbevents.js once and fires the initial PageView, then fires
 * a fresh PageView on every client-side route change (the App Router navigates
 * without a full reload, so the one-shot script PageView isn't enough on its
 * own). Rendered once in the root layout.
 */
export function MetaPixel() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  useEffect(() => {
    if (!PIXEL_ID) return;
    // The inline script below already fires the first PageView on load; skip it
    // here so the initial page isn't counted twice.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    getFbq()?.("track", "PageView");
  }, [pathname]);

  if (!PIXEL_ID) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
