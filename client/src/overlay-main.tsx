/**
 * Overlay Entry Point
 * ====================
 * 
 * Separate entry for the overlay window.
 * Loads minimal components for floating widget.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { OverlayApp } from './Overlay';
import './overlay.css';  // Overlay-specific CSS (transparent background)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>,
);
