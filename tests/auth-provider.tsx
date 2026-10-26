import type { ReactNode } from "react";
import type { Role, EmploymentType } from "../shared/access";
import { AuthContext } from "../src/app/auth";

export function TestAuth({
  children,
  role = "admin",
  employmentType = "full_time",
}: {
  children: ReactNode;
  role?: Role;
  employmentType?: EmploymentType;
}) {
  return (
    <AuthContext.Provider
      value={{
        user: {
          id: "38000000-0000-4000-8000-000000000001",
          name: "Test User",
          email: "test@example.com",
          role,
          employmentType,
          mobile: "2025550101",
          status: "active",
          invitedAt: "2026-10-20T00:00:00.000Z",
          activatedAt: "2026-10-20T00:00:00.000Z",
        },
        signOut: async () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
