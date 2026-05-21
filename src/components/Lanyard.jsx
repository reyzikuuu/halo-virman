'use client';
import { useEffect, useState, Suspense, lazy } from 'react';
import './Lanyard.css';

const LanyardModel = lazy(() => import('./LanyardModel.jsx'));

export default function Lanyard(props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Delay loading the heavy 3D model until the browser is idle
    // This prevents blocking the main thread during initial page load
    const timeoutId = setTimeout(() => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => setMounted(true));
      } else {
        setMounted(true);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <div className="lanyard-wrapper">
      {mounted && (
        <Suspense fallback={null}>
          <LanyardModel {...props} />
        </Suspense>
      )}
    </div>
  );
}