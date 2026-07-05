import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import App from './App'

// 集中注册 dayjs 插件，避免各组件重复 extend
dayjs.extend(isBetween)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
