import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className="dialog-content"
          onCloseAutoFocus={(event) => {
            if (returnFocus?.current) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close className="dialog-close" aria-label="Close">
            <X size={20} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
