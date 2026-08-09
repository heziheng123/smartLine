import React from 'react';

interface LifeMapEntityEditorProps {
  kind: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onDismiss: () => void;
  children: React.ReactNode;
}

const LifeMapEntityEditor: React.FC<LifeMapEntityEditorProps> = ({ kind, onSubmit, onDismiss, children }) => (
  <div className="life-map-editor" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
    <form className={`life-map-editor__panel life-map-editor__panel--${kind}`} onSubmit={onSubmit}>
      {children}
    </form>
  </div>
);

export default LifeMapEntityEditor;
