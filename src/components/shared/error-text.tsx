import type { ReactNode } from "react";

// The screen error line (FLOW-313): an alert paragraph, or nothing when there
// is no message.
export function ErrorText({ message }: { message: ReactNode }) {
  return message ? (
    <p role="alert" className="error-message">
      {message}
    </p>
  ) : null;
}
