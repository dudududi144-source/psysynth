import type { ReactNode } from 'react'

export const metadata = {
  title: 'PSY Synth Device - Demo Host',
  description: 'Standalone demo host for the psysynth PsyDevice (family HOW layer)',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#070312', color: '#efe9fb', fontFamily: 'ui-monospace, monospace' }}>
        {children}
      </body>
    </html>
  )
}
