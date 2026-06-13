'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useIDEStore } from '@/store/useIDEStore';
import { authAPI, setToken } from '@/lib/api';
import { Loader2, Mail, Lock, User } from 'lucide-react';

export function AuthModal() {
  const { isAuthModalOpen, closeAuthModal, setUser, authModalTab } = useIDEStore();
  const [tab, setTab] = useState<'login' | 'signup'>(authModalTab);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup form state
  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');

  React.useEffect(() => {
    setTab(authModalTab);
  }, [authModalTab]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const data = await authAPI.login(loginEmail, loginPassword);
      setToken(data.token);
      setUser(data.user, data.token);
      closeAuthModal();
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (signupPassword !== signupConfirm) {
      setError('Passwords do not match');
      return;
    }
    if (signupPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);
    try {
      const data = await authAPI.signup(signupEmail, signupUsername, signupPassword);
      setToken(data.token);
      setUser(data.user, data.token);
      closeAuthModal();
    } catch (err: any) {
      setError(err.message || 'Signup failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isAuthModalOpen} onOpenChange={(open) => !open && closeAuthModal()}>
      <DialogContent className="sm:max-w-[425px] bg-[#1e1e2e] border-[#313244] text-[#cdd6f4]">
        <DialogHeader>
          <DialogTitle className="text-[#cdd6f4] text-xl font-semibold">
            Welcome to CodeForge
          </DialogTitle>
          <DialogDescription className="text-[#a6adc8]">
            Sign in to save and manage your code files
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'login' | 'signup')}>
          <TabsList className="grid w-full grid-cols-2 bg-[#181825] border-[#313244]">
            <TabsTrigger value="login" className="data-[state=active]:bg-[#313244] data-[state=active]:text-[#cdd6f4]">
              Login
            </TabsTrigger>
            <TabsTrigger value="signup" className="data-[state=active]:bg-[#313244] data-[state=active]:text-[#cdd6f4]">
              Sign Up
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={handleLogin} className="space-y-4 mt-4">
              {error && (
                <div className="bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] rounded-md p-3 text-sm">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="login-email" className="text-[#bac2de]">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7086]" />
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="pl-10 bg-[#181825] border-[#313244] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa]"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password" className="text-[#bac2de]">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7086]" />
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="Enter your password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="pl-10 bg-[#181825] border-[#313244] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa]"
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="ide-btn-hover w-full bg-[#89b4fa] hover:bg-[#74c7ec] text-[#1e1e2e] font-medium" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sign In
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignup} className="space-y-4 mt-4">
              {error && (
                <div className="bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] rounded-md p-3 text-sm">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="signup-email" className="text-[#bac2de]">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7086]" />
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@example.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    className="pl-10 bg-[#181825] border-[#313244] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#a6e3a1]"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-username" className="text-[#bac2de]">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7086]" />
                  <Input
                    id="signup-username"
                    type="text"
                    placeholder="Choose a username"
                    value={signupUsername}
                    onChange={(e) => setSignupUsername(e.target.value)}
                    className="pl-10 bg-[#181825] border-[#313244] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#a6e3a1]"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password" className="text-[#bac2de]">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7086]" />
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="At least 6 characters"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    className="pl-10 bg-[#181825] border-[#313244] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#a6e3a1]"
                    required
                    minLength={6}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-confirm" className="text-[#bac2de]">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7086]" />
                  <Input
                    id="signup-confirm"
                    type="password"
                    placeholder="Confirm your password"
                    value={signupConfirm}
                    onChange={(e) => setSignupConfirm(e.target.value)}
                    className="pl-10 bg-[#181825] border-[#313244] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#a6e3a1]"
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="ide-btn-hover w-full bg-[#a6e3a1] hover:bg-[#94e2d5] text-[#1e1e2e] font-medium" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create Account
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
