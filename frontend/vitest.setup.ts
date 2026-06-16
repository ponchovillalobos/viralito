// Registra los matchers de @testing-library/jest-dom (toHaveAttribute, toBeVisible…)
// en el `expect` de vitest. Es inocuo en las suites Node: sólo extiende expect.
import "@testing-library/jest-dom/vitest";
