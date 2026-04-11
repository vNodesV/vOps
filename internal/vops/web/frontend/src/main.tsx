import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme } from './lib/theme'

const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="vops-theme"]');
const initialTheme = themeMeta?.content || 'vthemedgr';
applyTheme(initialTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
