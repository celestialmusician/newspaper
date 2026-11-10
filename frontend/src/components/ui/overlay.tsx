import { X } from 'lucide-react'
import { AlertDialog as AD, Dialog as D, DropdownMenu as DM, Popover as PP, Tooltip as TT } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { FormProgress } from './form-guide'

// ---------------- Dialog ----------------
export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({
  className,
  children,
  title,
  description,
  size = 'md',
  ...props
}: React.ComponentProps<typeof D.Content> & { title: React.ReactNode; description?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[size]
  return (
    <D.Portal>
      <D.Overlay className="overlay-fade fixed inset-0 z-50 bg-[#05070d]/55 backdrop-blur-[3px]" />
      <D.Content
        className={cn(
          'dialog-in glass-pop fixed z-50 flex max-h-[92dvh] w-full flex-col overflow-hidden border shadow-pop outline-none',
          'inset-x-0 bottom-0 rounded-t-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
          width,
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 pb-4 pt-5 sm:px-6">
          <div className="min-w-0">
            <D.Title className="font-display text-[22px] font-semibold leading-tight text-primary">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
          </div>
          <D.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </D.Close>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      </D.Content>
    </D.Portal>
  )
}

/** Dialog buttons. Forms with required fields also get their progress here, on the left. */
export function DialogFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-form-footer className={cn('-mx-5 -mb-5 mt-6 flex flex-col-reverse gap-2 border-t border-border/70 bg-muted/40 px-5 py-4 sm:-mx-6 sm:flex-row sm:items-center sm:justify-end sm:px-6', className)} {...props}>
      {children}
      <FormProgress className="sm:order-first sm:mr-auto" />
    </div>
  )
}

// ---------------- Sheet (side drawer) ----------------
export function SheetContent({ className, children, title, side = 'right', ...props }: React.ComponentProps<typeof D.Content> & { title: React.ReactNode; side?: 'left' | 'right' }) {
  return (
    <D.Portal>
      <D.Overlay className="overlay-fade fixed inset-0 z-50 bg-[#05070d]/50" />
      <D.Content
        className={cn('glass-pop fixed inset-y-0 z-50 flex w-[86vw] max-w-sm flex-col shadow-pop outline-none', side === 'right' ? 'sheet-right right-0' : 'sheet-left left-0', className)}
        {...props}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{String(title)}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  )
}

// ---------------- Confirm (AlertDialog) ----------------
interface ConfirmOptions {
  title: string
  description: React.ReactNode
  confirmLabel?: string
  tone?: 'default' | 'destructive'
}

const ConfirmCtx = React.createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false)
export const useConfirm = () => React.useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const confirm = React.useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), [])
  const close = (v: boolean) => {
    state?.resolve(v)
    setState(null)
  }
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <AD.Root open={!!state} onOpenChange={(o) => !o && close(false)}>
        <AD.Portal>
          <AD.Overlay className="overlay-fade fixed inset-0 z-[60] bg-[#05070d]/55 backdrop-blur-[3px]" />
          <AD.Content className="pop-in fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 glass-pop rounded-2xl border p-6 shadow-pop">
            <AD.Title className="font-display text-xl font-semibold text-primary">{state?.title}</AD.Title>
            <AD.Description asChild>
              <div className="mt-2 text-sm text-muted-foreground">{state?.description}</div>
            </AD.Description>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AD.Cancel asChild>
                <Button variant="outline">Cancel</Button>
              </AD.Cancel>
              <AD.Action asChild>
                <Button variant={state?.tone === 'destructive' ? 'destructive' : 'default'} onClick={() => close(true)}>
                  {state?.confirmLabel ?? 'Confirm'}
                </Button>
              </AD.Action>
            </div>
          </AD.Content>
        </AD.Portal>
      </AD.Root>
    </ConfirmCtx.Provider>
  )
}

// ---------------- Dropdown menu ----------------
export const DropdownMenu = DM.Root
export const DropdownMenuTrigger = DM.Trigger

export function DropdownMenuContent({ className, align = 'end', ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn('pop-in glass-pop z-50 min-w-44 overflow-hidden rounded-xl border p-1 text-popover-foreground shadow-pop', className)}
        {...props}
      />
    </DM.Portal>
  )
}

export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground',
        destructive && 'text-destructive [&_svg]:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

export const DropdownMenuSeparator = () => <DM.Separator className="-mx-1 my-1 h-px bg-border" />
export const DropdownMenuLabel = ({ children }: { children: React.ReactNode }) => <DM.Label className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</DM.Label>

// ---------------- Popover ----------------
export const Popover = PP.Root
export const PopoverTrigger = PP.Trigger
export function PopoverContent({ className, align = 'start', ...props }: React.ComponentProps<typeof PP.Content>) {
  return (
    <PP.Portal>
      <PP.Content align={align} sideOffset={6} className={cn('pop-in glass-pop z-50 rounded-2xl border p-3 text-popover-foreground shadow-pop outline-none', className)} {...props} />
    </PP.Portal>
  )
}

// ---------------- Tooltip ----------------
export const TooltipProvider = TT.Provider
export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <TT.Root delayDuration={250}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content sideOffset={6} className="pop-in z-50 max-w-xs rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-pop">
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  )
}
