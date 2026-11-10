import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[background-color,box-shadow,transform,color,border-color] duration-200 ease-out-expo disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none',
  {
    variants: {
      variant: {
        default: 'btn-3d bg-brand-gradient bg-[length:160%_160%] bg-left text-white [--edge:color-mix(in_oklab,var(--brand)_55%,#04050c)] hover:bg-right',
        accent: 'btn-3d bg-primary text-primary-foreground [--edge:color-mix(in_oklab,var(--primary)_55%,#000)]',
        light: 'soft-raised glass-tint border text-foreground',
        outline: 'soft-raised glass-tint border text-foreground hover:border-[color-mix(in_oklab,var(--brand)_35%,var(--glass-border))]',
        secondary: 'soft-raised bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'hover:bg-accent hover:text-accent-foreground active:scale-[0.96]',
        destructive: 'btn-3d bg-destructive text-white [--edge:color-mix(in_oklab,var(--destructive)_55%,#000)] hover:bg-destructive/90',
        success: 'btn-3d bg-success text-white [--edge:color-mix(in_oklab,var(--success)_55%,#000)] hover:bg-success/90',
        link: 'text-masthead underline decoration-1 underline-offset-4 hover:decoration-2 px-0 h-auto',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-[13px]',
        lg: 'h-12 px-6 text-base',
        xl: 'h-14 px-6 text-base [&_svg]:size-5',
        icon: 'size-10',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export function Button({ className, variant, size, asChild, loading, children, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" />}
          {children}
        </>
      )}
    </Comp>
  )
}
