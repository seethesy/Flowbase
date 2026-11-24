## Printable documents

`PrintLayout` (`src/components/print/PrintLayout.tsx`, FLOW-49, ADR-17) is the shared print layout for the recipe book, order list and BEO: a company header block (logo, name, sales contact and website from the company profile in business settings, FLOW-45; built-in placeholders until Admin fills it in), US Letter pages with the header repeated on every page, and page numbers where the browser supports CSS page margin boxes (Chrome; Safari prints without them). Users print or "Save as PDF" from the browser; there is no PDF server or library. `/#/print/sample` is a sample multi-page document for checking the layout.

