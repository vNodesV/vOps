import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Apply theme before first paint to prevent flash of unstyled content.
// The Go server injects <meta name="vops-theme" content="..."> per-request.
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="vops-theme"]');
const initialTheme = themeMeta?.content || 'vnodes';
document.documentElement.setAttribute('data-theme', initialTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
