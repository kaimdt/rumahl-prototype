import { appGradient } from '@/hooks/useInstalledApps'

export function AppInstallProgress({
  progress,
  label,
  iconUrl,
  appId,
  size = 'large',
}: {
  progress: number
  label: string
  iconUrl?: string
  appId: string
  size?: 'compact' | 'small' | 'medium' | 'large'
}) {
  const value = Math.max(0, Math.min(100, Math.round(progress)))
  const radius = 42
  const circumference = 2 * Math.PI * radius

  return (
    <span
      className={`rumahl-install-progress is-${size}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span className="rumahl-install-progress-icon" style={iconUrl ? undefined : { background: appGradient(appId) }}>
        {iconUrl ? <img src={iconUrl} alt="" /> : label.trim().charAt(0).toUpperCase()}
      </span>
      <span className="rumahl-install-progress-shade" />
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="rumahl-install-progress-track" cx="50" cy="50" r={radius} />
        <circle
          className="rumahl-install-progress-value"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <strong>{value}%</strong>
    </span>
  )
}
