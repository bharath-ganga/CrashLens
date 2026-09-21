'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Boxes,
  FileCode2,
  GitCommitHorizontal,
  HeartPulse,
  History,
  LayoutDashboard,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  ScanSearch,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@/components/ui/popover';
import { TooltipProvider } from '@/components/ui/tooltip';

const navigation = [
  {
    title: 'Workspace',
    items: [
      ['overview', 'Overview', LayoutDashboard],
      ['incidents', 'Incidents', AlertTriangle],
      ['monitoring', 'Uptime monitors', HeartPulse],
      ['logs', 'Log explorer', FileCode2],
    ],
  },
  {
    title: 'Investigate',
    items: [
      ['services', 'Services', Boxes],
      ['deployments', 'Deployments', GitCommitHorizontal],
      ['intelligence', 'Intelligence', ScanSearch],
      ['history', 'Incident history', History],
    ],
  },
  {
    title: 'Manage',
    items: [
      ['integrations', 'Integrations', Plug],
      ['team', 'Team', Users],
      ['settings', 'Settings', Settings],
    ],
  },
] as const;

type Props = {
  children: ReactNode;
  view: string;
  onNavigate: (view: string) => void;
  query: string;
  onSearch: (value: string) => void;
  environment: string;
  onEnvironment: (value: string) => void;
  dateRange: string;
  onDateRange: (value: string) => void;
  onUpload: () => void;
  onRemoveLogs: () => void;
  onCritical: () => void;
  criticalCount: number;
  user?: { name: string; email: string };
  admin?: boolean;
  filename: string;
  logCount: number;
};

function Navigation({
  view,
  onNavigate,
  onUpload,
  onRemoveLogs,
  user,
  admin,
  filename,
  logCount,
}: Props) {
  const { setOpenMobile } = useSidebar();
  const navigate = (value: string) => {
    onNavigate(value);
    setOpenMobile(false);
  };
  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="h-16 justify-center border-b px-4 group-data-[collapsible=icon]:px-2">
        <Link
          href="/"
          className="flex items-center gap-3 font-semibold tracking-tight"
        >
          <span className="flex size-8 shrink-0 items-center justify-center bg-foreground text-background">
            <Activity size={19} />
          </span>
          <span className="group-data-[collapsible=icon]:hidden">
            CrashLens{' '}
            <span className="ml-1 font-normal text-muted-foreground">/</span>
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="py-3">
        {navigation.map((group) => (
          <SidebarGroup
            key={group.title}
            className="px-3 py-1 group-data-[collapsible=icon]:px-2"
          >
            <SidebarGroupLabel className="mb-1 h-6 text-[10px] uppercase tracking-widest text-muted-foreground">
              {group.title}
            </SidebarGroupLabel>
            <SidebarMenu className="gap-1">
              {group.items.map(([key, label, Icon]) => (
                <SidebarMenuItem key={key}>
                  <SidebarMenuButton
                    tooltip={label}
                    isActive={view === key}
                    onClick={() => navigate(key)}
                    className="h-8 rounded-none"
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
        {admin && (
          <SidebarGroup className="px-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Client accounts"
                  isActive={view === 'clients'}
                  onClick={() => navigate('clients')}
                >
                  <Users />
                  <span>Client accounts</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t p-3 group-data-[collapsible=icon]:p-2">
        <div className="mb-2 space-y-2 p-2 group-data-[collapsible=icon]:hidden">
          <p
            className="truncate text-xs text-muted-foreground"
            title={
              filename
                ? `${filename} · ${logCount.toLocaleString()} events loaded`
                : 'Upload logs to start investigating'
            }
          >
            {filename || 'No source connected'}
          </p>
          <Button
            variant="outline"
            className="mt-1 w-full"
            onClick={() => {
              setOpenMobile(false);
              onUpload();
            }}
          >
            <Upload />
            Upload source
          </Button>
          {filename && (
            <Button
              variant="ghost"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => {
                setOpenMobile(false);
                onRemoveLogs();
              }}
            >
              <Trash2 />
              Remove logs
            </Button>
          )}
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={user?.email || 'Sign in'}
              render={<Link href="/account" />}
              className="h-11"
            >
              <span className="flex size-7 shrink-0 items-center justify-center border bg-background text-xs font-semibold">
                {(user?.name || 'CL').slice(0, 2).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium">
                  {user?.name || 'Your workspace'}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {user?.email || 'Sign in to save your work'}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export function WorkspaceShell(props: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [props.view]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  return (
    <TooltipProvider>
      <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
        <Navigation {...props} />
        <SidebarInset className="h-dvh min-w-0 overflow-hidden">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <span className="hidden text-xs text-muted-foreground lg:block">
              Workspace
            </span>
            <span className="hidden text-muted-foreground lg:block">/</span>
            <span className="text-sm font-medium capitalize">{props.view}</span>
            <div className="relative ml-auto hidden max-w-64 flex-1 sm:block">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                aria-label="Search workspace"
                value={props.query}
                onChange={(e) => props.onSearch(e.target.value)}
                placeholder="Search…"
                className="h-9 bg-muted/40 pl-9 pr-14"
              />
              <kbd className="absolute right-2 top-2 border px-1.5 text-[10px] leading-4 text-muted-foreground">
                Ctrl K
              </kbd>
            </div>
            <NativeSelect
              aria-label="Environment"
              value={props.environment}
              onChange={(e) => props.onEnvironment(e.target.value)}
              className="ml-auto sm:ml-0 hidden md:block"
            >
              <option>Production</option>
              <option>Staging</option>
              <option>Development</option>
            </NativeSelect>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Notifications"
                    className="ml-auto sm:ml-0"
                  />
                }
              >
                <Bell />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-5">
                <PopoverTitle>Notifications</PopoverTitle>
                <PopoverDescription>
                  {props.criticalCount
                    ? `${props.criticalCount} critical incidents need your attention.`
                    : 'You’re all caught up. No critical incidents to review.'}
                </PopoverDescription>
                {props.criticalCount > 0 && (
                  <Button variant="outline" onClick={props.onCritical}>
                    Review incidents
                    <ArrowUpRight />
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          </header>
          <div
            ref={contentRef}
            id="workspace-content"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <div className="mx-auto max-w-[1600px] px-4 pb-12 pt-8 md:px-8 lg:px-10">
              <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="size-1.5 bg-foreground" />
                    {props.environment} workspace
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight capitalize">
                    {props.view === 'monitoring'
                      ? 'Uptime monitors'
                      : props.view === 'logs'
                        ? 'Log explorer'
                        : props.view === 'history'
                          ? 'Incident history'
                          : props.view}
                  </h1>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                    {props.view === 'incidents'
                      ? 'Find the signal. Investigate the cause. Resolve with confidence.'
                      : props.view === 'overview'
                        ? 'Your services, incidents, and operational health at a glance.'
                        : `Manage your ${props.view} and keep your team in sync.`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <NativeSelect
                    aria-label="Time range"
                    value={props.dateRange}
                    onChange={(e) => props.onDateRange(e.target.value)}
                  >
                    <option>Last 24h</option>
                    <option>Last 7 days</option>
                    <option>Last 30 days</option>
                  </NativeSelect>
                  <Button onClick={props.onUpload}>
                    <Upload />
                    Upload logs
                  </Button>
                </div>
              </div>
              {props.children}
              <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t pt-5 text-[11px] text-muted-foreground">
                <span>CrashLens · Production observability</span>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5" />
                  Sensitive data redacted
                </span>
              </footer>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
