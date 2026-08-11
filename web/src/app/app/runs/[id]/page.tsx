import { Suspense } from 'react';
import RunPage from './run-client';

export default function Page() {
  return (
    <Suspense fallback={<main className="app-shell">Loading run…</main>}>
      <RunPage />
    </Suspense>
  );
}
