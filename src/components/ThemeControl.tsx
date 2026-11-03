import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemePreference } from '../hooks/useTheme'

const labels: Record<ThemePreference, string> = { system: '跟随系统', light: '浅色', dark: '深色' }

export default function ThemeControl({ preference, onChange }: { preference: ThemePreference; onChange: (preference: ThemePreference) => void }) {
  const Icon = preference === 'system' ? Monitor : preference === 'light' ? Sun : Moon
  return <label className="theme-control icon-button" title={`外观：${labels[preference]}`}>
    <Icon size={19} aria-hidden="true" />
    <select aria-label="外观" value={preference} onChange={event => onChange(event.target.value as ThemePreference)}>
      <option value="system">跟随系统</option>
      <option value="light">浅色</option>
      <option value="dark">深色</option>
    </select>
  </label>
}
