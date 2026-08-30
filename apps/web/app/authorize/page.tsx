import { Suspense } from "react";
import { AuthorizeAgent } from "./authorize-agent";

export default function AuthorizePage() {
  return (
    <Suspense fallback={<main className="centered-page">Loading authorization…</main>}>
      <AuthorizeAgent />
    </Suspense>
  );
}
