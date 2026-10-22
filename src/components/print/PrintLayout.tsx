import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { company } from "../../config/company";
import { Button } from "../ui/button";

// Shared branded layout for browser-printed documents (FLOW-49, ADR-17): the
// recipe book now, the order list and BEO later. The header sits in a table
// header group, which Chrome and Safari repeat on every printed page; page
// numbers come from the @page rules in globals.css where the browser supports
// them. Users print or "Save as PDF" from the browser.
export function PrintLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="print-document">
      <div className="print-toolbar">
        <Button onClick={() => window.print()}>
          <Printer size={16} />
          Print or save as PDF
        </Button>
      </div>
      <table className="print-page">
        <thead>
          <tr>
            <td>
              <header className="print-header">
                <div>
                  <strong>{company.name}</strong>
                  <span>{company.salesContact}</span>
                  <span>{company.website}</span>
                </div>
                <div className="print-title">
                  <h1>{title}</h1>
                  {subtitle && <p>{subtitle}</p>}
                </div>
              </header>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="print-body">{children}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
