import { ChevronDown } from "lucide-react";
import { SortOption, SORT_LABELS } from "@/lib/sort";

type Props = {
  value: SortOption;
  onChange: (v: SortOption) => void;
};

const SortDropdown = ({ value, onChange }: Props) => {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
        className="appearance-none h-8 pl-3 pr-8 rounded-full border bg-card text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
      >
        {(Object.keys(SORT_LABELS) as SortOption[]).map((k) => (
          <option key={k} value={k}>
            {SORT_LABELS[k]}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
};

export default SortDropdown;