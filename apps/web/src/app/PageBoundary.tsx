import { Component, type PropsWithChildren, type ReactNode } from 'react';
import { PixelErrorIcon } from '../ui/PixelIcons.js';

// Navigation remains usable when a page render or a lazy chunk fails.
// Remount on route changes; failed lazy imports need a fresh document to retry.
export class PageBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="panel page-feedback page-error-card" role="alert">
        <div className="page-error-icon" aria-hidden="true">
          <PixelErrorIcon size={48} />
        </div>
        <h1>页面暂时无法显示</h1>
        <p>请检查连接后重新加载，也可以通过导航打开其他页面。</p>
        <div className="recovery-actions">
          <button onClick={() => window.location.reload()}>重新加载页面</button>
          <a className="button-link secondary" href="/">返回大厅</a>
        </div>
      </section>
    );
  }
}
