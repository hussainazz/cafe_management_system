import { notFound } from "next/navigation";
import { PaymentBridgeDiagnostic } from "../../components/payment-bridge-diagnostic";

export const dynamic = "force-dynamic";

export default function PaymentBridgeDiagnosticPage() {
  if (process.env.SEP_BRIDGE_DIAGNOSTICS_ENABLED !== "true") notFound();
  const port = Number(process.env.SEP_BRIDGE_PORT ?? "18711");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) notFound();
  return <PaymentBridgeDiagnostic port={port} />;
}
