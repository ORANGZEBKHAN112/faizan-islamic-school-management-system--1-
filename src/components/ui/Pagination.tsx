import { ChevronLeft, ChevronRight } from 'lucide-react';

type PaginationItem = number | 'start-ellipsis' | 'end-ellipsis';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}

function getPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const items: PaginationItem[] = [1];
  const start = Math.max(2, Math.min(currentPage - 1, totalPages - 3));
  const end = Math.min(totalPages - 1, Math.max(currentPage + 1, 4));

  if (start > 2) items.push('start-ellipsis');
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < totalPages - 1) items.push('end-ellipsis');
  items.push(totalPages);

  return items;
}

export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  itemLabel,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  return (
    <div className="px-8 py-6 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
        Showing <span className="text-slate-900 dark:text-white">{startItem}-{endItem}</span> of{' '}
        <span className="text-slate-900 dark:text-white">{totalItems}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <button
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-slate-800 transition-colors"
          title="Previous Page"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {getPaginationItems(currentPage, totalPages).map((item) =>
          typeof item === 'number' ? (
            <button
              key={item}
              onClick={() => onPageChange(item)}
              className={`w-9 h-9 rounded-xl text-[10px] font-black transition-all ${
                currentPage === item
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {item}
            </button>
          ) : (
            <span
              key={item}
              className="w-9 h-9 rounded-xl border border-transparent text-[10px] font-black text-slate-400 flex items-center justify-center"
            >
              ...
            </span>
          )
        )}

        <button
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-slate-800 transition-colors"
          title="Next Page"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
