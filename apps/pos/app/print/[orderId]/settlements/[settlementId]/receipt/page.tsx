import { PrintDocument } from "../../../../../components/print-document";

export default async function SettlementReceiptPrintPage({ params }: { params: Promise<{ orderId: string; settlementId: string }> }) {
  const { orderId, settlementId } = await params;
  return <PrintDocument kind="settlement" orderId={orderId} settlementId={settlementId} />;
}
