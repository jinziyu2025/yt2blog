"use client";

import { useEffect } from "react";
import { captureAffiliateRef } from "@/lib/affiliate";

/**
 * Runs once on any page load and persists `?ref=` from the URL.
 * Rendered by the root layout so partner links work on legal pages too.
 */
export default function AffiliateTracker() {
  useEffect(() => {
    captureAffiliateRef(window.location.search);
  }, []);

  return null;
}
