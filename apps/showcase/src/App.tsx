import { lazy, Suspense } from 'react';
import { useEffect, useState } from 'react';
import { TheveRoot } from '@theve/ui';
import { AttractPage } from './pages/AttractPage';

const CockpitPage = lazy(() =>
  import('./pages/CockpitPage').then((module) => ({ default: module.CockpitPage })),
);
const SystemsPage = lazy(() =>
  import('./pages/SystemsPage').then((module) => ({ default: module.SystemsPage })),
);

export type Route = 'attract' | 'cockpit' | 'systems';

function readRoute(): Route {
  if (typeof window === 'undefined') return 'attract';
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('cockpit')) return 'cockpit';
  if (hash.startsWith('systems')) return 'systems';
  return 'attract';
}

export function navigate(route: Route): void {
  const hash = route === 'attract' ? '#/' : `#/${route}`;
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <TheveRoot className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      {route === 'attract' && <AttractPage onNavigate={navigate} />}
      {route !== 'attract' && (
        <Suspense
          fallback={
            <div className="route-loader" role="status" aria-live="polite">
              <span className="route-loader__mark" aria-hidden="true" />
              <span>LOADING TACTICAL SYSTEM…</span>
              <small>正在接入航电总线</small>
            </div>
          }
        >
          {route === 'cockpit' && <CockpitPage onNavigate={navigate} />}
          {route === 'systems' && <SystemsPage onNavigate={navigate} />}
        </Suspense>
      )}
    </TheveRoot>
  );
}
