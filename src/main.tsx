import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { connect } from '@owox/plugin-sdk'
import './styles.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)

connect().then(
  ctx => {
    document.documentElement.dataset.theme = ctx.theme
    root.render(
      <StrictMode>
        <App ctx={ctx} />
      </StrictMode>,
    )
  },
  (error: unknown) => {
    root.render(<p role="alert">Open this page from OWOX Data Marts. {String(error)}</p>)
  },
)
