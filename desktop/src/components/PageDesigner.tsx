// Placeholder PageDesigner component - to be implemented
export function PageDesigner({ show, onClose }: { show: boolean; onClose: () => void }) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl bg-card rounded-lg p-6 shadow-lg">
          <h2 className="text-2xl font-bold mb-4">Page Designer</h2>
          <p className="text-muted-foreground mb-4">Page designer feature coming soon...</p>
          <button onClick={onClose} className="px-4 py-2 bg-primary text-primary-foreground rounded-md">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
