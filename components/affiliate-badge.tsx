"use client";

import { useEffect, useState } from "react";
import { getAffiliateRef } from "@/lib/affiliate";

/** Tiny, unobtrusive attribution line for the footer. */
export default function AffiliateBadge() {
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    setRef(getAffiliateRef());
  }, []);

  if (!ref) return null;

  return (
    <p className="font-mono text-[10px] text-muted/40">
      Affiliate Partner: {ref}
    </p>
  );
}
