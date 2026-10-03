import { Suspense } from "react";
import ItemsClient from "./ItemsClient";

export default function ItemsPage() {
  return <Suspense fallback={<p role="status" className="text-muted">Loading market…</p>}><ItemsClient /></Suspense>;
}
