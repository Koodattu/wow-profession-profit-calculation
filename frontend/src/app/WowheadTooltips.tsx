"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

declare global {
  interface Window {
    $WowheadPower?: { refreshLinks: () => void };
    whTooltips?: Record<string, unknown>;
  }
}

export default function WowheadTooltips() {
  const pathname = usePathname();

  // Refresh tooltips whenever the route changes (SPA navigation)
  useEffect(() => {
    if (window.$WowheadPower) {
      window.$WowheadPower.refreshLinks();
    }
  }, [pathname]);

  return (
    <>
      <Script id="wowhead-config" strategy="afterInteractive">
        {`const whTooltips = { colorLinks: false, iconizeLinks: true, renameLinks: false };`}
      </Script>
      <Script src="https://wow.zamimg.com/js/tooltips.js" strategy="afterInteractive" />
    </>
  );
}
