"use client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-16">
      <Alert tone="error" title="This page could not be loaded">
        Something went wrong while loading your data. Nothing was changed. Check your internet connection and try again.
      </Alert>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
