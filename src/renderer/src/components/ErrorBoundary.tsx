import { Component, type ErrorInfo, type ReactNode } from 'react';

type State = { hasError: boolean };
type Props = { children: ReactNode };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State { return { hasError: true }; }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Provider inputs can contain credentials; never print component state or error payloads.
    console.error('Renderer failed to render. Reload the interface to reopen saved projects.');
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <main className="fatal-error" role="alert"><h1>界面暂时无法显示</h1>
        <p>重新加载界面后，可从历史记录继续处理。已保存的项目仍会保留。</p>
        <button className="button button--primary" onClick={() => window.location.reload()}>重新加载界面</button>
      </main>;
    }
    return this.props.children;
  }
}
