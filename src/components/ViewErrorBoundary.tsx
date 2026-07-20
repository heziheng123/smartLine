import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, ShieldCheck } from 'lucide-react';

interface ViewErrorBoundaryProps {
  children: ReactNode;
  viewName: string;
  resetKey?: string | number;
  onExit?: () => void;
  safeModeKey?: string;
}

interface ViewErrorBoundaryState {
  error: Error | null;
}

export default class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.viewName}] 视图渲染失败`, error, info);
  }

  componentDidUpdate(previousProps: ViewErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  private enterSafeMode = () => {
    if (this.props.safeModeKey) {
      try {
        sessionStorage.setItem(this.props.safeModeKey, '1');
      } catch {
        // Session storage is optional; a reload still gives the view one clean retry.
      }
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="flex h-full min-h-[320px] w-full items-center justify-center bg-slate-50 p-6" role="alert" aria-label={`${this.props.viewName}加载失败`}>
        <div className="w-full max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto text-rose-500" size={30} />
          <h2 className="mt-3 text-lg font-bold text-slate-800">{this.props.viewName}暂时无法显示</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">当前视图发生了异常，其他模块和数据仍然安全。可以重试，或使用安全模式降低一次性渲染量。</p>
          <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-left text-xs text-slate-500">
            <summary className="cursor-pointer font-medium">错误信息</summary>
            <p className="mt-2 break-words">{this.state.error.message || '未知渲染错误'}</p>
          </details>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={this.retry} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCcw size={14} />重试</button>
            {this.props.safeModeKey && <button type="button" onClick={this.enterSafeMode} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"><ShieldCheck size={14} />安全模式打开</button>}
            {this.props.onExit && <button type="button" onClick={this.props.onExit} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回项目规划</button>}
          </div>
        </div>
      </section>
    );
  }
}
