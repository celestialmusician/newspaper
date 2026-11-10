import { X } from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

/** Right-hand drawer for a form. Full screen on phones. */
export function FormDrawer({
  open,
  onClose,
  kicker,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  kicker?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="overlay-fade fixed inset-0 z-50 bg-[#05070d]/45 backdrop-blur-[2px]" />
        <D.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // Start in the first field, not on the close button.
            e.preventDefault()
            const c = e.currentTarget as HTMLElement
            c.querySelector<HTMLElement>('.fld-body input:not([type="hidden"]):not(:disabled), .fld-body textarea:not(:disabled), .fld-body button:not(:disabled)')?.focus({ preventScroll: true })
          }}
          className="form-drawer sheet-right glass-pop fixed inset-y-0 right-0 z-50 flex w-full flex-col shadow-pop outline-none md:w-[min(46rem,calc(100vw-2rem))] md:rounded-l-[28px] md:border-l"
        >
          <header className="form-drawer-head">
            <div className="min-w-0">
              {kicker && <p className="kicker text-masthead">{kicker}</p>}
              <D.Title className="mt-0.5 font-display text-[22px] font-semibold leading-tight tracking-[-0.015em] text-primary">{title}</D.Title>
              {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </D.Close>
          </header>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Body of a drawer form: scrolls on its own between the fixed header and footer. */
export function DrawerBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7', className)} {...p} />
}
