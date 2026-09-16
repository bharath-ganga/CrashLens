'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === 'dark';

  return (
    <div className="flex items-center justify-between gap-4 border border-border bg-card p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-muted text-foreground">
          {dark ? (
            <Moon aria-hidden="true" size={17} />
          ) : (
            <Sun aria-hidden="true" size={17} />
          )}
        </span>
        <div>
          <Label
            htmlFor="dark-mode"
            className="text-sm font-medium text-foreground"
          >
            Dark mode
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {mounted
              ? dark
                ? 'Dark theme is active on this device.'
                : 'Light theme is active on this device.'
              : 'Uses your device preference by default.'}
          </p>
        </div>
      </div>
      <Switch
        id="dark-mode"
        aria-label="Toggle dark mode"
        checked={dark}
        disabled={!mounted}
        onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
      />
    </div>
  );
}
