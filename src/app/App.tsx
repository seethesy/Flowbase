import { RouterProvider } from "react-router-dom";
import { DemoProvider } from "./store";
import { router } from "./router";
import { AuthGate } from "./auth";
export function App() {
  return (
    <AuthGate>
      <DemoProvider>
        <RouterProvider router={router} />
      </DemoProvider>
    </AuthGate>
  );
}
