'use client';

import React from 'react';
import { useIDEStore, SidebarView } from '@/store/useIDEStore';
import {
  Files,
  Search,
  Settings,
  Sparkles,
  User,
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
  { id: 'ai', icon: Sparkles, label: 'AI Assistant' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function ActivityBar() {
  const { sidebarView, setSidebarView, isAuthenticated, user, openAuthModal, logout } = useIDEStore();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="w-12 bg-[#11111b] flex flex-col items-center py-2 border-r border-[#313244]">
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
                      w-10 h-10 flex items-center justify-center rounded-md
                      transition-colors duration-150 relative
                      ${isActive
                        ? 'text-[#cdd6f4] bg-[#1e1e2e]'
                        : 'text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#1e1e2e]/50'
                      }
                    `}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-[#89b4fa] rounded-r" />
                    )}
                    <Icon className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-[#1e1e2e] border-[#313244] text-[#cdd6f4]">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom section: auth */}
        <div className="flex flex-col items-center gap-1 mb-2">
          {isAuthenticated ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="w-10 h-10 flex items-center justify-center rounded-md text-[#a6e3a1] hover:bg-[#1e1e2e]/50 transition-colors">
                    <div className="w-6 h-6 rounded-full bg-[#a6e3a1] text-[#1e1e2e] flex items-center justify-center text-xs font-bold">
                      {user?.username?.[0]?.toUpperCase() || 'U'}
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-[#1e1e2e] border-[#313244] text-[#cdd6f4]">
                  {user?.username}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={logout}
                    className="w-10 h-10 flex items-center justify-center rounded-md text-[#6c7086] hover:text-[#f38ba8] hover:bg-[#1e1e2e]/50 transition-colors"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-[#1e1e2e] border-[#313244] text-[#cdd6f4]">
                  Sign Out
                </TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => openAuthModal('login')}
                  className="w-10 h-10 flex items-center justify-center rounded-md text-[#6c7086] hover:text-[#89b4fa] hover:bg-[#1e1e2e]/50 transition-colors"
                >
                  <LogIn className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-[#1e1e2e] border-[#313244] text-[#cdd6f4]">
                Sign In
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
