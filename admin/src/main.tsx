import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { FeatureFlagProvider } from './hooks/useFeatureFlags'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <FeatureFlagProvider>
        <App />
      </FeatureFlagProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
