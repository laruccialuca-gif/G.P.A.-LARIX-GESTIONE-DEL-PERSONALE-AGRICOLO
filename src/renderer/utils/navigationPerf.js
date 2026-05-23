export function dispatchNavigationStart(route) {
  const normalizedRoute = String(route || '').trim() || '/';
  window.dispatchEvent(new CustomEvent('app:nav-start', {
    detail: {
      route: normalizedRoute,
      startedAt: performance.now(),
    },
  }));
}

export function dispatchRouteReady(route, meta = {}) {
  const normalizedRoute = String(route || '').trim() || '/';
  window.dispatchEvent(new CustomEvent('app:route-ready', {
    detail: {
      route: normalizedRoute,
      readyAt: performance.now(),
      meta,
    },
  }));
}
