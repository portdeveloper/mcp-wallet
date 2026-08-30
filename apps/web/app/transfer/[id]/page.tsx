import { TransferReview } from "./transfer-review";

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransferReview transferId={id} />;
}
