'use client';

import React from 'react';
import { useIDEStore, SidebarView } from '@/store/useIDEStore';
import {
  Files,
  Search,
  Settings,
  Sparkles,
  LogIn,
  LogOut,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const ACTIVITY_ITEMS: Array<{
  id: SidebarView;
  icon: React.ElementType;
  label: string;
}> = [
  { id: 'files', icon: Files, label: 'Explorer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function ActivityBar() {
  const { sidebarView, setSidebarView, isAuthenticated, user, openAuthModal, logout, isAIPanelOpen, toggleAIPanel } = useIDEStore();

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="w-12 flex flex-col items-center py-2 border-r"
        style={{
          backgroundColor: 'var(--ide-bg-activitybar)',
          borderColor: 'var(--ide-border)',
        }}
      >
        {/* Top section: sidebar views */}
        <div className="flex flex-col items-center gap-1">
          {ACTIVITY_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = sidebarView === item.id;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSidebarView(item.id)}
                    className={`
                      ide-activity-btn
                      w-10 h-10 flex items-center justify-center rounded-md
                      transition-colors duration-150 relative
                      ${isActive
                        ? 'text-[var(--ide-text-primary)] bg-[var(--ide-bg-tab-active)]'
                        : 'text-[var(--ide-text-dim)] hover:text-[var(--ide-text-primary)] hover:bg-[var(--ide-bg-hover)]/50'
                      }
                    `}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r" style={{ backgroundColor: 'var(--ide-accent)' }} />
                    )}
                    <Icon className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}

          {/* AI Assistant — RHS panel toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleAIPanel}
                className={`
                  ide-activity-btn
                  w-10 h-10 flex items-center justify-center rounded-md
                  transition-colors duration-150 relative
                  ${isAIPanelOpen
                    ? 'text-[var(--ide-purple)] bg-[var(--ide-bg-tab-active)]'
                    : 'text-[var(--ide-text-dim)] hover:text-[var(--ide-purple)] hover:bg-[var(--ide-bg-hover)]/50'
                  }
                `}
              >
                {isAIPanelOpen && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r" style={{ backgroundColor: 'var(--ide-purple)' }} />
                )}
                <Sparkles className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
              AI Assistant
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom section: auth */}
        <div className="flex flex-col items-center gap-1 mb-2">
          {isAuthenticated ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="ide-activity-btn w-10 h-10 flex items-center justify-center rounded-md hover:bg-[var(--ide-bg-hover)]/50 transition-colors">
                    <div className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center" style={{ backgroundColor: 'var(--ide-success)', color: 'var(--ide-bg-base)' }}>
                      {user?.username?.[0]?.toUpperCase() || 'U'}
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                  {user?.username}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={logout}
                    className="ide-activity-btn w-10 h-10 flex items-center justify-center rounded-md transition-colors"
                    style={{ color: 'var(--ide-text-dim)' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ide-error)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ide-text-dim)'}
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                  Sign Out
                </TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => openAuthModal('login')}
                  className="ide-activity-btn w-10 h-10 flex items-center justify-center rounded-md transition-colors"
                  style={{ color: 'var(--ide-text-dim)' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ide-accent)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ide-text-dim)'}
                >
                  <LogIn className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                Sign In
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
