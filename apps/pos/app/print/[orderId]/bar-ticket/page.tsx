import { PrintDocument } from "../../../components/print-document";

export default async function BarTicketPrintPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <PrintDocument kind="bar-ticket" orderId={orderId} />;
}
