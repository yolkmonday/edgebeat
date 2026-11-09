import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFoundPage() {
  return (
    <EmptyState
      illustration="error"
      title="Page not found"
      body="This page doesn't exist or was moved."
      actions={
        <Button asChild>
          <Link to="/">Go to overview</Link>
        </Button>
      }
    />
  );
}
