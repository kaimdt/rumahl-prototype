/**
 * Promise-based rumahl confirm dialog — replaces `window.confirm`, which renders
 * an ugly browser dialog. Usage from anywhere (no hook needed):
 *
 *   if (!(await confirmDialog({ title, message, confirmLabel, danger }))) return
 *
 * Mount `<ConfirmDialogHost />` once (AppProviders) so the dialog can be
 * shown from any component.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Warning } from '@phosphor-icons/react'

export interface ConfirmDialogOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red/destructive styling for the confirm button. */
  danger?: boolean
}

let pendingOptions: ConfirmDialogOptions | null = null
let pendingResolver: ((value: boolean) => void) | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

/** Show the rumahl confirm dialog; resolves `true` on confirm, `false` on cancel. */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  pendingOptions = options
  emit()
  return new Promise((resolve) => {
    pendingResolver = resolve
  })
}

export function ConfirmDialogHost() {
  const { t } = useTranslation()
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const sync = () => {
      setOptions(pendingOptions)
      setOpen(Boolean(pendingOptions))
    }
    listeners.add(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [])

  const close = (result: boolean) => {
    setOpen(false)
    const resolve = pendingResolver
    pendingOptions = null
    pendingResolver = null
    // Let the dialog close animation finish before the caller resumes.
    window.setTimeout(() => resolve?.(result), 150)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(false) }}>
      <DialogContent className="rumahl-confirm-dialog sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${options?.danger ? 'bg-destructive/10 text-destructive' : 'bg-accent/15 text-accent'}`}>
              <Warning size={20} weight="fill" />
            </span>
            <DialogTitle>{options?.title || t('common.confirm')}</DialogTitle>
          </div>
          <DialogDescription className="whitespace-pre-line pt-2 text-left">{options?.message}</DialogDescription>
        </DialogHeader>
        <div className="rumahl-confirm-actions flex justify-end gap-2 pt-2">
          <Button
            type="button"
            onClick={() => close(false)}
            variant="secondary"
          >
            {options?.cancelLabel || t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => close(true)}
            variant={options?.danger ? "destructive" : "default"}
          >
            {options?.confirmLabel || t('common.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
