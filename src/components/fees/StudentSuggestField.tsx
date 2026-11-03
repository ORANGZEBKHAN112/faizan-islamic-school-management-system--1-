import { useEffect, useRef, useState } from 'react';
import { Search, User } from 'lucide-react';
import { dataService } from '../../services/dataService';
import { formatRollNumberForDisplay } from '../../utils/rollNumber';

export type SuggestedStudent = {
  id: string;
  firstName: string;
  lastName?: string;
  rollNumber: string;
  fatherName?: string;
  campusId?: string;
  classId?: string;
  campusName?: string;
  status?: string;
};

function studentLabel(student: SuggestedStudent) {
  return `${student.firstName} — ${formatRollNumberForDisplay(student.rollNumber)}`;
}

interface Props {
  value: SuggestedStudent | null;
  onChange: (student: SuggestedStudent | null) => void;
  includeInactive?: boolean;
  campusId?: string;
  placeholder?: string;
}

export default function StudentSuggestField({
  value,
  onChange,
  includeInactive = false,
  campusId,
  placeholder = 'Search by name, roll, or father name…',
}: Props) {
  const [query, setQuery] = useState(value ? studentLabel(value) : '');
  const [options, setOptions] = useState<SuggestedStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const shownId = useRef<string | null>(value?.id || null);

  useEffect(() => {
    if (value?.id && value.id !== shownId.current) {
      shownId.current = value.id;
      setQuery(studentLabel(value));
      setOpen(false);
      return;
    }
    if (!value?.id && shownId.current) {
      shownId.current = null;
      setQuery('');
      setOpen(false);
    }
  }, [value?.id]);

  useEffect(() => {
    if (query.trim().length < 2 || (value && query === studentLabel(value))) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await dataService.getPaginated('students', {
          search: query.trim(),
          limit: 20,
          page: 1,
          ...(includeInactive ? {} : { status: 'Active' }),
          ...(campusId ? { campusId } : {}),
        });
        if (!cancelled) setOptions(rows.data as SuggestedStudent[]);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, includeInactive, campusId, value?.id]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="vibrant-input ps-10"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            shownId.current = null;
            setQuery(e.target.value);
            if (value) onChange(null);
            setOpen(true);
          }}
          onFocus={() => {
            if (query.trim().length >= 2) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
        />
      </div>
      {open && query.trim().length >= 2 && !(value && query === studentLabel(value)) && (
        <div className="absolute z-20 top-full mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 max-h-64 overflow-y-auto">
          {loading && <p className="px-4 py-3 text-sm text-slate-400">Searching…</p>}
          {!loading && options.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">No student found</p>}
          {!loading && options.map((student) => (
            <button
              key={student.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                shownId.current = student.id;
                onChange(student);
                setQuery(studentLabel(student));
                setOpen(false);
              }}
              className="block w-full px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                {student.firstName} — {formatRollNumberForDisplay(student.rollNumber)}
                {student.fatherName ? ` (${student.fatherName})` : ''}
                {student.status && student.status !== 'Active' ? ` · ${student.status}` : ''}
              </span>
              {student.campusName && <span className="block text-xs text-slate-400">{student.campusName}</span>}
            </button>
          ))}
        </div>
      )}
      {value && (
        <p className="mt-2 text-xs text-slate-500 flex items-center gap-2">
          <User className="w-3.5 h-3.5" />
          {value.firstName} · {formatRollNumberForDisplay(value.rollNumber)}
          {value.campusName ? ` · ${value.campusName}` : ''}
        </p>
      )}
    </div>
  );
}
