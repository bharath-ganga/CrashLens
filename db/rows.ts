export function normalizeDatabaseRow(columns: string[], row: unknown): unknown {
  if (!Array.isArray(row)) return row;
  return Object.fromEntries(
    columns.map((column, index) => [column, row[index]]),
  );
}
