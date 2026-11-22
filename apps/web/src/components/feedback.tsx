import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from './ui/button';

export function ErrorState({ retry }: { retry: () => void }) {
  return (
    <div className="feedback" role="alert">
      <AlertCircle size={24} />
      <h2>We couldn't load this view</h2>
      <p>The API may still be starting. Your data stays in PostgreSQL.</p>
      <Button variant="outline" onClick={retry}>
        <RotateCw size={15} /> Try again
      </Button>
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span className="loader" /> Loading workspace…
    </div>
  );
}
