import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export type SettingsAccordionSectionProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  id?: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

/**
 * A native-details settings group. Closed groups keep their children mounted, so
 * draft values, device lists, busy states, and other controls are not reset.
 */
export function SettingsAccordionSection({
  title,
  description,
  icon,
  defaultOpen = false,
  id,
  className,
  contentClassName,
  children
}: SettingsAccordionSectionProps) {
  const generatedId = useId().replaceAll(":", "");
  const sectionId = id || `settings-section-${generatedId}`;
  const summaryId = `${sectionId}-summary`;
  const contentId = `${sectionId}-content`;
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className={joinClassNames("settings-accordion", className)}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        id={summaryId}
        className="settings-accordion-summary"
        aria-controls={contentId}
        aria-expanded={open}
      >
        {icon ? <span className="settings-accordion-icon" aria-hidden="true">{icon}</span> : null}
        <span className="settings-accordion-heading">
          <strong>{title}</strong>
          {description ? <span>{description}</span> : null}
        </span>
        <ChevronDown className="settings-accordion-chevron" size={18} aria-hidden="true" />
      </summary>
      <div
        id={contentId}
        className={joinClassNames("settings-accordion-content", contentClassName)}
        role="region"
        aria-labelledby={summaryId}
      >
        {children}
      </div>
    </details>
  );
}
