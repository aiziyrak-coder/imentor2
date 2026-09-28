import {Component, type ErrorInfo, type ReactNode} from 'react';
import { translate } from '../i18n/translations';
import { reportClientError } from '../utils/clientErrorReporter';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render errors in child components and shows a fallback UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {hasError: false, error: null};
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {hasError: true, error};
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    reportClientError(error, { stack: `${error.stack || ''}\n--- component ---${info.componentStack || ''}` });
  }

  render(): ReactNode {
    const {hasError, error} = this.state;
    if (hasError && error) {
      return (
        this.props.fallback ?? (
          <div role="alert" className="p-4 font-sans">
            <h1 className="text-lg font-semibold">{translate('uz', 'error.title')}</h1>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-red-700">{error.message}</pre>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
