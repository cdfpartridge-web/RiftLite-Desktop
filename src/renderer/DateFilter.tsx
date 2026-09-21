import { useId } from "react";
import {
  DATE_FILTER_LABELS,
  dateFilterValidation,
  localDateInputValue,
  type DateFilterPreset,
  type DateFilterValue,
} from "../shared/dateFilter";
import "./styles/date-filter.css";

type DateFilterProps = {
  value: DateFilterValue;
  onChange: (value: DateFilterValue) => void;
  label?: string;
  presets?: DateFilterPreset[];
};

const DEFAULT_PRESETS: DateFilterPreset[] = ["all", "today", "7d", "30d", "date", "custom"];

export function DateFilter({ value, onChange, label = "Dates", presets = DEFAULT_PRESETS }: DateFilterProps) {
  const id = useId();
  const error = dateFilterValidation(value);
  const changePreset = (preset: DateFilterPreset) => {
    const from = dateFilterValidation({ ...value, preset: "date" }) ? localDateInputValue() : value.from;
    const to = dateFilterValidation({ ...value, preset: "custom", from }) ? from : value.to;
    onChange({ ...value, preset, ...(preset === "date" || preset === "custom" ? { from, to } : {}) });
  };

  return (
    <div className="rl-date-filter" role="group" aria-label={label}>
      <label className="rl-date-filter-field" htmlFor={`${id}-preset`}>
        <span>{label}</span>
        <select id={`${id}-preset`} value={value.preset} onChange={(event) => changePreset(event.target.value as DateFilterPreset)}>
          {(Object.keys(DATE_FILTER_LABELS) as DateFilterPreset[])
            .filter((preset) => presets.includes(preset) || preset === value.preset)
            .map((preset) => <option key={preset} value={preset}>{DATE_FILTER_LABELS[preset]}</option>)}
        </select>
      </label>
      {(value.preset === "date" || value.preset === "custom") && (
        <label className="rl-date-filter-field" htmlFor={`${id}-from`}>
          <span>{value.preset === "date" ? "On" : "From"}</span>
          <input
            id={`${id}-from`}
            type="date"
            aria-label={`${label}: ${value.preset === "date" ? "date" : "from"}`}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            value={value.from}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
          />
        </label>
      )}
      {value.preset === "custom" && (
        <label className="rl-date-filter-field" htmlFor={`${id}-to`}>
          <span>To</span>
          <input
            id={`${id}-to`}
            type="date"
            aria-label={`${label}: to`}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            value={value.to}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
          />
        </label>
      )}
      {error && <p className="rl-date-filter-error" role="alert" id={`${id}-error`}>{error}</p>}
    </div>
  );
}
