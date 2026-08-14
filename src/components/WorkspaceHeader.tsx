import { type FC, type HTMLAttributes, type ReactNode } from 'react';
import '@/styles/workspace-shell.css';

interface WorkspaceHeaderProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

/**
 * Shared page-level header shell for the six primary workspaces.
 * View-specific controls remain owned by their view; this component only
 * standardizes the page frame, spacing, and responsive behavior.
 */
const WorkspaceHeader: FC<WorkspaceHeaderProps> = ({ className = '', children, ...props }) => (
  <header className={`ui-workspace-header ${className}`.trim()} {...props}>
    {children}
  </header>
);

export default WorkspaceHeader;
