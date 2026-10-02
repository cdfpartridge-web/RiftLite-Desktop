import type { ReactNode } from "react";
import { Check, ChevronDown, Shield } from "lucide-react";
import type { AccountOverview } from "../shared/accountOverview";
import "./styles/account-overview.css";

export function AccountIdentityCard({ overview, displayName, handle, email, children }: {
  overview: AccountOverview;
  displayName?: string;
  handle?: string;
  email?: string;
  children?: ReactNode;
}) {
  return <section className="rail-card account-identity-card" aria-labelledby="account-identity-title">
    <div className="account-identity-heading"><h2 id="account-identity-title">{overview.title}</h2><span className="account-identity-status" data-tone={overview.tone}>{overview.tone === "ready" ? <Check size={15} aria-hidden="true" /> : <Shield size={15} aria-hidden="true" />}{overview.status}</span></div>
    {displayName || handle || email ? <div className="account-identity-name">{displayName ? <strong>{displayName}</strong> : null}{handle ? <span>@{handle.replace(/^@+/, "")}</span> : null}{email ? <small>{email}</small> : null}</div> : null}
    <p className="muted">{overview.description}</p>
    {children}
  </section>;
}

export function AccountDisclosure({ id, title, description, open, onToggle, children }: {
  id: string;
  title: string;
  description: string;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  return <details className="rail-card account-disclosure" id={id} open={open} onToggle={(event) => onToggle?.(event.currentTarget.open)}>
    <summary><span><strong>{title}</strong><small>{description}</small></span><ChevronDown size={18} aria-hidden="true" /></summary>
    <div className="account-disclosure-content">{children}</div>
  </details>;
}
