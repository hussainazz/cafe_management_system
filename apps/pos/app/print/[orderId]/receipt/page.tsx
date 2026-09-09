import { PrintDocument } from "../../../components/print-document";

export default async function OrderReceiptPrintPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <PrintDocument kind="receipt" orderId={orderId} />;
}
