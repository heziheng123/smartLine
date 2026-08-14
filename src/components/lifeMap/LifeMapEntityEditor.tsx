import { type FC, type FormEvent, type ReactNode } from 'react';

interface LifeMapEntityEditorProps {
  kind: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismiss: () => void;
  children: ReactNode;
}

const LifeMapEntityEditor: FC<LifeMapEntityEditorProps> = ({ kind, onSubmit, onDismiss, children }) => (
  <div className="life-map-editor" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
    <form className={`life-map-editor__panel life-map-editor__panel--${kind}`} onSubmit={onSubmit}>
      {children}
    </form>
  </div>
);

export default LifeMapEntityEditor;
