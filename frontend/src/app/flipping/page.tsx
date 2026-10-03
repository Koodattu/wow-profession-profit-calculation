import { Suspense } from "react";
import FlippingClient from "./FlippingClient";

export default function FlippingPage() {
  return <Suspense fallback={<p className="text-muted" role="status">Loading realm comparisons…</p>}><FlippingClient /></Suspense>;
}
