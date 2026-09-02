import type { ReactNode } from 'react';
import { Card } from './Card';

/**
 * A table above `md`, a stack of cards below it.
 *
 * The switch lives here rather than in the four screens that need it. Sideways
 * scrolling was the old answer and it is a bad one on a phone: the columns that
 * matter — status, and what you can do about it — are the ones that scroll off.
 *
 * Rows are not striped and not hover-highlighted unless they are clickable,
 * because a highlight that does not mean "you can press this" is noise.
 */

export interface Column<Row> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: Row) => ReactNode;
}

export function TableFrame<Row>({
  columns,
  rows,
  rowKey,
  renderCard,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** The same row, as it reads on a phone. */
  renderCard: (row: Row) => ReactNode;
}) {
  return (
    <>
      <div className="hidden md:block">
        <Card padding="sm">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-3 py-2 text-xs font-medium text-ink-muted ${
                      column.align === 'right' ? 'text-right' : ''
                    }`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-3 align-top text-sm ${
                        column.align === 'right' ? 'text-right' : ''
                      }`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <Card key={rowKey(row)} padding="sm">
            {renderCard(row)}
          </Card>
        ))}
      </div>
    </>
  );
}
