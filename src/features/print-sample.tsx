import { PrintLayout } from "../components/print/PrintLayout";
import "./print-sample.css";

// A sample long enough to run over several US Letter pages, used to check the
// shared print layout (FLOW-49 AC1/AC2) before real documents use it.
const courses = [
  "Passed hors d'oeuvres",
  "Stationed salads",
  "Carving station",
  "Buffet sides",
  "Dessert table",
  "Late-night snacks",
];

export function PrintSample() {
  return (
    <PrintLayout title="Sample recipe book" subtitle="Fall gala · 120 guests">
      {courses.map((course, index) => (
        <section className="print-section" key={course}>
          <h2>{course}</h2>
          {[1, 2, 3].map((dish) => (
            <article key={dish}>
              <h3>
                Dish {index + 1}.{dish}
              </h3>
              <p>
                Ingredients are listed per batch of 25 servings. Prep components
                the day before where noted, hold chilled items at or below 41°F,
                and plate within 30 minutes of service. Garnish at the station.
              </p>
              <table className="print-table">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th>Quantity</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {["Primary", "Secondary", "Seasoning", "Garnish"].map(
                    (row) => (
                      <tr key={row}>
                        <td>{row} ingredient</td>
                        <td>2.5 kg</td>
                        <td>Prepare according to the station sheet.</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </article>
          ))}
        </section>
      ))}
    </PrintLayout>
  );
}
